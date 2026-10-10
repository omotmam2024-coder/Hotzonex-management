-- Hotzonex Cloud schema.
-- Phase 1 contents: sites, staff profiles, role helpers and their RLS policies.
-- Phase 2 extends this same file with routers, plans, vouchers, sales, jobs,
-- sessions, audit log, indexes and the voucher/sales/report functions.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Sites
-- ---------------------------------------------------------------------------
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null unique check (length(trim(name)) > 0),
  timezone text not null default 'Africa/Juba',
  auto_sale_on_login boolean not null default false,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Staff profiles (one per auth user; passwords live only in Supabase Auth)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  full_name text not null check (length(trim(full_name)) > 0),
  role text not null check (role in ('admin', 'manager', 'seller')),
  site_id uuid references public.sites (id) on delete restrict,
  is_active boolean not null default true,
  -- Managers and sellers always belong to exactly one site; admins may span all sites.
  constraint profiles_site_required check (role = 'admin' or site_id is not null)
);

create index profiles_site_id_idx on public.profiles (site_id);

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so RLS policies can read profiles without
-- recursing into the profiles policies themselves.
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.is_active
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
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

-- True when the caller is active staff allowed to see data for the given site:
-- admins and staff with no site (all sites) see everything, others only their own site.
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
    where p.id = auth.uid()
      and p.is_active
      and (p.role = 'admin' or p.site_id is null or p.site_id = target_site)
  )
$$;

revoke all on function public.app_role() from public;
revoke all on function public.app_site_id() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.can_access_site(uuid) from public;
grant execute on function public.app_role() to authenticated;
grant execute on function public.app_site_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_site(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.sites enable row level security;
alter table public.profiles enable row level security;

-- Sites: staff see the sites they work at; only admins change them.
create policy sites_select on public.sites
  for select to authenticated
  using (public.can_access_site(id));

create policy sites_admin_insert on public.sites
  for insert to authenticated
  with check (public.is_admin());

create policy sites_admin_update on public.sites
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy sites_admin_delete on public.sites
  for delete to authenticated
  using (public.is_admin());

-- Profiles: everyone reads their own row (even when inactive, so the app can
-- say "account disabled"); admins read all; managers read staff at their site.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

create policy profiles_select_manager on public.profiles
  for select to authenticated
  using (public.app_role() = 'manager' and site_id = public.app_site_id());

-- Only admins edit profiles from the browser. Accounts are created by the
-- create-staff Edge Function with the service role, which bypasses RLS.
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.sites from anon;
revoke all on public.profiles from anon;
grant select, insert, update, delete on public.sites to authenticated;
grant select, update on public.profiles to authenticated;
