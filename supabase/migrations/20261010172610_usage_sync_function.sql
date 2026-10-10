-- Phase 7 (part 3): usage sync, first login, expiry and active sessions.
--
-- sync_router_usage: called by the Router Agent every 60 s per online router.
--   p_sessions: [{ "code", "mac", "ip", "uptime", "bytes_in", "bytes_out" }]
--               from /ip/hotspot/active (uptime already in seconds)
--   p_users:    [{ "voucher_id", "uptime", "bytes" }]
--               from /ip/hotspot/user, only users tagged comment=hzc:<voucher_id>
--
-- 1. Upserts who is online now with updated_at = this sync's time and returns that
--    time as synced_at; the agent then removes this router's sessions with an older
--    updated_at (sessions that ended).
-- 2. Stores each voucher's used time and data (router user counters).
-- 3. First login (online now, or the router counted some uptime): sets
--    first_used_at, expires_at (validity) and status "active". With the site's
--    "sell on first login" switch, an unused card gets its cash sale first.
-- 4. Marks vouchers "expired" when time, validity or data is used up.
-- Returns which expired vouchers the agent should remove from the router (not
-- online) and which online sessions it should close (validity ran out; the
-- router itself already stops users at their uptime and data limits).
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

  -- 1. Active sessions (stale rows are removed by the agent using synced_at)
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
    select v.id, v.status, p.validity_seconds
    from public.vouchers v
    join public.plans p on p.id = v.plan_id
    where v.router_id = p_router_id
      and v.first_used_at is null
      and v.status in ('unused', 'sold')
      and (v.uptime_used_seconds > 0 or v.code = any (v_online))
    for update of v
  loop
    if v_first.status = 'unused' and public.record_auto_sale(v_first.id) then
      v_auto_sales := v_auto_sales + 1;
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

revoke all on function public.sync_router_usage(uuid, jsonb, jsonb) from public;
grant execute on function public.sync_router_usage(uuid, jsonb, jsonb) to service_role;
