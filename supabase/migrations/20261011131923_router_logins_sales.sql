-- Sales from router logins: every hotspot user that logs in on a router (MikroTicket vouchers and
-- others not made by Hotzonex) is recorded once, at its first login, at the price of its plan.
-- The router's hotspot user counts (total / unused / used, per profile) are kept on the router row.
-- Both are written every minute by router-direct (record_router_logins).

alter table public.routers add column hotspot_users jsonb;
comment on column public.routers.hotspot_users is 'Hotspot users on the router at the last check: {total, unused, used, by_profile[], checked_at}.';
grant select (hotspot_users) on public.routers to authenticated;

create table public.router_logins (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references public.routers(id) on delete cascade,
  site_id uuid not null references public.sites(id),
  username text not null,
  profile text,
  plan_id uuid references public.plans(id) on delete set null,
  price_ssp integer check (price_ssp is null or price_ssp >= 0),
  -- When the user's very first session started; null when the user had logged in before Hotzonex saw it.
  first_login_at timestamptz,
  first_login_known boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (router_id, username)
);
create index router_logins_first_login on public.router_logins (first_login_at);
create index router_logins_last_seen on public.router_logins (last_seen_at);
alter table public.router_logins enable row level security;
create policy router_logins_read on public.router_logins for select to authenticated
  using (public.is_admin() or (public.app_role() = any (array['admin', 'manager']) and public.can_access_site(site_id)));
revoke all on public.router_logins from anon, authenticated;
grant select on public.router_logins to authenticated;
grant all on public.router_logins to service_role;

-- Everything the reports count as a sale: recorded sales plus first logins seen on the routers.
create view public.report_sales as
  select s.id, s.sold_at, s.amount_ssp, s.site_id, s.plan_id, s.seller_id, 'sale'::text as source
  from public.sales s
  where s.voided_at is null
  union all
  select l.id, l.first_login_at, l.price_ssp, l.site_id, l.plan_id, null::uuid, 'router'::text
  from public.router_logins l
  where l.first_login_known and l.price_ssp > 0;
revoke all on public.report_sales from public, anon, authenticated;
grant select on public.report_sales to service_role;

-- Called by router-direct every minute with the active sessions and all hotspot users of a router.
--   p_sessions: [{code, uptime}]   p_users: [{name, profile, uptime, comment}]   (uptime in seconds)
create or replace function public.record_router_logins(p_router_id uuid, p_sessions jsonb, p_users jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_site uuid := (select site_id from public.routers where id = p_router_id);
  v_new integer;
begin
  if v_site is null then
    return jsonb_build_object('error', 'unknown router');
  end if;

  with u as (
    select * from jsonb_to_recordset(coalesce(p_users, '[]'::jsonb)) as x(name text, profile text, uptime integer, comment text)
  )
  update public.routers r
  set hotspot_users = (
    select jsonb_build_object(
      'total', count(*),
      'unused', count(*) filter (where coalesce(u.uptime, 0) = 0),
      'used', count(*) filter (where coalesce(u.uptime, 0) > 0),
      'by_profile', coalesce((
        select jsonb_agg(jsonb_build_object('profile', bp.profile, 'total', bp.total, 'unused', bp.unused) order by bp.total desc)
        from (
          select coalesce(u2.profile, '') as profile, count(*) as total, count(*) filter (where coalesce(u2.uptime, 0) = 0) as unused
          from u u2 group by 1
        ) bp), '[]'::jsonb),
      'checked_at', v_now)
    from u)
  where r.id = p_router_id;

  -- A user is in its first session when its total uptime is not more than this session's
  -- (RouterOS adds a session to the user's total when it ends).
  with s as (
    select distinct on (x.code) x.code, coalesce(x.uptime, 0) as uptime
    from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb)) as x(code text, uptime integer)
    where x.code is not null and x.code <> ''
    order by x.code, x.uptime desc
  ),
  u as (
    select distinct on (x.name) x.name, x.profile, coalesce(x.uptime, 0) as uptime, coalesce(x.comment, '') as comment
    from jsonb_to_recordset(coalesce(p_users, '[]'::jsonb)) as x(name text, profile text, uptime integer, comment text)
    order by x.name
  ),
  seen as (
    select s.code, u.profile, s.uptime as session_uptime, u.uptime as total_uptime,
           p.id as plan_id,
           coalesce(p.price_ssp, nullif(substring(u.profile from '-co:([0-9]+)'), '')::integer) as price
    from s
    join u on u.name = s.code
    left join public.plans p on p.router_profile_name = u.profile
    where u.comment !~ '^hzc:'  -- Hotzonex vouchers are counted by their own sales
      and not exists (select 1 from public.vouchers v where v.router_id = p_router_id and v.code = s.code)
  )
  insert into public.router_logins (router_id, site_id, username, profile, plan_id, price_ssp, first_login_at, first_login_known, first_seen_at, last_seen_at)
  select p_router_id, v_site, seen.code, seen.profile, seen.plan_id, seen.price,
         case when seen.total_uptime <= seen.session_uptime + 60 then v_now - make_interval(secs => seen.session_uptime) end,
         seen.total_uptime <= seen.session_uptime + 60,
         v_now, v_now
  from seen
  on conflict (router_id, username) do update
  set last_seen_at = excluded.last_seen_at,
      profile = coalesce(excluded.profile, router_logins.profile),
      plan_id = coalesce(router_logins.plan_id, excluded.plan_id),
      price_ssp = coalesce(router_logins.price_ssp, excluded.price_ssp);
  get diagnostics v_new = row_count;
  return jsonb_build_object('seen', v_new);
end;
$$;

revoke all on function public.record_router_logins(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_router_logins(uuid, jsonb, jsonb) to service_role;

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
    from public.report_sales s
    where s.sold_at >= (v_from::timestamp at time zone 'Africa/Juba')
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
    'router_users', (
      select jsonb_build_object(
        'total', coalesce(sum((r.hotspot_users->>'total')::integer), 0),
        'unused', coalesce(sum((r.hotspot_users->>'unused')::integer), 0),
        'used', coalesce(sum((r.hotspot_users->>'used')::integer), 0),
        'checked_at', max(r.hotspot_users->>'checked_at'))
      from public.routers r
      where r.hotspot_users is not null and (v_site is null or r.site_id = v_site)),
    'logins_today', (
      select count(*) from public.router_logins l
      where l.last_seen_at >= (v_today::timestamp at time zone 'Africa/Juba')
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
    from public.report_sales s
    where s.sold_at >= (v_prev_start::timestamp at time zone 'Africa/Juba')
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
        'username', l.username, 'plan', coalesce(p.name, l.profile), 'price_ssp', l.price_ssp,
        'first_login_at', l.first_login_at, 'last_seen_at', l.last_seen_at,
        'new', l.first_login_known and l.first_login_at >= v_from and l.first_login_at < v_to)
        order by coalesce(l.first_login_at, l.first_seen_at) desc)
      from (
        select * from public.router_logins l
        where ((l.first_login_at >= v_from and l.first_login_at < v_to) or (l.last_seen_at >= v_from and l.first_seen_at < v_to))
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
      where v.created_at >= v_from and v.created_at < v_to
        and (v_site is null or v.site_id = v_site)
        and (p_plan_id is null or v.plan_id = p_plan_id))
  ) into v_result;
  return v_result;
end;
$$;

