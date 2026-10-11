-- Sales from activated vouchers. A router voucher (MikroTicket or any hotspot user Hotzonex did not
-- make) counts as sold when it is activated: its used time on the router goes from zero to more
-- than zero, even if it logged in and out between two checks. Hotzonex's own vouchers count through
-- their first login (sync_router_usage, "Sell on first login").
--
-- Every hotspot user of the router now has a row in router_logins (used or not), so a change from
-- unused to used is seen. The first check of a router only records what is already there
-- (users_baseline_at); users already used then are listed without a sale.

alter table public.routers add column users_baseline_at timestamptz;

alter table public.router_logins
  add column used boolean not null default true,
  alter column last_seen_at drop not null,
  alter column last_seen_at drop default;
comment on column public.router_logins.used is 'The hotspot user has been used (activated) on the router.';
comment on column public.router_logins.last_seen_at is 'Last time the user was seen online (null: never seen online).';
create index router_logins_router_used on public.router_logins (router_id) where not used;

create or replace view public.report_sales as
  select s.id, s.sold_at, s.amount_ssp, s.site_id, s.plan_id, s.seller_id, 'sale'::text as source
  from public.sales s
  where s.voided_at is null
  union all
  select l.id, l.first_login_at, l.price_ssp, l.site_id, l.plan_id, null::uuid, 'router'::text
  from public.router_logins l
  where l.used and l.first_login_known and l.price_ssp > 0;
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
  v_router record;
  v_prev_check timestamptz;
  v_baseline boolean;
  v_rows integer;
begin
  select id, site_id, users_baseline_at, hotspot_users into v_router from public.routers where id = p_router_id for update;
  if v_router.id is null then
    return jsonb_build_object('error', 'unknown router');
  end if;
  v_baseline := v_router.users_baseline_at is null;
  v_prev_check := coalesce((v_router.hotspot_users->>'checked_at')::timestamptz, v_now - interval '1 minute');

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
    from u),
    users_baseline_at = coalesce(r.users_baseline_at, v_now)
  where r.id = p_router_id;

  with s as (
    select distinct on (x.code) x.code, coalesce(x.uptime, 0) as uptime
    from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb)) as x(code text, uptime integer)
    where x.code is not null and x.code <> ''
    order by x.code, x.uptime desc
  ),
  u as (
    select distinct on (x.name) x.name, x.profile, coalesce(x.uptime, 0) as uptime, coalesce(x.comment, '') as comment
    from jsonb_to_recordset(coalesce(p_users, '[]'::jsonb)) as x(name text, profile text, uptime integer, comment text)
    where x.name is not null and x.name <> ''
    order by x.name
  ),
  cur as (
    select u.name, u.profile, u.uptime, s.uptime as session_uptime, s.code is not null as online,
           (u.uptime > 0 or s.code is not null) as used_now,
           p.id as plan_id,
           coalesce(p.price_ssp, nullif(substring(u.profile from '-co:([0-9]+)'), '')::integer) as price,
           -- When a voucher seen used for the first time was activated: from its session if it is
           -- online, otherwise its used time back from now, but not before the previous check.
           case
             when s.code is not null then v_now - make_interval(secs => s.uptime)
             else greatest(v_prev_check, v_now - make_interval(secs => u.uptime))
           end as activated_at,
           -- At the very first check only a user in its first session is known to be activated now.
           (s.code is not null and u.uptime <= s.uptime + 60) as first_session
    from u
    left join s on s.code = u.name
    left join public.plans p on p.router_profile_name = u.profile
    where u.comment !~ '^hzc:'  -- Hotzonex vouchers are counted by their own sales
      and not exists (select 1 from public.vouchers v where v.router_id = p_router_id and v.code = u.name)
  )
  insert into public.router_logins as l
    (router_id, site_id, username, profile, plan_id, price_ssp, used, first_login_at, first_login_known, first_seen_at, last_seen_at)
  select p_router_id, v_router.site_id, cur.name, cur.profile, cur.plan_id, cur.price, cur.used_now,
         case when cur.used_now and (not v_baseline or cur.first_session) then cur.activated_at end,
         cur.used_now and (not v_baseline or cur.first_session),
         v_now,
         case when cur.online then v_now when cur.used_now and not v_baseline then cur.activated_at end
  from cur
  on conflict (router_id, username) do update
  set profile = coalesce(excluded.profile, l.profile),
      plan_id = coalesce(l.plan_id, excluded.plan_id),
      price_ssp = coalesce(l.price_ssp, excluded.price_ssp),
      -- unused → used: this is the activation (the sale)
      first_login_known = l.first_login_known or (not l.used and excluded.used),
      first_login_at = case when not l.used and excluded.used then excluded.first_login_at else l.first_login_at end,
      used = l.used or excluded.used,
      last_seen_at = coalesce(case when excluded.last_seen_at = v_now then v_now end,
                              case when not l.used and excluded.used then excluded.first_login_at end,
                              l.last_seen_at)
  where l.used is distinct from (l.used or excluded.used)
     or excluded.last_seen_at = v_now
     or l.profile is distinct from coalesce(excluded.profile, l.profile)
     or (l.plan_id is null and excluded.plan_id is not null);
  get diagnostics v_rows = row_count;
  return jsonb_build_object('changed', v_rows, 'baseline', v_baseline);
end;
$$;

revoke all on function public.record_router_logins(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_router_logins(uuid, jsonb, jsonb) to service_role;

-- list_sales: recorded sales plus activated router vouchers (seller "Router (MikroTicket voucher)",
-- no voucher_id; they cannot be voided here).
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
  with rows_all as (
    select s.id, s.sold_at, s.voucher_id, v.code, s.plan_id, p.name as plan_name, p.color as plan_color, s.amount_ssp,
           s.seller_id, coalesce(sp.full_name, 'Automatic (first login)') as seller_name, s.site_id, s.router_id,
           s.voided_at, s.void_reason, vp.full_name as voided_by_name
    from public.sales s
    join public.vouchers v on v.id = s.voucher_id
    join public.plans p on p.id = s.plan_id
    left join public.profiles sp on sp.id = s.seller_id
    left join public.profiles vp on vp.id = s.voided_by
    where s.sold_at >= (v_from::timestamp at time zone 'Africa/Juba')
      and s.sold_at < ((v_to + 1)::timestamp at time zone 'Africa/Juba')
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
    where l.used and l.first_login_known and l.price_ssp > 0
      and l.first_login_at >= (v_from::timestamp at time zone 'Africa/Juba')
      and l.first_login_at < ((v_to + 1)::timestamp at time zone 'Africa/Juba')
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
