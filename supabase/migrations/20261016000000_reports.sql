-- Phase 8: dashboard and daily / weekly / monthly reports.
-- All grouping is in Africa/Juba time. A day is 00:00–23:59, a week Monday–Sunday,
-- a month the 1st to the last day. Voided sales are always excluded.
-- Admins see every site (or one); managers always get their own site; sellers
-- cannot open reports.

-- Resolves which site a report may cover for the caller, or raises.
create or replace function public.report_site_scope(p_site_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can open reports.' using errcode = '42501';
  end if;
  if v_role = 'manager' then
    if p_site_id is not null and p_site_id is distinct from public.app_site_id() then
      raise exception 'You can only see reports for your own site.' using errcode = '42501';
    end if;
    return public.app_site_id();
  end if;
  return p_site_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- dashboard_summary: revenue today / this week / this month, users online now,
-- revenue for the last 14 days, and stock left per plan per site.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_site_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site uuid := public.report_site_scope(p_site_id);
  v_today date := (now() at time zone 'Africa/Juba')::date;
  v_week date := date_trunc('week', v_today::timestamp)::date;
  v_month date := date_trunc('month', v_today::timestamp)::date;
  v_from date := least(v_month, v_week, v_today - 13);
  v_result jsonb;
begin
  with sales_local as (
    select (s.sold_at at time zone 'Africa/Juba')::date as day, s.amount_ssp
    from public.sales s
    where s.voided_at is null
      and s.sold_at >= (v_from::timestamp at time zone 'Africa/Juba')
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
      where v_site is null or r.site_id = v_site),
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
        cross join public.plans p
        left join public.vouchers v
          on v.site_id = st.id and v.plan_id = p.id and v.status = 'unused' and v.on_router
        where st.is_active and p.is_active
          and exists (select 1 from public.routers r where r.site_id = st.id and r.status <> 'pending')
          and (v_site is null or st.id = v_site)
        group by st.id, st.name, p.id, p.name, p.color, p.price_ssp
      ) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- report_period: everything the Daily / Weekly / Monthly report shows.
--   p_period: 'day' | 'week' | 'month'; p_date: any date inside the period.
-- ---------------------------------------------------------------------------
create or replace function public.report_period(
  p_period text,
  p_date date,
  p_site_id uuid default null,
  p_plan_id uuid default null,
  p_seller_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site uuid := public.report_site_scope(p_site_id);
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
  v_from := v_start::timestamp at time zone 'Africa/Juba';
  v_to := (v_end + 1)::timestamp at time zone 'Africa/Juba';

  with base as (
    select s.*, (s.sold_at at time zone 'Africa/Juba') as local_at
    from public.sales s
    where s.voided_at is null
      and s.sold_at >= (v_prev_start::timestamp at time zone 'Africa/Juba')
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
        'plan_id', p.id, 'name', p.name, 'color', p.color, 'sold', x.sold, 'revenue', x.revenue,
        'share_pct', case when t.revenue > 0 then round(x.revenue * 100.0 / t.revenue, 1) else 0 end)
        order by x.revenue desc, p.name)
      from (select plan_id, count(*) as sold, sum(amount_ssp) as revenue from cur group by plan_id) x
      join public.plans p on p.id = x.plan_id
      cross join totals t), '[]'::jsonb),
    'by_seller', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seller_id', x.seller_id, 'name', coalesce(pr.full_name, 'Automatic (first login)'), 'sold', x.sold, 'revenue', x.revenue)
        order by x.revenue desc)
      from (select seller_id, count(*) as sold, sum(amount_ssp) as revenue from cur group by seller_id) x
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
    'voucher_status', (
      select jsonb_build_object(
        'created', count(*),
        'unused', count(*) filter (where v.status = 'unused'),
        'sold', count(*) filter (where v.status = 'sold'),
        'active', count(*) filter (where v.status = 'active'),
        'expired', count(*) filter (where v.status = 'expired'),
        'disabled', count(*) filter (where v.status = 'disabled'))
      from public.vouchers v
      where v.created_at >= v_from and v.created_at < v_to
        and (v_site is null or v.site_id = v_site)
        and (p_plan_id is null or v.plan_id = p_plan_id))
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.report_site_scope(uuid) from public;
revoke all on function public.dashboard_summary(uuid) from public;
revoke all on function public.report_period(text, date, uuid, uuid, uuid) from public;
grant execute on function public.report_site_scope(uuid) to authenticated;
grant execute on function public.dashboard_summary(uuid) to authenticated;
grant execute on function public.report_period(text, date, uuid, uuid, uuid) to authenticated;
