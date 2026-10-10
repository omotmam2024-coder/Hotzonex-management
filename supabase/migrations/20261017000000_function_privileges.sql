-- Function privileges hardening.
-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default, so "revoke ... from public" alone is not enough. Nobody needs a
-- function before logging in, and agent-only / internal functions must not be
-- callable from the browser at all.

revoke execute on all functions in schema public from anon, public;

-- Internal helpers, trigger functions and Router Agent (service role) functions.
revoke execute on function public.write_audit(text, jsonb) from authenticated;
revoke execute on function public.random_numeric_code(integer) from authenticated;
revoke execute on function public.record_auto_sale(uuid) from authenticated;
revoke execute on function public.sync_router_usage(uuid, jsonb, jsonb) from authenticated;
revoke execute on function public.hzc_session_rows(jsonb) from authenticated;
revoke execute on function public.audit_router_delete() from authenticated;
revoke execute on function public.plans_guard_profile_name() from authenticated;
revoke execute on function public.plans_queue_profile_sync() from authenticated;

grant execute on function public.write_audit(text, jsonb) to service_role;
grant execute on function public.random_numeric_code(integer) to service_role;
grant execute on function public.record_auto_sale(uuid) to service_role;
grant execute on function public.sync_router_usage(uuid, jsonb, jsonb) to service_role;

-- Functions created later are not callable before login unless granted on purpose.
alter default privileges in schema public revoke execute on functions from anon, public;
