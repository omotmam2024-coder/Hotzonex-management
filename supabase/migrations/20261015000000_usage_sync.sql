-- Phase 7: usage sync, first login, expiry and active sessions.

create index if not exists active_sessions_voucher_idx on public.active_sessions (voucher_id);

-- ---------------------------------------------------------------------------
-- sync_router_usage: called by the Router Agent every 60 s per online router.
--
-- p_sessions: [{ "code", "mac", "ip", "uptime", "bytes_in", "bytes_out" }]
--             from /ip/hotspot/active (uptime already in seconds)
-- p_users:    [{ "voucher_id", "uptime", "bytes" }]
--             from /ip/hotspot/user, only users tagged comment=hzc:<voucher_id>
--
-- 1. Replaces the router's active_sessions with what is online now.
-- 2. Stores each voucher's used time and data (router user counters).
-- 3. First login (online now, or the router counted some uptime): sets
--    first_used_at, expires_at (validity) and status "active". With the site's
--    "sell on first login" switch, an unused card gets its cash sale first.
-- 4. Marks vouchers "expired" when time, validity or data is used up.
-- Returns which expired vouchers the agent should remove from the router (not
-- online) and which online sessions it should close (validity ran out; the
-- router itself already stops users at their uptime and data limits).
-- ---------------------------------------------------------------------------
create or replace function public.sync_router_usage(p_router_id uuid, p_sessions jsonb, p_users jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_first record;
  v_first_count integer := 0;
  v_auto_sales integer := 0;
  v_expired integer;
  v_remove jsonb;
  v_kick jsonb;
begin
  create temporary table if not exists _hzc_sessions (
    code text, mac text, ip text, uptime integer, bytes_in bigint, bytes_out bigint
  ) on commit drop;
  truncate _hzc_sessions;
  insert into _hzc_sessions
  select s.code, coalesce(s.mac, ''), s.ip, coalesce(s.uptime, 0), coalesce(s.bytes_in, 0), coalesce(s.bytes_out, 0)
  from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
    as s(code text, mac text, ip text, uptime integer, bytes_in bigint, bytes_out bigint)
  where s.code is not null;

  -- 1. Active sessions
  delete from public.active_sessions a
  where a.router_id = p_router_id
    and not exists (select 1 from _hzc_sessions s where s.code = a.code and s.mac = a.mac_address);

  insert into public.active_sessions (router_id, voucher_id, code, mac_address, ip_address, uptime_seconds, bytes_in, bytes_out, updated_at)
  select p_router_id, v.id, s.code, s.mac, s.ip, s.uptime, s.bytes_in, s.bytes_out, v_now
  from (select distinct on (code, mac) * from _hzc_sessions order by code, mac, uptime desc) s
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
      and (v.uptime_used_seconds > 0 or exists (select 1 from _hzc_sessions s where s.code = v.code))
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
    and not exists (select 1 from _hzc_sessions s where s.code = v.code);

  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'code', v.code)), '[]'::jsonb) into v_kick
  from public.vouchers v
  where v.router_id = p_router_id
    and v.status = 'expired'
    and v.expires_at is not null
    and v.expires_at <= v_now
    and exists (select 1 from _hzc_sessions s where s.code = v.code);

  return jsonb_build_object(
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

-- ---------------------------------------------------------------------------
-- Batch status: count vouchers that reached the router even after expired ones
-- were removed from it again.
-- ---------------------------------------------------------------------------
create or replace view public.voucher_batch_status
with (security_invoker = true)
as
select
  b.id,
  b.created_at,
  b.site_id,
  b.router_id,
  b.plan_id,
  b.quantity,
  b.code_length,
  b.created_by,
  b.note,
  s.name as site_name,
  r.name as router_name,
  p.name as plan_name,
  p.color as plan_color,
  p.price_ssp,
  p.uptime_seconds,
  coalesce(v.voucher_count, 0) as voucher_count,
  coalesce(v.pushed_count, 0) as pushed_count,
  j.status as push_status,
  j.result->>'error' as push_error,
  j.finished_at as push_finished_at
from public.voucher_batches b
join public.sites s on s.id = b.site_id
join public.routers r on r.id = b.router_id
join public.plans p on p.id = b.plan_id
left join lateral (
  select count(*)::integer as voucher_count,
         count(*) filter (where vv.on_router or vv.status in ('sold', 'active', 'expired'))::integer as pushed_count
  from public.vouchers vv
  where vv.batch_id = b.id
) v on true
left join lateral (
  select jj.status, jj.result, jj.finished_at
  from public.router_jobs jj
  where jj.type = 'push_vouchers' and jj.payload->>'batch_id' = b.id::text
  order by jj.created_at desc
  limit 1
) j on true;
