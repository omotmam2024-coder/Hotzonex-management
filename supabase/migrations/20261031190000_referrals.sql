-- Refer a friend (card-code based, no signup): a customer whose card is in use can get a personal
-- referral code on the Buy page. A friend who uses it when buying a card gets a discount; the
-- referrer then earns a reward code for their own next card. Off until the owner sets the two sizes.
--
--   tenants.referral_friend_percent / referral_reward_percent   null = referrals off
--   promo_codes.source     'owner' (made on the Promo codes page), 'referral' (a customer's code),
--                          'reward' (what the referrer earned)
--   promo_codes.voucher_id the customer's card the referral/reward code belongs to
--   save_referral_settings()   owner only
--   sell_voucher()             when a referral code is used, the referrer's reward code is created
--
-- A referral code can be used 5 times at most; a reward code once, within 60 days. Voiding a sale gives
-- the use back but does not take back a reward already earned.
-- Undo: restore sell_voucher from 20261031120000_promo_codes.sql, then drop function public.save_referral_settings(integer, integer);
--       alter table public.promo_codes drop column source, drop column voucher_id;
--       alter table public.tenants drop column referral_friend_percent, drop column referral_reward_percent;

alter table public.tenants add column if not exists referral_friend_percent integer check (referral_friend_percent between 1 and 100);
alter table public.tenants add column if not exists referral_reward_percent integer check (referral_reward_percent between 1 and 100);

alter table public.promo_codes add column if not exists source text not null default 'owner' check (source in ('owner', 'referral', 'reward'));
alter table public.promo_codes add column if not exists voucher_id uuid references public.vouchers (id) on delete cascade;
create unique index if not exists promo_one_referral_per_card on public.promo_codes (voucher_id) where source = 'referral';
create index if not exists promo_codes_voucher on public.promo_codes (voucher_id) where voucher_id is not null;

create or replace function public.save_referral_settings(p_friend_percent integer, p_reward_percent integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
begin
  if v_tenant is null or public.app_role() is distinct from 'admin' then
    raise exception 'Only the business owner can change referral settings.' using errcode = '42501';
  end if;
  if (p_friend_percent is null) <> (p_reward_percent is null) then
    raise exception 'Set both discounts, or leave both empty to switch referrals off.' using errcode = '22023';
  end if;
  if p_friend_percent is not null and (p_friend_percent not between 1 and 100 or p_reward_percent not between 1 and 100) then
    raise exception 'Each discount must be from 1 to 100 percent.' using errcode = '22023';
  end if;
  update public.tenants set referral_friend_percent = p_friend_percent, referral_reward_percent = p_reward_percent where id = v_tenant;
  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), 'referral.settings', jsonb_build_object('friend_percent', p_friend_percent, 'reward_percent', p_reward_percent), v_tenant);
end;
$$;
revoke all on function public.save_referral_settings(integer, integer) from public, anon;
grant execute on function public.save_referral_settings(integer, integer) to authenticated;

create or replace function public.sell_voucher(p_router_id uuid, p_plan_id uuid, p_request_id uuid default null, p_promo_code text default null)
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
  v_reward integer;
begin
  if v_role is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;

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

  if v_promo_text <> '' then
    select * into v_promo from public.promo_codes pc where pc.tenant_id = v_tenant and pc.code = v_promo_text for update;
    if not found or not v_promo.is_active
       or (v_promo.expires_at is not null and v_promo.expires_at <= v_now)
       or (v_promo.max_uses is not null and v_promo.used_count >= v_promo.max_uses) then
      raise exception 'This promo code is not valid.' using errcode = '22023';
    end if;
    v_discount := least(v_price, case v_promo.kind when 'percent' then floor(v_price * v_promo.value / 100.0)::integer else v_promo.value end);
  end if;

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
    -- A friend used a customer's referral code: the customer earns a one-use reward code (60 days).
    if v_promo.source = 'referral' and v_promo.voucher_id is not null then
      select referral_reward_percent into v_reward from public.tenants where id = v_tenant;
      if v_reward is not null then
        insert into public.promo_codes (tenant_id, code, kind, value, expires_at, max_uses, source, voucher_id)
        values (v_tenant, 'T-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), 'percent', v_reward, v_now + interval '60 days', 1, 'reward', v_promo.voucher_id);
      end if;
    end if;
  end if;

  return query select v_sale_id, v_voucher.id, v_voucher.code, v_price - v_discount, v_now, v_discount;
end;
$$;
