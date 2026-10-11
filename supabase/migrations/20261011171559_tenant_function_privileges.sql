-- Functions added for businesses: never callable without signing in; internal ones
-- (triggers, helpers) not callable through the API at all.
revoke all on function public.app_tenant_id(), public.app_timezone(), public.is_platform_admin(),
  public.platform_tenants(), public.platform_set_tenant_active(uuid, boolean)
  from public, anon;
grant execute on function public.app_tenant_id(), public.app_timezone(), public.is_platform_admin(),
  public.platform_tenants(), public.platform_set_tenant_active(uuid, boolean)
  to authenticated, service_role;

revoke all on function public.set_row_tenant(), public.audit_set_tenant(), public.routers_guard_delete(),
  public.routers_guard_site(), public.is_valid_timezone(text), public.mikroticket_activated_at(text, text)
  from public, anon, authenticated;
grant execute on function public.is_valid_timezone(text), public.mikroticket_activated_at(text, text) to service_role;
