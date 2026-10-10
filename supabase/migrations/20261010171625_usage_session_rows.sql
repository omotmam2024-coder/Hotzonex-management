-- Phase 7 (part 2): the agent's session list as rows.
-- Sessions sent by the agent, as rows. Duplicate (code, mac) pairs keep the longest uptime.
create or replace function public.hzc_session_rows(p_sessions jsonb)
returns table (code text, mac text, ip text, uptime integer, bytes_in bigint, bytes_out bigint)
language sql
immutable
set search_path = public
as $$
  select distinct on (s.code, coalesce(s.mac, ''))
         s.code, coalesce(s.mac, ''), s.ip, coalesce(s.uptime, 0), coalesce(s.bytes_in, 0), coalesce(s.bytes_out, 0)
  from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
    as s(code text, mac text, ip text, uptime integer, bytes_in bigint, bytes_out bigint)
  where s.code is not null
  order by s.code, coalesce(s.mac, ''), coalesce(s.uptime, 0) desc
$$;

revoke all on function public.hzc_session_rows(jsonb) from public;
grant execute on function public.hzc_session_rows(jsonb) to service_role;
