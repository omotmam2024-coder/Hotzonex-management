-- Router profiles the admin removed from Hotzonex without touching the router (MikroTicket's own
-- profiles): they stay on the router and are not turned into plans again. Making a plan from one
-- (Plans page, "Other profiles on your routers") brings it back.
create table public.router_profile_ignores (
  router_id uuid not null references public.routers (id) on delete cascade,
  profile_name text not null,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (router_id, profile_name)
);

create trigger aa_set_tenant before insert or update on public.router_profile_ignores
  for each row execute function public.set_row_tenant('router');

alter table public.router_profile_ignores enable row level security;
create policy tenant_isolation on public.router_profile_ignores as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy router_profile_ignores_select on public.router_profile_ignores for select to authenticated
  using ((select public.app_role()) is not null);
create policy router_profile_ignores_admin_insert on public.router_profile_ignores for insert to authenticated
  with check ((select public.is_admin()));
create policy router_profile_ignores_admin_remove on public.router_profile_ignores for delete to authenticated
  using ((select public.is_admin()));
revoke all on public.router_profile_ignores from anon;
grant select, insert, delete on public.router_profile_ignores to authenticated;

-- Unticking a router removes the profile from it only when Hotzonex made that profile.
create or replace function public.plan_routers_queue_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.managed then
      insert into public.router_jobs (router_id, type, payload, created_by)
      select new.router_id, 'sync_profiles', jsonb_build_object('plan_id', new.plan_id), auth.uid()
      from public.routers r where r.id = new.router_id and r.status <> 'pending';
    end if;
    return null;
  end if;

  -- Unticked: a profile Hotzonex made is removed from the router (kept while users are on it), if
  -- the router still has it. The router's own profiles (MikroTicket's) always stay.
  if old.managed
     and exists (
       select 1 from public.routers r
       where r.id = old.router_id and r.status <> 'pending'
         and exists (
           select 1 from jsonb_array_elements(case when jsonb_typeof(r.hotspot_info->'user_profiles') = 'array' then r.hotspot_info->'user_profiles' else '[]'::jsonb end) up
           where up->>'name' = old.profile_name))
     and exists (select 1 from public.plans p where p.id = old.plan_id) then
    insert into public.router_jobs (router_id, type, payload, created_by)
    values (old.router_id, 'sync_profiles',
            jsonb_build_object('remove_profile', old.profile_name, 'plan_id', old.plan_id, 'keep_plan', true), auth.uid());
  end if;
  return null;
end;
$$;

-- Profiles the admin removed from Hotzonex are not turned into plans again.
do $$
declare
  v_def text := pg_get_functiondef('public.plans_from_router_profiles'::regproc);
  v_old text := 'and not exists (select 1 from public.plan_routers pr where pr.router_id = new.id and pr.profile_name = q.name)';
  v_new text := 'and not exists (select 1 from public.plan_routers pr where pr.router_id = new.id and pr.profile_name = q.name)
      and not exists (select 1 from public.router_profile_ignores ig where ig.router_id = new.id and ig.profile_name = q.name)';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'plans_from_router_profiles: expected filter not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
