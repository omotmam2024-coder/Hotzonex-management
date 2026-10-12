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

  -- Unticked: removed from the router only if the router still has the profile (a profile already
  -- gone from the router, a router or plan being removed: nothing to do).
  if exists (
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
