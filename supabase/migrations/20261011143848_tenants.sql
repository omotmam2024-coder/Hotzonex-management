-- =============================================================================
-- Businesses (tenants): one shared system, many hotspot businesses.
-- Every business has its own sites, plans, routers, staff, vouchers and sales.
-- A RESTRICTIVE policy on every table keeps one business's rows away from
-- another's, and a trigger stamps tenant_id on every new row from its parent.
-- (Applied in several steps: this file and the next ones.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Businesses and platform admins
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select p_tz is not null and exists (select 1 from pg_timezone_names where name = p_tz)
$$;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null unique check (length(trim(name)) between 1 and 100),
  timezone text not null default 'Africa/Juba' check (public.is_valid_timezone(timezone)),
  currency text not null default 'SSP' check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.tenants enable row level security;
alter table public.platform_admins enable row level security;
revoke all on public.tenants, public.platform_admins from anon, authenticated;
grant select on public.tenants, public.platform_admins to authenticated;
grant update (name, timezone) on public.tenants to authenticated;
revoke execute on function public.is_valid_timezone(text) from authenticated;

insert into public.tenants (name) values ('Hotzonex WiFi');
-- The people who run Hotzonex Cloud itself: today's admins.
insert into public.platform_admins (user_id)
select p.id from public.profiles p where p.role = 'admin' and p.is_active;

-- ---------------------------------------------------------------------------
-- 2. tenant_id on every business table, filled with today's business
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant uuid := (select id from public.tenants where name = 'Hotzonex WiFi');
  t text;
begin
  foreach t in array array['sites', 'plans', 'profiles', 'routers', 'vouchers', 'voucher_batches', 'sales',
                           'active_sessions', 'router_jobs', 'router_logins', 'portal_configs', 'audit_log'] loop
    execute format('alter table public.%I add column tenant_id uuid references public.tenants (id) on delete restrict', t);
    execute format('update public.%I set tenant_id = %L where tenant_id is null', t, v_tenant);
    if t <> 'audit_log' then
      execute format('alter table public.%I alter column tenant_id set not null', t);
    end if;
    execute format('create index %I on public.%I (tenant_id)', t || '_tenant_id_idx', t);
  end loop;
end
$$;

-- Names only need to be unique inside one business.
alter table public.sites drop constraint sites_name_key;
alter table public.sites add constraint sites_tenant_name_key unique (tenant_id, name);
alter table public.routers drop constraint routers_name_key;
alter table public.routers add constraint routers_tenant_name_key unique (tenant_id, name);
alter table public.plans drop constraint plans_name_key;
alter table public.plans add constraint plans_tenant_name_key unique (tenant_id, name);
alter table public.plans drop constraint plans_router_profile_name_key;
alter table public.plans add constraint plans_tenant_router_profile_name_key unique (tenant_id, router_profile_name);
