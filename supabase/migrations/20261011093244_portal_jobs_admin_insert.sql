-- Admins may queue the login-portal jobs from the Login Portal page.
alter policy router_jobs_admin_insert on public.router_jobs with check (
  public.is_admin()
  and type in ('test_connection', 'sync_profiles', 'disconnect_user', 'install_portal', 'restore_portal')
  and status = 'queued' and attempts = 0 and result is null and started_at is null and finished_at is null
  and created_by = auth.uid()
);
