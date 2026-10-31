-- Promo codes: the owner makes a code (a percentage or a fixed SSP discount, with an optional expiry
-- and use limit); the cashier types it when selling a card and the customer pays less.
--
--   promo_codes                  one row per code (per business)
--   save_promo_code(...)         owner only: add (p_id null) or change a code (switch it off with p_is_active = false)
--   sell_voucher(..., p_promo_code)   the same sale as before, with an optional promo code
--   sales.discount_ssp           what the customer saved; sales.amount_ssp is what the customer PAID
--                                (so reports, commission and cash-up already use the discounted price)
--   sales.promo_code_id          which code was used
--
-- A code's use count goes up when a card is sold with it; voiding a sale does not give the use back.
-- Undo: restore the previous sell_voucher (20261016171000_idempotent_sell.sql + 20261017090000_review_fixes.sql),
--       then: alter table public.sales drop column promo_code_id, drop column discount_ssp;
--             drop function public.save_promo_code(uuid, text, text, integer, timestamptz, integer, boolean);
--             drop table public.promo_codes;

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9-]{3,20}$'),
  kind text not null check (kind in ('percent', 'fixed')),
  value integer not null check (value > 0 and value <= 1000000000),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint promo_percent_range check (kind <> 'percent' or value <= 100),
  constraint promo_code_per_business unique (tenant_id, code)
);

alter table public.promo_codes enable row level security;
create policy tenant_isolation on public.promo_codes as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy promo_codes_read on public.promo_codes for select to authenticated
  using ((select public.app_role()) in ('admin', 'manager'));
revoke all on public.promo_codes from anon, authenticated;
grant select on public.promo_codes to authenticated;
grant all on public.promo_codes to service_role;

alter table public.sales add column if not exists discount_ssp integer not null default 0 check (discount_ssp >= 0);
alter table public.sales add column if not exists promo_code_id uuid references public.promo_codes (id) on delete set null;
create index if not exists sales_promo_code on public.sales (promo_code_id) where promo_code_id is not null;

create or replace function public.save_promo_code(
  p_id uuid, p_code text, p_kind text, p_value integer, p_expires_at timestamptz, p_max_uses integer, p_is_active boolean
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id uuid;
begin
  if v_tenant is null or public.app_role() is distinct from 'admin' then
    raise exception 'Only the business owner can manage promo codes.' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9-]{3,20}$' then
    raise exception 'The code must be 3 to 20 letters, numbers or dashes.' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('percent', 'fixed') then
    raise exception 'Choose percent or a fixed amount.' using errcode = '22023';
  end if;
  if p_value is null or p_value <= 0 or p_value > 1000000000 or (p_kind = 'percent' and p_value > 100) then
    raise exception 'The discount must be 1 to 100 percent, or an amount in SSP.' using errcode = '22023';
  end if;
  if p_max_uses is not null and p_max_uses <= 0 then
    raise exception 'The use limit must be 1 or more (or empty for no limit).' using errcode = '22023';
  end if;

  begin
    if p_id is null then
      insert into public.promo_codes (tenant_id, code, kind, value, expires_at, max_uses, is_active, created_by)
      values (v_tenant, v_code, p_kind, p_value, p_expires_at, p_max_uses, coalesce(p_is_active, true), auth.uid())
      returning id into v_id;
    else
      update public.promo_codes
      set code = v_code, kind = p_kind, value = p_value, expires_at = p_expires_at, max_uses = p_max_uses, is_active = coalesce(p_is_active, true)
      where id = p_id and tenant_id = v_tenant
      returning id into v_id;
      if v_id is null then
        raise exception 'Promo code not found.' using errcode = 'P0002';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'You already have a promo code named %.', v_code using errcode = '23505';
  end;

  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), case when p_id is null then 'promo.create' else 'promo.update' end,
          jsonb_build_object('code', v_code, 'kind', p_kind, 'value', p_value, 'expires_at', p_expires_at, 'max_uses', p_max_uses, 'active', coalesce(p_is_active, true)), v_tenant);
  return v_id;
end;
$$;
revoke all on function public.save_promo_code(uuid, text, text, integer, timestamptz, integer, boolean) from public, anon;
grant execute on function public.save_promo_code(uuid, text, text, integer, timestamptz, integer, boolean) to authenticated;

-- The sale: same as before, plus an optional promo code. The old 3-argument version is replaced (not
-- kept beside it) so a call can never be ambiguous; calls that send 3 named arguments keep working.
drop function public.sell_voucher(uuid, uuid, uuid);
create function public.sell_voucher(p_router_id uuid, p_plan_id uuid, p_request_id uuid default null, p_promo_code text default null)
returns table(sale_id uuid, voucher_id uuid, code text, amount_ssp integer, sold_at timestamptz, discount_ssp integer)
language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_role text := public.app_role();
  v_tenant uuid := public.app_tenant_id();
  v_router public.routers%rowtype;
  v_plan public.plans%rowtype;
  v_voucher public.vouchers%rowtype;
  v_promo public.promo_codes%rowtype;
  v_promo_text text := upper(btrim(coalesce(p_promo_code, '')));
  v_discount integer := 0;
  v_price integer;
  v_now timestamptz := now();
  v_sale_id uuid;
begin
  if v_role is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;

  -- The same sale attempt sent again (the reply was lost): give back that sale, sell nothing new.
  if p_request_id is not null then
    return query
      select s.id, s.voucher_id, v.code, s.amount_ssp, s.sold_at, s.discount_ssp
      from public.sales s join public.vouchers v on v.id = s.voucher_id
      where s.tenant_id = v_tenant and s.request_id = p_request_id and s.seller_id = auth.uid();
    if found then
      return;
    end if;
  end if;

  select * into v_router from public.routers where id = p_router_id;
  if not found or not public.can_access_site(v_router.site_id) then
    raise exception 'Router not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.sites s where s.id = v_router.site_id and s.is_active) then
    raise exception 'The site for router % is switched off.', v_router.name using errcode = '55000';
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if not found or not v_plan.is_active or v_plan.tenant_id <> v_router.tenant_id then
    raise exception 'This plan does not exist or is switched off.' using errcode = 'P0002';
  end if;
  v_price := v_plan.price_ssp;

  -- The promo code (locked, so two cashiers cannot both use its last use).
  if v_promo_text <> '' then
    select * into v_promo from public.promo_codes pc where pc.tenant_id = v_tenant and pc.code = v_promo_text for update;
    if not found or not v_promo.is_active
       or (v_promo.expires_at is not null and v_promo.expires_at <= v_now)
       or (v_promo.max_uses is not null and v_promo.used_count >= v_promo.max_uses) then
      raise exception 'This promo code is not valid.' using errcode = '22023';
    end if;
    v_discount := least(v_price, case v_promo.kind when 'percent' then floor(v_price * v_promo.value / 100.0)::integer else v_promo.value end);
  end if;

  -- Pre-printed cards (printed_at set) may already be in a customer's hand, so the
  -- cashier never sells them; they are recorded through "Mark as sold" instead.
  select * into v_voucher
  from public.vouchers v
  where v.router_id = v_router.id
    and v.plan_id = v_plan.id
    and v.status = 'unused'
    and v.on_router
    and v.printed_at is null
  order by v.created_at, v.id
  limit 1
  for update skip locked;

  if not found then
    raise exception 'Out of stock: no % vouchers left on %. Generate more vouchers.', v_plan.name, v_router.name
      using errcode = 'P0001';
  end if;

  begin
    update public.vouchers v set status = 'sold', sold_at = v_now where v.id = v_voucher.id;

    insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at, request_id, discount_ssp, promo_code_id)
    values (v_voucher.id, v_router.site_id, v_router.id, v_plan.id, auth.uid(), v_price - v_discount, 'cash', v_now, p_request_id, v_discount, v_promo.id)
    returning id into v_sale_id;
  exception when unique_violation then
    -- The same request arrived twice at the same moment: the other one sold the card.
    if p_request_id is null then
      raise;
    end if;
    return query
      select s.id, s.voucher_id, v.code, s.amount_ssp, s.sold_at, s.discount_ssp
      from public.sales s join public.vouchers v on v.id = s.voucher_id
      where s.tenant_id = v_tenant and s.request_id = p_request_id and s.seller_id = auth.uid();
    return;
  end;

  if v_promo.id is not null then
    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
  end if;

  return query select v_sale_id, v_voucher.id, v_voucher.code, v_price - v_discount, v_now, v_discount;
end;
$$;
revoke all on function public.sell_voucher(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.sell_voucher(uuid, uuid, uuid, text) to authenticated;
