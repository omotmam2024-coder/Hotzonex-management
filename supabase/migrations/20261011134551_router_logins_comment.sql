-- Keep each router user's comment (MikroTicket writes dates there).
alter table public.router_logins add column comment text;

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
    select u.name, u.profile, u.comment, u.uptime, s.uptime as session_uptime, s.code is not null as online,
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
    (router_id, site_id, username, profile, comment, plan_id, price_ssp, used, first_login_at, first_login_known, first_seen_at, last_seen_at)
  select p_router_id, v_router.site_id, cur.name, cur.profile, nullif(cur.comment, ''), cur.plan_id, cur.price, cur.used_now,
         case when cur.used_now and (not v_baseline or cur.first_session) then cur.activated_at end,
         cur.used_now and (not v_baseline or cur.first_session),
         v_now,
         case when cur.online then v_now when cur.used_now and not v_baseline then cur.activated_at end
  from cur
  on conflict (router_id, username) do update
  set profile = coalesce(excluded.profile, l.profile),
      comment = excluded.comment,
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
     or l.comment is distinct from excluded.comment
     or (l.plan_id is null and excluded.plan_id is not null);
  get diagnostics v_rows = row_count;
  return jsonb_build_object('changed', v_rows, 'baseline', v_baseline);
end;
$$;

revoke all on function public.record_router_logins(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_router_logins(uuid, jsonb, jsonb) to service_role;

