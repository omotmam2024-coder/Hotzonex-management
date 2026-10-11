-- ---------------------------------------------------------------------------
-- 8. Usage from the routers
-- ---------------------------------------------------------------------------
-- A bad date in a MikroTicket comment (or a bad time zone) gives null instead of
-- an error that would stop the whole router check.
create or replace function public.mikroticket_activated_at(p_comment text, p_tz text)
returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v text := substring(p_comment from '-da:(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})');
begin
  if v is null then
    return null;
  end if;
  return v::timestamp at time zone coalesce(nullif(p_tz, ''), 'Africa/Juba');
exception when others then
  return null;
end;
$$;
revoke execute on function public.mikroticket_activated_at(text, text) from authenticated;

create or replace function public.record_router_logins(p_router_id uuid, p_sessions jsonb, p_users jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_users jsonb := case when jsonb_typeof(p_users) = 'array' then p_users else '[]'::jsonb end;
  v_sessions jsonb := case when jsonb_typeof(p_sessions) = 'array' then p_sessions else '[]'::jsonb end;
  v_router record;
  v_tz text;
  v_prev_check timestamptz;
  v_elapsed integer;
  v_baseline boolean;
  v_rows integer;
begin
  select id, site_id, tenant_id, users_baseline_at, hotspot_users into v_router from public.routers where id = p_router_id for update;
  if v_router.id is null then
    return jsonb_build_object('error', 'unknown router');
  end if;
  v_tz := coalesce((select timezone from public.sites where id = v_router.site_id), 'Africa/Juba');
  v_baseline := v_router.users_baseline_at is null;
  v_prev_check := coalesce((v_router.hotspot_users->>'checked_at')::timestamptz, v_now - interval '1 minute');
  v_elapsed := greatest(extract(epoch from v_now - v_prev_check), 0)::integer;

  with u as (
    select * from jsonb_to_recordset(v_users) as x(name text, profile text, uptime integer, comment text)
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
    -- An empty list is more likely a failed read than a router without users: no baseline from it.
    users_baseline_at = case when jsonb_array_length(v_users) > 0 then coalesce(r.users_baseline_at, v_now) else r.users_baseline_at end
  where r.id = p_router_id;

  if jsonb_array_length(v_users) = 0 then
    return jsonb_build_object('changed', 0, 'baseline', v_baseline, 'skipped', 'no users');
  end if;

  with s as (
    select distinct on (x.code) x.code, coalesce(x.uptime, 0) as uptime
    from jsonb_to_recordset(v_sessions) as x(code text, uptime integer)
    where x.code is not null and x.code <> ''
    order by x.code, x.uptime desc
  ),
  u as (
    select distinct on (x.name) x.name, x.profile, coalesce(x.uptime, 0) as uptime, coalesce(x.comment, '') as comment
    from jsonb_to_recordset(v_users) as x(name text, profile text, uptime integer, comment text)
    where x.name is not null and x.name <> ''
    order by x.name
  ),
  base as (
    select u.name, u.profile, u.comment, u.uptime, s.code is not null as online,
           public.mikroticket_activated_at(u.comment, v_tz) as da_at,
           p.id as plan_id,
           coalesce(p.price_ssp, nullif(substring(u.profile from '-co:([0-9]{1,9})(?![0-9])'), '')::integer) as price,
           -- Without a MikroTicket activation time: from its session if it is online, otherwise its
           -- used time back from now, but not before the previous check.
           case
             when s.code is not null then v_now - make_interval(secs => s.uptime)
             else greatest(v_prev_check, v_now - make_interval(secs => u.uptime))
           end as seen_at,
           (s.code is not null and u.uptime <= s.uptime + 60) as first_session
    from u
    left join s on s.code = u.name
    left join public.plans p on p.tenant_id = v_router.tenant_id and p.router_profile_name = u.profile
    where u.comment !~ '^hzc:'  -- Hotzonex vouchers are counted by their own sales
      and not exists (select 1 from public.vouchers v where v.router_id = p_router_id and v.code = u.name)
  ),
  cur as (
    select b.*,
           (b.uptime > 0 or b.online or b.da_at is not null) as used_now,
           coalesce(b.da_at, b.seen_at) as activated_at,
           e.id as e_id, e.used as e_used, e.profile as e_profile, e.comment as e_comment,
           e.plan_id as e_plan_id, e.first_login_at as e_first_login_at
    from base b
    left join public.router_logins e on e.router_id = p_router_id and e.username = b.name
  ),
  todo as (
    select c.*,
           -- When was it activated? Known from MikroTicket's comment; from a first session; for a
           -- user that was unused at the previous check; or for a new user whose used time fits
           -- since the previous check. A user that turns up already used for longer (an import,
           -- a restored backup) is not counted as a sale today.
           c.used_now and (c.da_at is not null
                           or c.first_session
                           or (c.e_id is not null and not c.e_used)
                           or (c.e_id is null and not v_baseline and c.uptime <= v_elapsed + 60)) as known
    from cur c
    where c.e_id is null
       or c.online
       or (not c.e_used and c.used_now)
       or c.e_profile is distinct from coalesce(c.profile, c.e_profile)
       or c.e_comment is distinct from nullif(c.comment, '')
       or (c.e_plan_id is null and c.plan_id is not null)
       or (c.da_at is not null and c.e_first_login_at is distinct from c.da_at)
  )
  insert into public.router_logins as l
    (tenant_id, router_id, site_id, username, profile, comment, plan_id, price_ssp, used, first_login_at, first_login_known, first_seen_at, last_seen_at)
  select v_router.tenant_id, p_router_id, v_router.site_id, t.name, t.profile, nullif(t.comment, ''), t.plan_id, t.price, t.used_now,
         case when t.known then t.activated_at end,
         t.known,
         v_now,
         case when t.online then v_now when t.known then t.activated_at end
  from todo t
  on conflict (router_id, username) do update
  set profile = coalesce(excluded.profile, l.profile),
      comment = excluded.comment,
      plan_id = coalesce(l.plan_id, excluded.plan_id),
      price_ssp = coalesce(l.price_ssp, excluded.price_ssp),
      -- MikroTicket's activation time wins; otherwise unused → used is the activation (the sale).
      first_login_known = l.first_login_known
                          or public.mikroticket_activated_at(excluded.comment, v_tz) is not null
                          or (not l.used and excluded.first_login_known),
      first_login_at = case
        when public.mikroticket_activated_at(excluded.comment, v_tz) is not null then public.mikroticket_activated_at(excluded.comment, v_tz)
        when l.first_login_known then l.first_login_at
        when not l.used and excluded.used then excluded.first_login_at
        else l.first_login_at end,
      used = l.used or excluded.used,
      last_seen_at = coalesce(case when excluded.last_seen_at = v_now then v_now end,
                              case when not l.used and excluded.used then excluded.first_login_at end,
                              l.last_seen_at);
  get diagnostics v_rows = row_count;
  return jsonb_build_object('changed', v_rows, 'baseline', v_baseline);
end;
$$;

-- A Hotzonex voucher that starts working without a recorded sale (automatic sales
-- switched off at its site) is written to the audit log, so it is not missed.
create or replace function public.sync_router_usage(p_router_id uuid, p_sessions jsonb, p_users jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_online text[];
  v_first record;
  v_first_count integer := 0;
  v_auto_sales integer := 0;
  v_expired integer;
  v_remove jsonb;
  v_kick jsonb;
begin
  select coalesce(array_agg(distinct code), '{}') into v_online from public.hzc_session_rows(p_sessions);

  -- 1. Active sessions (stale rows are removed by the worker using synced_at)
  insert into public.active_sessions (router_id, voucher_id, code, mac_address, ip_address, uptime_seconds, bytes_in, bytes_out, updated_at)
  select p_router_id, v.id, s.code, s.mac, s.ip, s.uptime, s.bytes_in, s.bytes_out, v_now
  from public.hzc_session_rows(p_sessions) s
  left join public.vouchers v on v.router_id = p_router_id and v.code = s.code
  on conflict on constraint active_sessions_unique do update
  set voucher_id = excluded.voucher_id,
      ip_address = excluded.ip_address,
      uptime_seconds = excluded.uptime_seconds,
      bytes_in = excluded.bytes_in,
      bytes_out = excluded.bytes_out,
      updated_at = excluded.updated_at;

  -- 2. Used time and data from the router's user counters
  update public.vouchers v
  set uptime_used_seconds = greatest(v.uptime_used_seconds, u.uptime),
      bytes_used = greatest(v.bytes_used, u.bytes)
  from jsonb_to_recordset(coalesce(p_users, '[]'::jsonb)) as u(voucher_id uuid, uptime integer, bytes bigint)
  where v.id = u.voucher_id
    and v.router_id = p_router_id
    and (u.uptime > v.uptime_used_seconds or u.bytes > v.bytes_used);

  -- 3. First login
  for v_first in
    select v.id, v.code, v.tenant_id, v.status, p.validity_seconds
    from public.vouchers v
    join public.plans p on p.id = v.plan_id
    where v.router_id = p_router_id
      and v.first_used_at is null
      and v.status in ('unused', 'sold')
      and (v.uptime_used_seconds > 0 or v.code = any (v_online))
    for update of v
  loop
    if v_first.status = 'unused' then
      if public.record_auto_sale(v_first.id) then
        v_auto_sales := v_auto_sales + 1;
      else
        insert into public.audit_log (tenant_id, user_id, action, details)
        values (v_first.tenant_id, null, 'voucher.used_unsold',
                jsonb_build_object('voucher_id', v_first.id, 'code', v_first.code, 'router_id', p_router_id));
      end if;
    end if;
    update public.vouchers
    set first_used_at = v_now,
        expires_at = case when v_first.validity_seconds is null then null else v_now + make_interval(secs => v_first.validity_seconds) end,
        status = 'active'
    where id = v_first.id;
    v_first_count := v_first_count + 1;
  end loop;

  -- 4. Expiry
  update public.vouchers v
  set status = 'expired'
  from public.plans p
  where p.id = v.plan_id
    and v.router_id = p_router_id
    and v.status = 'active'
    and (
      v.uptime_used_seconds >= p.uptime_seconds
      or (v.expires_at is not null and v.expires_at <= v_now)
      or (p.data_limit_mb is not null and v.bytes_used >= p.data_limit_mb::bigint * 1048576)
    );
  get diagnostics v_expired = row_count;

  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'code', v.code)), '[]'::jsonb) into v_remove
  from public.vouchers v
  where v.router_id = p_router_id
    and v.status = 'expired'
    and v.on_router
    and not (v.code = any (v_online));

  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'code', v.code)), '[]'::jsonb) into v_kick
  from public.vouchers v
  where v.router_id = p_router_id
    and v.status = 'expired'
    and v.expires_at is not null
    and v.expires_at <= v_now
    and v.code = any (v_online);

  return jsonb_build_object(
    'synced_at', v_now,
    'first_logins', v_first_count,
    'auto_sales', v_auto_sales,
    'expired', v_expired,
    'remove', v_remove,
    'kick', v_kick
  );
end;
$$;
