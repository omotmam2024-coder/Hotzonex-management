-- ---------------------------------------------------------------------------
-- 5. Row level security
-- ---------------------------------------------------------------------------
-- Old agent heartbeat table (the PC connector is gone): staff no longer read it.
revoke all on public.agent_status from anon, authenticated;

-- Businesses: staff see their own; platform admins see all. Admins rename theirs.
create policy tenants_select on public.tenants for select to authenticated
  using (id = (select public.app_tenant_id()) or (select public.is_platform_admin()));
create policy tenants_admin_update on public.tenants for update to authenticated
  using (id = (select public.app_tenant_id()) and (select public.is_admin()))
  with check (id = (select public.app_tenant_id()) and (select public.is_admin()));
create policy platform_admins_select_own on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- One business never sees or writes another business's rows.
do $$
declare
  t text;
begin
  foreach t in array array['sites', 'plans', 'routers', 'vouchers', 'voucher_batches', 'sales',
                           'active_sessions', 'router_jobs', 'router_logins', 'portal_configs', 'audit_log'] loop
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all to authenticated
         using (tenant_id = (select public.app_tenant_id()))
         with check (tenant_id = (select public.app_tenant_id()))', t);
  end loop;
end
$$;
-- Everyone may still read their own profile (to see that their account is switched off).
create policy tenant_isolation on public.profiles as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id()) or id = (select auth.uid()))
  with check (tenant_id = (select public.app_tenant_id()));

-- Router login details stay on the server: the website reads only these columns.
revoke select on public.routers from anon, authenticated;
grant select (id, created_at, tenant_id, site_id, name, connection, host, tunnel_ip, port, use_https, username,
              hotspot_info, hotspot_users, hotspot_server, dns_name, status, last_seen_at, model, ros_version,
              last_error, last_usage_at, users_baseline_at)
  on public.routers to authenticated;
