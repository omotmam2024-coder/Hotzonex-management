-- Permissive policies changed in place: helper calls wrapped in (select ...) run once
-- per query instead of once per row.
alter policy active_sessions_select on public.active_sessions
  using ((select public.is_admin())
         or ((select public.app_role()) = 'manager'
             and exists (select 1 from public.routers r where r.id = active_sessions.router_id and r.site_id = (select public.app_site_id()))));

alter policy audit_log_select on public.audit_log using ((select public.is_admin()));

alter policy plans_select on public.plans using ((select public.app_role()) is not null);
alter policy plans_admin_insert on public.plans with check ((select public.is_admin()));
alter policy plans_admin_update on public.plans using ((select public.is_admin())) with check ((select public.is_admin()));

alter policy portal_configs_admin on public.portal_configs using ((select public.is_admin())) with check ((select public.is_admin()));

alter policy profiles_select_own on public.profiles using (id = (select auth.uid()));
alter policy profiles_select_admin on public.profiles using ((select public.is_admin()));
alter policy profiles_select_manager on public.profiles
  using ((select public.app_role()) = 'manager' and site_id = (select public.app_site_id()));
alter policy profiles_admin_update on public.profiles using ((select public.is_admin())) with check ((select public.is_admin()));

alter policy router_jobs_select on public.router_jobs
  using ((select public.is_admin())
         or ((select public.app_role()) = 'manager'
             and exists (select 1 from public.routers r where r.id = router_jobs.router_id and r.site_id = (select public.app_site_id()))));
alter policy router_jobs_admin_insert on public.router_jobs
  with check ((select public.is_admin())
              and type in ('test_connection', 'sync_profiles', 'disconnect_user', 'install_portal', 'restore_portal')
              and status = 'queued' and attempts = 0 and result is null
              and started_at is null and finished_at is null
              and created_by = (select auth.uid()));

alter policy router_logins_read on public.router_logins
  using ((select public.is_admin())
         or ((select public.app_role()) = 'manager' and site_id = (select public.app_site_id())));

alter policy routers_select on public.routers using ((select public.is_admin()) or site_id = (select public.app_site_id()));
alter policy routers_admin_update on public.routers using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy routers_admin_delete on public.routers using ((select public.is_admin()));

alter policy sales_select_admin_manager on public.sales
  using ((select public.is_admin())
         or ((select public.app_role()) = 'manager' and site_id = (select public.app_site_id())));
alter policy sales_select_seller on public.sales
  using ((select public.app_role()) = 'seller' and seller_id = (select auth.uid()));

alter policy sites_select on public.sites using ((select public.is_admin()) or id = (select public.app_site_id()));
alter policy sites_admin_insert on public.sites with check ((select public.is_admin()));
alter policy sites_admin_update on public.sites using ((select public.is_admin())) with check ((select public.is_admin()));

alter policy voucher_batches_select on public.voucher_batches
  using ((select public.is_admin())
         or ((select public.app_role()) = 'manager' and site_id = (select public.app_site_id())));

alter policy vouchers_select on public.vouchers
  using ((select public.is_admin())
         or ((select public.app_role()) = 'manager' and site_id = (select public.app_site_id())));
