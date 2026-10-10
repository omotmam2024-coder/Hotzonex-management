-- Phase 6: selling — cashier stock, mark pre-printed cards as sold, sales list,
-- voids and automatic "sell on first login". Every money and voucher-status
-- change stays inside these SECURITY DEFINER functions.

-- ---------------------------------------------------------------------------
-- voucher_stock: what the cashier can sell per plan on one router
-- (unused, on the router, not pre-printed — same rule as sell_voucher).
-- ---------------------------------------------------------------------------
create or replace function public.voucher_stock(p_router_id uuid)
returns table (plan_id uuid, available bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_site uuid;
begin
  if public.app_role() is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  select r.site_id into v_site from public.routers r where r.id = p_router_id;
  if v_site is null or not public.can_access_site(v_site) then
    raise exception 'Router not found.' using errcode = 'P0002';
  end if;

  return query
  select v.plan_id, count(*)::bigint
  from public.vouchers v
  where v.router_id = p_router_id
    and v.status = 'unused'
    and v.on_router
    and v.printed_at is null
  group by v.plan_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_vouchers_sold: record pre-printed cards as one cash sale each.
-- Eligible: pushed, printed, never sold, not disabled (a card may already have
-- been used before its sale was recorded). Ineligible codes are skipped and
-- reported back.
-- ---------------------------------------------------------------------------
create or replace function public.mark_vouchers_sold(p_voucher_ids uuid[], p_seller_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
  v_seller public.profiles%rowtype;
  v_voucher record;
  v_now timestamptz := now();
  v_sold integer := 0;
  v_total bigint := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_reason text;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can mark cards as sold.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_voucher_ids, 1), 0) = 0 then
    raise exception 'Choose at least one card.' using errcode = '22023';
  end if;
  if array_length(p_voucher_ids, 1) > 1000 then
    raise exception 'Mark at most 1000 cards at a time.' using errcode = '22023';
  end if;

  select * into v_seller from public.profiles where id = p_seller_id;
  if not found or not v_seller.is_active then
    raise exception 'Choose an active seller.' using errcode = '22023';
  end if;

  for v_voucher in
    select v.id, v.code, v.site_id, v.router_id, v.plan_id, v.status, v.on_router, v.printed_at, p.price_ssp,
           exists (select 1 from public.sales s where s.voucher_id = v.id) as has_sale
    from public.vouchers v
    join public.plans p on p.id = v.plan_id
    where v.id = any (p_voucher_ids)
    order by v.code
    for update of v
  loop
    v_reason := case
      when not public.can_access_site(v_voucher.site_id) then 'not your site'
      when v_voucher.has_sale then 'already sold'
      when v_voucher.status = 'disabled' then 'disabled'
      when not v_voucher.on_router then 'not on the router'
      when v_voucher.printed_at is null then 'not printed — sell it on the Sell screen'
      when v_seller.role <> 'admin' and v_seller.site_id is distinct from v_voucher.site_id then 'seller works at another site'
      else null
    end;

    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_object('code', v_voucher.code, 'reason', v_reason);
      continue;
    end if;

    update public.vouchers
    set status = case when status = 'unused' then 'sold' else status end,
        sold_at = v_now
    where id = v_voucher.id;

    insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at)
    values (v_voucher.id, v_voucher.site_id, v_voucher.router_id, v_voucher.plan_id, v_seller.id, v_voucher.price_ssp, 'cash', v_now);

    v_sold := v_sold + 1;
    v_total := v_total + v_voucher.price_ssp;
  end loop;

  return jsonb_build_object('sold', v_sold, 'total_ssp', v_total, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- list_sales: sales with code, plan, seller and site names.
-- Sellers: only their own sales, today only. Managers: their site. Admins: all.
-- Totals (count and SSP) exclude voided sales.
-- ---------------------------------------------------------------------------
create or replace function public.list_sales(
  p_date_from date,
  p_date_to date,
  p_site_id uuid default null,
  p_plan_id uuid default null,
  p_seller_id uuid default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  sale_id uuid,
  sold_at timestamptz,
  voucher_id uuid,
  code text,
  plan_id uuid,
  plan_name text,
  plan_color text,
  amount_ssp integer,
  seller_id uuid,
  seller_name text,
  site_id uuid,
  site_name text,
  router_id uuid,
  voided_at timestamptz,
  void_reason text,
  voided_by_name text,
  total_rows bigint,
  total_sold bigint,
  total_ssp bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text := public.app_role();
  v_from date := p_date_from;
  v_to date := p_date_to;
  v_site uuid := p_site_id;
  v_seller uuid := p_seller_id;
begin
  if v_role is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  if v_role = 'seller' then
    v_seller := auth.uid();
    v_from := (now() at time zone 'Africa/Juba')::date;
    v_to := v_from;
    v_site := null;
  elsif v_role = 'manager' then
    if v_site is not null and v_site is distinct from public.app_site_id() then
      raise exception 'You can only see sales for your own site.' using errcode = '42501';
    end if;
    v_site := public.app_site_id();
  end if;
  if v_from is null or v_to is null or v_to < v_from then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select s.*
    from public.sales s
    where s.sold_at >= (v_from::timestamp at time zone 'Africa/Juba')
      and s.sold_at < ((v_to + 1)::timestamp at time zone 'Africa/Juba')
      and (v_site is null or s.site_id = v_site)
      and (p_plan_id is null or s.plan_id = p_plan_id)
      and (v_seller is null or s.seller_id = v_seller)
  ),
  totals as (
    select count(*)::bigint as total_rows,
           count(*) filter (where f.voided_at is null)::bigint as total_sold,
           coalesce(sum(f.amount_ssp) filter (where f.voided_at is null), 0)::bigint as total_ssp
    from filtered f
  )
  select f.id, f.sold_at, f.voucher_id, v.code, f.plan_id, p.name, p.color, f.amount_ssp,
         f.seller_id, coalesce(sp.full_name, 'Automatic (first login)'), f.site_id, st.name,
         f.router_id, f.voided_at, f.void_reason, vp.full_name,
         t.total_rows, t.total_sold, t.total_ssp
  from filtered f
  cross join totals t
  join public.vouchers v on v.id = f.voucher_id
  join public.plans p on p.id = f.plan_id
  join public.sites st on st.id = f.site_id
  left join public.profiles sp on sp.id = f.seller_id
  left join public.profiles vp on vp.id = f.voided_by
  order by f.sold_at desc, f.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- void_sale: admins only, within 24 hours, with a reason. Keeps the sale row,
-- disables the voucher and queues disable_voucher for the router.
-- ---------------------------------------------------------------------------
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can void a sale.' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Write a reason for the void.' using errcode = '22023';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found.' using errcode = 'P0002';
  end if;
  if v_sale.voided_at is not null then
    raise exception 'This sale was already voided.' using errcode = '55000';
  end if;
  if v_sale.sold_at < now() - interval '24 hours' then
    raise exception 'Sales can only be voided within 24 hours.' using errcode = '55000';
  end if;

  update public.sales
  set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = p_sale_id;

  update public.vouchers set status = 'disabled' where id = v_sale.voucher_id
  returning code into v_code;

  insert into public.router_jobs (router_id, type, payload, created_by)
  values (v_sale.router_id, 'disable_voucher', jsonb_build_object('voucher_id', v_sale.voucher_id, 'code', v_code), auth.uid());

  perform public.write_audit('sale.voided', jsonb_build_object(
    'sale_id', p_sale_id, 'voucher_id', v_sale.voucher_id, 'code', v_code,
    'amount_ssp', v_sale.amount_ssp, 'reason', trim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------
-- record_auto_sale: Router Agent only. When a site has auto_sale_on_login and an
-- unused voucher logs in for the first time, record a cash sale with no seller.
-- ---------------------------------------------------------------------------
create or replace function public.record_auto_sale(p_voucher_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher record;
  v_now timestamptz := now();
begin
  select v.id, v.site_id, v.router_id, v.plan_id, v.status, p.price_ssp, st.auto_sale_on_login
  into v_voucher
  from public.vouchers v
  join public.plans p on p.id = v.plan_id
  join public.sites st on st.id = v.site_id
  where v.id = p_voucher_id
  for update of v;

  if not found or not v_voucher.auto_sale_on_login or v_voucher.status <> 'unused'
     or exists (select 1 from public.sales s where s.voucher_id = p_voucher_id) then
    return false;
  end if;

  update public.vouchers set status = 'sold', sold_at = v_now where id = p_voucher_id;
  insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at)
  values (p_voucher_id, v_voucher.site_id, v_voucher.router_id, v_voucher.plan_id, null, v_voucher.price_ssp, 'cash', v_now);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.voucher_stock(uuid) from public;
revoke all on function public.mark_vouchers_sold(uuid[], uuid) from public;
revoke all on function public.list_sales(date, date, uuid, uuid, uuid, integer, integer) from public;
revoke all on function public.void_sale(uuid, text) from public;
revoke all on function public.record_auto_sale(uuid) from public;

grant execute on function public.voucher_stock(uuid) to authenticated;
grant execute on function public.mark_vouchers_sold(uuid[], uuid) to authenticated;
grant execute on function public.list_sales(date, date, uuid, uuid, uuid, integer, integer) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.record_auto_sale(uuid) to service_role;
