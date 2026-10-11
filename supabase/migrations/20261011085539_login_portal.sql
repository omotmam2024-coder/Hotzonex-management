-- Hotzonex login portal: per-router template and settings, and two new router jobs that
-- install the portal pages on the router (install_portal) or switch back to the previous ones (restore_portal).
alter table public.router_jobs drop constraint router_jobs_type_check;
alter table public.router_jobs add constraint router_jobs_type_check check (
  type in ('test_connection', 'push_vouchers', 'sync_profiles', 'disable_voucher', 'disconnect_user', 'install_portal', 'restore_portal')
);

create table public.portal_configs (
  router_id uuid primary key references public.routers(id) on delete cascade,
  template text not null default 'classic' check (template in ('classic', 'bold', 'minimal')),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  installed_at timestamptz,
  installed_dir text,
  previous_dir text,
  server_profile text
);

alter table public.portal_configs enable row level security;
create policy portal_configs_admin on public.portal_configs for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.portal_configs from anon, authenticated;
grant select, insert, update on public.portal_configs to authenticated;
grant all on public.portal_configs to service_role;
