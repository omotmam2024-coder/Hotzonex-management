-- Follow-up to promo codes (20261031120000):
--   * void_sale gives the promo code its use back when a sale made with it is voided;
--   * list_sales also returns discount_ssp (what the customer saved) so the Sales page can show it.
-- Undo: restore the previous void_sale and list_sales from the migrations that defined them.

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path to 'public' as $$
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

  select * into v_sale from public.sales where id = p_sale_id and tenant_id = public.app_tenant_id() for update;
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

  -- The promo code can be used once more.
  if v_sale.promo_code_id is not null then
    update public.promo_codes set used_count = greatest(used_count - 1, 0) where id = v_sale.promo_code_id;
  end if;

  update public.vouchers set status = 'disabled' where id = v_sale.voucher_id
  returning code into v_code;

  insert into public.router_jobs (router_id, type, payload, created_by)
  values (v_sale.router_id, 'disable_voucher', jsonb_build_object('voucher_id', v_sale.voucher_id, 'code', v_code), auth.uid());

  perform public.write_audit('sale.voided', jsonb_build_object(
    'sale_id', p_sale_id, 'voucher_id', v_sale.voucher_id, 'code', v_code,
    'amount_ssp', v_sale.amount_ssp, 'reason', trim(p_reason)));
end;
$$;

drop function public.list_sales(date, date, uuid, uuid, uuid, integer, integer);
create function public.list_sales(p_date_from date, p_date_to date, p_site_id uuid default null, p_plan_id uuid default null, p_seller_id uuid default null, p_limit integer default 100, p_offset integer default 0)
returns table(sale_id uuid, sold_at timestamptz, voucher_id uuid, code text, plan_id uuid, plan_name text, plan_color text, amount_ssp integer, discount_ssp integer, seller_id uuid, seller_name text, site_id uuid, site_name text, router_id uuid, voided_at timestamptz, void_reason text, voided_by_name text, total_rows bigint, total_sold bigint, total_ssp bigint)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_role text := public.app_role();
  v_tenant uuid := public.app_tenant_id();
  v_tz text := public.app_timezone();
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
    v_from := (now() at time zone v_tz)::date;
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
  with rows_all as (
    select s.id, s.sold_at, s.voucher_id, v.code, s.plan_id, p.name as plan_name, p.color as plan_color, s.amount_ssp, s.discount_ssp,
           s.seller_id, coalesce(sp.full_name, 'Automatic (first login)') as seller_name, s.site_id, s.router_id,
           s.voided_at, s.void_reason, vp.full_name as voided_by_name
    from public.sales s
    join public.vouchers v on v.id = s.voucher_id
    join public.plans p on p.id = s.plan_id
    left join public.profiles sp on sp.id = s.seller_id
    left join public.profiles vp on vp.id = s.voided_by
    where s.tenant_id = v_tenant
      and s.sold_at >= (v_from::timestamp at time zone v_tz)
      and s.sold_at < ((v_to + 1)::timestamp at time zone v_tz)
      and (v_site is null or s.site_id = v_site)
      and (p_plan_id is null or s.plan_id = p_plan_id)
      and (v_seller is null or s.seller_id = v_seller)
    union all
    select l.id, l.first_login_at, null::uuid, l.username, l.plan_id,
           coalesce(p.name, nullif(substring(l.profile from '^profile_(.+?)-se:'), ''), l.profile, '?'),
           coalesce(p.color, '#64748b'), l.price_ssp, 0,
           null::uuid, 'Router (MikroTicket voucher)', l.site_id, l.router_id,
           null::timestamptz, null::text, null::text
    from public.router_logins l
    left join public.plans p on p.id = l.plan_id
    where l.tenant_id = v_tenant
      and l.used and l.first_login_known and l.price_ssp > 0
      and l.first_login_at >= (v_from::timestamp at time zone v_tz)
      and l.first_login_at < ((v_to + 1)::timestamp at time zone v_tz)
      and (v_site is null or l.site_id = v_site)
      and (p_plan_id is null or l.plan_id = p_plan_id)
      and v_seller is null
    union all
    select v.id, v.first_used_at, null::uuid, v.code, v.plan_id, p.name, p.color, p.price_ssp, 0,
           null::uuid, 'Used without a sale (first login)', v.site_id, v.router_id,
           null::timestamptz, null::text, null::text
    from public.vouchers v
    join public.plans p on p.id = v.plan_id
    where v.tenant_id = v_tenant
      and v.first_used_at is not null and p.price_ssp > 0
      and not exists (select 1 from public.sales s where s.voucher_id = v.id)
      and v.first_used_at >= (v_from::timestamp at time zone v_tz)
      and v.first_used_at < ((v_to + 1)::timestamp at time zone v_tz)
      and (v_site is null or v.site_id = v_site)
      and (p_plan_id is null or v.plan_id = p_plan_id)
      and v_seller is null
  ),
  totals as (
    select count(*)::bigint as total_rows,
           count(*) filter (where f.voided_at is null)::bigint as total_sold,
           coalesce(sum(f.amount_ssp) filter (where f.voided_at is null), 0)::bigint as total_ssp
    from rows_all f
  )
  select f.id, f.sold_at, f.voucher_id, f.code, f.plan_id, f.plan_name, f.plan_color, f.amount_ssp, f.discount_ssp,
         f.seller_id, f.seller_name, f.site_id, st.name, f.router_id, f.voided_at, f.void_reason, f.voided_by_name,
         t.total_rows, t.total_sold, t.total_ssp
  from rows_all f
  cross join totals t
  join public.sites st on st.id = f.site_id
  order by f.sold_at desc, f.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.list_sales(date, date, uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.list_sales(date, date, uuid, uuid, uuid, integer, integer) to authenticated;
