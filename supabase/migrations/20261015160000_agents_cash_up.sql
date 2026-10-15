-- Agents and cash-up.
--
-- A seller (an agent or a shop cashier) may earn a commission on the cash cards they sell, and may
-- have a credit limit: the cash they hold for the business. Cash they hand in is recorded; what
-- they still hold = cash sales − their commission − cash handed in. The cash-up shows each seller's
-- day: sold, commission, to hand in, handed in, difference.

alter table public.profiles
  add column commission_pct numeric(5, 2) not null default 0 check (commission_pct between 0 and 50),
  add column credit_limit_ssp integer check (credit_limit_ssp is null or credit_limit_ssp >= 0);
comment on column public.profiles.commission_pct is 'Percent of each cash sale the seller keeps.';
comment on column public.profiles.credit_limit_ssp is 'Most cash the seller may hold before handing in (null: no limit).';

alter table public.sales add column commission_ssp integer not null default 0 check (commission_ssp >= 0);
comment on column public.sales.commission_ssp is 'The seller''s commission on this sale, fixed when it was sold.';

create table public.cash_handovers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  seller_id uuid not null references public.profiles (id),
  site_id uuid references public.sites (id) on delete set null,
  amount_ssp integer not null check (amount_ssp <> 0),
  note text check (length(note) <= 200),
  received_by uuid not null references public.profiles (id),
  received_at timestamptz not null default now()
);
create index cash_handovers_seller on public.cash_handovers (seller_id, received_at desc);
create index cash_handovers_tenant on public.cash_handovers (tenant_id, received_at desc);
create index sales_seller_cash on public.sales (seller_id, sold_at) where payment_method = 'cash' and voided_at is null;

alter table public.cash_handovers enable row level security;
create policy tenant_isolation on public.cash_handovers as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy cash_handovers_read on public.cash_handovers for select to authenticated
  using ((select public.is_admin()) or site_id = (select public.app_site_id()) or seller_id = (select auth.uid()));
revoke all on public.cash_handovers from anon, authenticated;
grant select on public.cash_handovers to authenticated;

/** Cash a seller holds for the business now (all time): cash sales − commission − handed in. */
create or replace function public.seller_cash_held(p_seller_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(amount_ssp - commission_ssp) from public.sales
                    where seller_id = p_seller_id and payment_method = 'cash' and voided_at is null), 0)
        - coalesce((select sum(amount_ssp) from public.cash_handovers where seller_id = p_seller_id), 0))::integer;
$$;
revoke all on function public.seller_cash_held(uuid) from public, anon, authenticated;

/**
 * On every new cash sale: the seller's commission is fixed on the sale, and a seller over their
 * credit limit cannot sell more until they hand in cash.
 */
create or replace function public.sales_commission_and_credit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pct numeric;
  v_limit integer;
  v_held integer;
begin
  if new.payment_method <> 'cash' or new.seller_id is null then
    return new;
  end if;
  select commission_pct, credit_limit_ssp into v_pct, v_limit from public.profiles where id = new.seller_id;
  new.commission_ssp := round(new.amount_ssp * coalesce(v_pct, 0) / 100.0);
  if v_limit is not null then
    v_held := public.seller_cash_held(new.seller_id);
    if v_held + new.amount_ssp - new.commission_ssp > v_limit then
      raise exception 'You hold % SSP of cash for the business (limit %). Hand in cash before selling more.',
        to_char(v_held, 'FM999,999,999'), to_char(v_limit, 'FM999,999,999') using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger ab_sales_commission_and_credit before insert on public.sales
  for each row execute function public.sales_commission_and_credit();

/** Commission and credit limit of a seller. Admins only. */
create or replace function public.set_seller_terms(p_profile_id uuid, p_commission_pct numeric, p_credit_limit_ssp integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change commission and credit.' using errcode = '42501';
  end if;
  if p_commission_pct is null or p_commission_pct < 0 or p_commission_pct > 50 then
    raise exception 'Commission must be from 0 to 50 percent.' using errcode = '22023';
  end if;
  if p_credit_limit_ssp is not null and p_credit_limit_ssp < 0 then
    raise exception 'The credit limit cannot be negative.' using errcode = '22023';
  end if;
  update public.profiles set commission_pct = p_commission_pct, credit_limit_ssp = p_credit_limit_ssp
  where id = p_profile_id and tenant_id = public.app_tenant_id();
  if not found then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (public.app_tenant_id(), auth.uid(), 'staff.terms', jsonb_build_object('profile_id', p_profile_id, 'commission_pct', p_commission_pct, 'credit_limit_ssp', p_credit_limit_ssp));
end;
$$;

/** Cash handed in by a seller (a negative amount corrects a mistake). Admins, or the seller's site manager. */
create or replace function public.record_cash_handover(p_seller_id uuid, p_amount_ssp integer, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_seller public.profiles%rowtype;
begin
  if public.app_role() not in ('admin', 'manager') then
    raise exception 'Only admins and managers can receive cash.' using errcode = '42501';
  end if;
  if p_amount_ssp is null or p_amount_ssp = 0 or abs(p_amount_ssp) > 100000000 then
    raise exception 'Type the amount received.' using errcode = '22023';
  end if;
  select * into v_seller from public.profiles where id = p_seller_id and tenant_id = public.app_tenant_id();
  if not found or (public.app_role() = 'manager' and v_seller.site_id is distinct from public.app_site_id()) then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;
  insert into public.cash_handovers (tenant_id, seller_id, site_id, amount_ssp, note, received_by)
  values (v_seller.tenant_id, v_seller.id, v_seller.site_id, p_amount_ssp, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_seller.tenant_id, auth.uid(), 'cash.received', jsonb_build_object('seller_id', p_seller_id, 'amount', p_amount_ssp, 'note', p_note));
  return jsonb_build_object('held', public.seller_cash_held(p_seller_id));
end;
$$;

/**
 * The cash-up of one day (business time): per seller, cash cards sold, commission, cash to hand in,
 * cash handed in that day, and what they hold in total now. Mobile-money sales they confirmed are
 * listed apart (that money went to the business's number). Sellers see only themselves.
 */
create or replace function public.cash_up(p_date date, p_site_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.app_role();
  v_tenant uuid := public.app_tenant_id();
  v_tz text := public.app_timezone();
  v_site uuid := p_site_id;
  v_from timestamptz := p_date::timestamp at time zone public.app_timezone();
  v_to timestamptz := (p_date + 1)::timestamp at time zone public.app_timezone();
begin
  if v_role is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  if v_role = 'manager' then
    v_site := public.app_site_id();
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.to_hand_in desc, x.name)
    from (
      select p.id as seller_id, p.full_name as name, p.role, p.site_id, st.name as site_name,
             p.commission_pct, p.credit_limit_ssp,
             coalesce(d.cash_count, 0) as cash_count,
             coalesce(d.cash_amount, 0) as cash_amount,
             coalesce(d.commission, 0) as commission,
             coalesce(d.cash_amount, 0) - coalesce(d.commission, 0) as to_hand_in,
             coalesce(h.handed_in, 0) as handed_in,
             coalesce(h.handed_in, 0) - (coalesce(d.cash_amount, 0) - coalesce(d.commission, 0)) as difference,
             coalesce(d.momo_count, 0) as momo_count,
             coalesce(d.momo_amount, 0) as momo_amount,
             public.seller_cash_held(p.id) as held_now
      from public.profiles p
      left join public.sites st on st.id = p.site_id
      left join lateral (
        select count(*) filter (where s.payment_method = 'cash') as cash_count,
               sum(s.amount_ssp) filter (where s.payment_method = 'cash') as cash_amount,
               sum(s.commission_ssp) filter (where s.payment_method = 'cash') as commission,
               count(*) filter (where s.payment_method = 'mobile_money') as momo_count,
               sum(s.amount_ssp) filter (where s.payment_method = 'mobile_money') as momo_amount
        from public.sales s
        where s.seller_id = p.id and s.voided_at is null and s.sold_at >= v_from and s.sold_at < v_to
      ) d on true
      left join lateral (
        select sum(c.amount_ssp) as handed_in from public.cash_handovers c
        where c.seller_id = p.id and c.received_at >= v_from and c.received_at < v_to
      ) h on true
      where p.tenant_id = v_tenant
        and (v_site is null or p.site_id = v_site)
        and (v_role <> 'seller' or p.id = auth.uid())
        and (p.is_active or coalesce(d.cash_count, 0) + coalesce(d.momo_count, 0) > 0 or h.handed_in is not null)
        and (coalesce(d.cash_count, 0) + coalesce(d.momo_count, 0) > 0 or h.handed_in is not null or public.seller_cash_held(p.id) <> 0 or p.role = 'seller')
    ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.set_seller_terms(uuid, numeric, integer) from public, anon;
revoke all on function public.record_cash_handover(uuid, integer, text) from public, anon;
revoke all on function public.cash_up(date, uuid) from public, anon;
grant execute on function public.set_seller_terms(uuid, numeric, integer) to authenticated;
grant execute on function public.record_cash_handover(uuid, integer, text) to authenticated;
grant execute on function public.cash_up(date, uuid) to authenticated;
