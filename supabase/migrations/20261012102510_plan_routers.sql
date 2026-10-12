-- Which routers carry a plan, and the plan's user profile name on each router. Routers made by
-- MikroTicket can differ in the profile name for the same plan (e.g. another validity), so the
-- name is kept per router. managed = Hotzonex made the profile from the plan (and keeps it in step).
create table public.plan_routers (
  plan_id uuid not null references public.plans (id) on delete cascade,
  router_id uuid not null references public.routers (id) on delete cascade,
  profile_name text not null check (
    profile_name !~ '[[:cntrl:]]' and length(profile_name) between 1 and 200 and profile_name = btrim(profile_name)
  ),
  managed boolean not null default false,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (plan_id, router_id),
  unique (router_id, profile_name)
);
create index plan_routers_router_idx on public.plan_routers (router_id);

create trigger aa_set_tenant before insert or update on public.plan_routers
  for each row execute function public.set_row_tenant('router');

alter table public.plan_routers enable row level security;
create policy tenant_isolation on public.plan_routers as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy plan_routers_select on public.plan_routers for select to authenticated
  using ((select public.app_role()) is not null);
create policy plan_routers_admin_insert on public.plan_routers for insert to authenticated
  with check ((select public.is_admin()));
create policy plan_routers_admin_update on public.plan_routers for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy plan_routers_admin_remove on public.plan_routers for delete to authenticated
  using ((select public.is_admin()));
revoke all on public.plan_routers from anon;
grant select, insert, update, delete on public.plan_routers to authenticated;

-- MikroTicket's label and price in a profile name ("profile_1Hr-se:-co:1000-…" → "1Hr|1000"), or null.
create or replace function public.profile_key(p_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when substring(p_name from '^profile_(.+?)-se:') is not null
                and substring(p_name from '-co:([0-9]{1,9})(?:\.[0-9]+)?(?![0-9])') is not null
         then substring(p_name from '^profile_(.+?)-se:') || '|' || (substring(p_name from '-co:([0-9]{1,9})(?:\.[0-9]+)?(?![0-9])'))::bigint
    end
$$;

-- Links for today's plans: every router that has the plan's profile, or one with the same MikroTicket label and price.
insert into public.plan_routers (plan_id, router_id, profile_name, managed, tenant_id)
select distinct on (p.id, r.id) p.id, r.id, up->>'name', false, p.tenant_id
from public.plans p
join public.routers r on r.tenant_id = p.tenant_id
cross join lateral jsonb_array_elements(case when jsonb_typeof(r.hotspot_info->'user_profiles') = 'array' then r.hotspot_info->'user_profiles' else '[]'::jsonb end) up
where up->>'name' = p.router_profile_name
   or (public.profile_key(up->>'name') is not null and public.profile_key(up->>'name') = public.profile_key(p.router_profile_name))
order by p.id, r.id, (up->>'name' = p.router_profile_name) desc
on conflict do nothing;
