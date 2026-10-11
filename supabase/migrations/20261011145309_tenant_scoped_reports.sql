-- Reports: only the caller's business, days counted in the business's time zone.
-- tenant_id added at the end of the reporting view.
create or replace view public.report_sales as
  select s.id, s.sold_at, s.amount_ssp, s.site_id, s.plan_id, s.seller_id, 'sale'::text as source, s.tenant_id
  from public.sales s
  where s.voided_at is null
  union all
  select l.id, l.first_login_at, l.price_ssp, l.site_id, l.plan_id, null::uuid, 'router'::text, l.tenant_id
  from public.router_logins l
  where l.used and l.first_login_known and l.price_ssp > 0;

create or replace function public.report_sales(p_site_id uuid, p_date_from date, p_date_to date, p_group_by text, p_plan_id uuid default null, p_seller_id uuid default null)
returns table(period_start date, vouchers_sold bigint, revenue_ssp bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_site uuid := public.report_site_scope(p_site_id);
  v_tenant uuid := public.app_tenant_id();
  v_tz text := public.app_timezone();
  v_step interval;
begin
  if p_group_by not in ('day', 'week', 'month') then
    raise exception 'Group by must be day, week or month.' using errcode = '22023';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;
  if p_date_to - p_date_from > 3700 then
    raise exception 'The date range is too long (more than 10 years).' using errcode = '22023';
  end if;

  v_step := ('1 ' || p_group_by)::interval;

  return query
  with periods as (
    select gs::date as period_start
    from generate_series(date_trunc(p_group_by, p_date_from::timestamp), date_trunc(p_group_by, p_date_to::timestamp), v_step) as gs
  ),
  totals as (
    select date_trunc(p_group_by, s.sold_at at time zone v_tz)::date as period_start,
           count(*)::bigint as vouchers_sold,
           sum(s.amount_ssp)::bigint as revenue_ssp
    from public.report_sales s
    where s.tenant_id = v_tenant
      and s.sold_at >= (p_date_from::timestamp at time zone v_tz)
      and s.sold_at < ((p_date_to + 1)::timestamp at time zone v_tz)
      and (v_site is null or s.site_id = v_site)
      and (p_plan_id is null or s.plan_id = p_plan_id)
      and (p_seller_id is null or s.seller_id = p_seller_id)
    group by 1
  )
  select p.period_start, coalesce(t.vouchers_sold, 0), coalesce(t.revenue_ssp, 0)
  from periods p
  left join totals t using (period_start)
  order by p.period_start;
end;
$$;

create or replace function public.dashboard_summary(p_site_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site uuid := public.report_site_scope(p_site_id);
  v_tenant uuid := public.app_tenant_id();
  v_tz text := public.app_timezone();
  v_today date := (now() at time zone public.app_timezone())::date;
  v_week date := date_trunc('week', v_today::timestamp)::date;
  v_month date := date_trunc('month', v_today::timestamp)::date;
  v_from date := least(v_month, v_week, v_today - 13);
  v_result jsonb;
begin
  with sales_local as (
    select (s.sold_at at time zone v_tz)::date as day, s.amount_ssp
    from public.report_sales s
    where s.tenant_id = v_tenant
      and s.sold_at >= (v_from::timestamp at time zone v_tz)
      and (v_site is null or s.site_id = v_site)
  ),
  days as (
    select d::date as day from generate_series(v_today - 13, v_today, interval '1 day') d
  )
  select jsonb_build_object(
    'today', jsonb_build_object(
      'revenue', coalesce((select sum(amount_ssp) from sales_local where day = v_today), 0),
      'sold', (select count(*) from sales_local where day = v_today)),
    'week', jsonb_build_object(
      'revenue', coalesce((select sum(amount_ssp) from sales_local where day >= v_week), 0),
      'sold', (select count(*) from sales_local where day >= v_week),
      'start', v_week),
    'month', jsonb_build_object(
      'revenue', coalesce((select sum(amount_ssp) from sales_local where day >= v_month), 0),
      'sold', (select count(*) from sales_local where day >= v_month),
      'start', v_month),
    'online_now', (
      select count(*) from public.active_sessions a
      join public.routers r on r.id = a.router_id
      where a.tenant_id = v_tenant and (v_site is null or r.site_id = v_site)),
    'router_users', (
      select jsonb_build_object(
        'total', coalesce(sum((r.hotspot_users->>'total')::integer), 0),
        'unused', coalesce(sum((r.hotspot_users->>'unused')::integer), 0),
        'used', coalesce(sum((r.hotspot_users->>'used')::integer), 0),
        'checked_at', max(r.hotspot_users->>'checked_at'))
      from public.routers r
      where r.tenant_id = v_tenant and r.hotspot_users is not null and (v_site is null or r.site_id = v_site)),
    'logins_today', (
      select count(*) from public.router_logins l
      where l.tenant_id = v_tenant
        and l.last_seen_at >= (v_today::timestamp at time zone v_tz)
        and (v_site is null or l.site_id = v_site)),
    'last_14_days', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'revenue', coalesce((select sum(amount_ssp) from sales_local sl where sl.day = d.day), 0),
        'sold', (select count(*) from sales_local sl where sl.day = d.day)) order by d.day)
      from days d),
    'stock', coalesce((
      select jsonb_agg(row_to_json(x) order by x.site_name, x.price_ssp)
      from (
        -- Every active plan at every site that has a router, so empty stock shows as 0.
        select st.id as site_id, st.name as site_name, p.id as plan_id, p.name as plan_name, p.color as plan_color, p.price_ssp,
               count(v.id) filter (where v.printed_at is null)::integer as available,
               count(v.id) filter (where v.printed_at is not null)::integer as printed_unsold
        from public.sites st
        join public.plans p on p.tenant_id = st.tenant_id
        left join public.vouchers v
          on v.site_id = st.id and v.plan_id = p.id and v.status = 'unused' and v.on_router
        where st.tenant_id = v_tenant and st.is_active and p.is_active
          and exists (select 1 from public.routers r where r.site_id = st.id and r.status <> 'pending')
          and (v_site is null or st.id = v_site)
        group by st.id, st.name, p.id, p.name, p.color, p.price_ssp
      ) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.report_period(p_period text, p_date date, p_site_id uuid default null, p_plan_id uuid default null, p_seller_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site uuid := public.report_site_scope(p_site_id);
  v_tenant uuid := public.app_tenant_id();
  v_tz text := public.app_timezone();
  v_start date;
  v_end date;
  v_prev_start date;
  v_prev_end date;
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  if p_period not in ('day', 'week', 'month') then
    raise exception 'Period must be day, week or month.' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Choose a date.' using errcode = '22023';
  end if;

  v_start := date_trunc(p_period, p_date::timestamp)::date;
  v_end := (v_start + ('1 ' || p_period)::interval)::date - 1;
  v_prev_start := (v_start - ('1 ' || p_period)::interval)::date;
  v_prev_end := v_start - 1;
  v_from := v_start::timestamp at time zone v_tz;
  v_to := (v_end + 1)::timestamp at time zone v_tz;

  with base as (
    select s.*, (s.sold_at at time zone v_tz) as local_at
    from public.report_sales s
    where s.tenant_id = v_tenant
      and s.sold_at >= (v_prev_start::timestamp at time zone v_tz)
      and s.sold_at < v_to
      and (v_site is null or s.site_id = v_site)
      and (p_plan_id is null or s.plan_id = p_plan_id)
      and (p_seller_id is null or s.seller_id = p_seller_id)
  ),
  cur as (select * from base where sold_at >= v_from),
  prev as (select * from base where sold_at < v_from),
  totals as (
    select (select count(*) from cur) as sold,
           (select coalesce(sum(amount_ssp), 0) from cur) as revenue,
           (select count(*) from prev) as prev_sold,
           (select coalesce(sum(amount_ssp), 0) from prev) as prev_revenue
  )
  select jsonb_build_object(
    'period', p_period,
    'start', v_start,
    'end', v_end,
    'previous_start', v_prev_start,
    'previous_end', v_prev_end,
    'site_id', v_site,
    'summary', (
      select jsonb_build_object(
        'sold', t.sold,
        'revenue', t.revenue,
        'average', case when t.sold > 0 then round(t.revenue::numeric / t.sold) else 0 end,
        'previous_sold', t.prev_sold,
        'previous_revenue', t.prev_revenue,
        'change_pct', case when t.prev_revenue > 0 then round((t.revenue - t.prev_revenue) * 100.0 / t.prev_revenue, 1) else null end)
      from totals t),
    'by_plan', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', x.plan_id, 'name', coalesce(p.name, 'Other router profiles'), 'color', coalesce(p.color, '#64748b'), 'sold', x.sold, 'revenue', x.revenue,
        'share_pct', case when t.revenue > 0 then round(x.revenue * 100.0 / t.revenue, 1) else 0 end)
        order by x.revenue desc, p.name)
      from (select plan_id, count(*) as sold, sum(amount_ssp) as revenue from cur group by plan_id) x
      left join public.plans p on p.id = x.plan_id
      cross join totals t), '[]'::jsonb),
    'by_seller', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seller_id', x.seller_id,
        'source', x.source,
        'name', coalesce(pr.full_name, case when x.source = 'router' then 'Router logins (MikroTicket and other vouchers)' else 'Automatic (first login)' end),
        'sold', x.sold, 'revenue', x.revenue)
        order by x.revenue desc)
      from (select seller_id, source, count(*) as sold, sum(amount_ssp) as revenue from cur group by seller_id, source) x
      left join public.profiles pr on pr.id = x.seller_id), '[]'::jsonb),
    'by_site', coalesce((
      select jsonb_agg(jsonb_build_object('site_id', st.id, 'name', st.name, 'sold', x.sold, 'revenue', x.revenue) order by x.revenue desc)
      from (select site_id, count(*) as sold, sum(amount_ssp) as revenue from cur group by site_id) x
      join public.sites st on st.id = x.site_id), '[]'::jsonb),
    'breakdown', case
      when p_period = 'day' then (
        select jsonb_agg(jsonb_build_object('hour', x.h, 'sold', x.sold, 'revenue', x.revenue) order by x.h)
        from (
          select h, count(c.id) as sold, coalesce(sum(c.amount_ssp), 0) as revenue
          from generate_series(0, 23) h
          left join cur c on extract(hour from c.local_at) = h
          group by h
        ) x)
      else (
        select jsonb_agg(jsonb_build_object(
          'day', d::date,
          'week_start', date_trunc('week', d)::date,
          'sold', (select count(*) from cur c where c.local_at::date = d::date),
          'revenue', (select coalesce(sum(c.amount_ssp), 0) from cur c where c.local_at::date = d::date)) order by d)
        from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') d)
    end,
    'router_logins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'router_id', l.router_id, 'username', l.username, 'plan', coalesce(p.name, l.profile), 'price_ssp', l.price_ssp,
        'first_login_at', l.first_login_at, 'last_seen_at', l.last_seen_at,
        'new', l.first_login_known and l.first_login_at >= v_from and l.first_login_at < v_to)
        order by coalesce(l.first_login_at, l.first_seen_at) desc)
      from (
        select * from public.router_logins l
        where l.tenant_id = v_tenant
          and ((l.first_login_at >= v_from and l.first_login_at < v_to) or (l.last_seen_at >= v_from and l.first_seen_at < v_to))
          and (v_site is null or l.site_id = v_site)
          and (p_plan_id is null or l.plan_id = p_plan_id)
          and p_seller_id is null
        order by coalesce(l.first_login_at, l.first_seen_at) desc
        limit 500
      ) l
      left join public.plans p on p.id = l.plan_id), '[]'::jsonb),
    'voucher_status', (
      select jsonb_build_object(
        'created', count(*),
        'unused', count(*) filter (where v.status = 'unused'),
        'sold', count(*) filter (where v.status = 'sold'),
        'active', count(*) filter (where v.status = 'active'),
        'expired', count(*) filter (where v.status = 'expired'),
        'disabled', count(*) filter (where v.status = 'disabled'))
      from public.vouchers v
      where v.tenant_id = v_tenant
        and v.created_at >= v_from and v.created_at < v_to
        and (v_site is null or v.site_id = v_site)
        and (p_plan_id is null or v.plan_id = p_plan_id))
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.list_sales(p_date_from date, p_date_to date, p_site_id uuid default null, p_plan_id uuid default null, p_seller_id uuid default null, p_limit integer default 100, p_offset integer default 0)
returns table(sale_id uuid, sold_at timestamptz, voucher_id uuid, code text, plan_id uuid, plan_name text, plan_color text, amount_ssp integer, seller_id uuid, seller_name text, site_id uuid, site_name text, router_id uuid, voided_at timestamptz, void_reason text, voided_by_name text, total_rows bigint, total_sold bigint, total_ssp bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    select s.id, s.sold_at, s.voucher_id, v.code, s.plan_id, p.name as plan_name, p.color as plan_color, s.amount_ssp,
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
           coalesce(p.color, '#64748b'), l.price_ssp,
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
  ),
  totals as (
    select count(*)::bigint as total_rows,
           count(*) filter (where f.voided_at is null)::bigint as total_sold,
           coalesce(sum(f.amount_ssp) filter (where f.voided_at is null), 0)::bigint as total_ssp
    from rows_all f
  )
  select f.id, f.sold_at, f.voucher_id, f.code, f.plan_id, f.plan_name, f.plan_color, f.amount_ssp,
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
