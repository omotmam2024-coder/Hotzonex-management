-- A router without a battery clock starts at 1970 or 2000 after a power cut until it syncs, and
-- MikroTicket stamps cards that log in meanwhile with that date ("-da:1970-01-01 ..."). Such a
-- stamp put the sale in 1970 (missing from today's report). Stamps more than 400 days old or in
-- the future are now ignored: the sale then takes the time the router check saw the login.
create or replace function public.mikroticket_activated_at_checked(p_comment text, p_tz text)
returns timestamptz
language sql
stable
set search_path to 'pg_catalog'
as $$
  select d
  from (select public.mikroticket_activated_at(p_comment, p_tz) as d) z
  where d between now() - interval '400 days' and now() + interval '1 day';
$$;

revoke execute on function public.mikroticket_activated_at_checked(text, text) from public, anon, authenticated;
grant execute on function public.mikroticket_activated_at_checked(text, text) to service_role;

do $$
declare
  v_def text := pg_get_functiondef('public.record_router_logins'::regproc);
  v_new text := replace(v_def, 'public.mikroticket_activated_at(', 'public.mikroticket_activated_at_checked(');
begin
  if v_new = v_def then
    raise exception 'record_router_logins: mikroticket_activated_at call not found';
  end if;
  execute v_new;
end;
$$;
