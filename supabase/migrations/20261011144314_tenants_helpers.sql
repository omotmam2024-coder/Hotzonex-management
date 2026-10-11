-- ---------------------------------------------------------------------------
-- 3. Who is asking: business, role, site
-- ---------------------------------------------------------------------------
create or replace function public.app_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.tenant_id
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = auth.uid() and p.is_active and t.is_active
$$;

create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = auth.uid() and p.is_active and t.is_active
$$;

create or replace function public.app_site_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.site_id
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = auth.uid() and p.is_active and t.is_active
$$;

-- The business's clock: reports count days in this time zone.
create or replace function public.app_timezone()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select t.timezone from public.tenants t where t.id = public.app_tenant_id()), 'Africa/Juba')
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
$$;

-- A site of the caller's own business, and (unless admin) the caller's own site.
create or replace function public.can_access_site(target_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.tenants t on t.id = p.tenant_id and t.is_active
    join public.sites s on s.id = target_site and s.tenant_id = p.tenant_id
    where p.id = auth.uid()
      and p.is_active
      and (p.role = 'admin' or p.site_id = target_site)
  )
$$;

grant execute on function public.app_tenant_id(), public.app_timezone(), public.is_platform_admin() to authenticated;
