-- Profiles found on a router become plans and links: a profile already linked is skipped; one
-- with the same name or the same MikroTicket label and price as a plan is linked to that plan;
-- otherwise a new plan is made (priced profiles only).
create or replace function public.plans_from_router_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_colors text[] := array['#16a34a', '#2563eb', '#dc2626', '#f59e0b', '#7c3aed', '#db2777', '#0891b2', '#475569'];
  x record;
  v_plan uuid;
begin
  if new.hotspot_info is null
     or (tg_op = 'UPDATE' and new.hotspot_info->'user_profiles' is not distinct from old.hotspot_info->'user_profiles') then
    return null;
  end if;

  for x in
    select q.* from (
      select p.name,
             substring(p.name from '^profile_(.+?)-se:') as label,
             nullif(substring(p.name from '-co:([0-9]{1,9})(?:\.[0-9]+)?(?![0-9])'), '')::integer as price,
             (select (m[1])::integer * 86400 + (m[2])::integer * 3600 + (m[3])::integer * 60 + (m[4])::integer
                from regexp_match(p.name, '-ut:([0-9]{1,4})d ([0-9]{1,2}):([0-9]{2}):([0-9]{2})') m) as uptime,
             (select nullif((m[1])::integer * 86400 + (m[2])::integer * 3600 + (m[3])::integer * 60 + (m[4])::integer, 0)
                from regexp_match(p.name, '-vl:([0-9]{1,4})d ([0-9]{1,2}):([0-9]{2}):([0-9]{2})') m) as validity,
             case when p.rate ~ '^[0-9]+[kKmMgG]?/[0-9]+[kKmMgG]?$' then p.rate end as rate,
             case when p.shared ~ '^[0-9]{1,2}$' and p.shared::integer between 1 and 50 then p.shared::integer else 1 end as shared
      from (
        select up->>'name' as name, coalesce(up->>'rate_limit', '') as rate, coalesce(up->>'shared_users', '') as shared
        from jsonb_array_elements(case when jsonb_typeof(new.hotspot_info->'user_profiles') = 'array' then new.hotspot_info->'user_profiles' else '[]'::jsonb end) up
      ) p
    ) q
    where coalesce(q.name, '') <> ''
      and not exists (select 1 from public.plan_routers pr where pr.router_id = new.id and pr.profile_name = q.name)
  loop
    select pl.id into v_plan
    from public.plans pl
    where pl.tenant_id = new.tenant_id
      and (pl.router_profile_name = x.name
           or (public.profile_key(x.name) is not null and public.profile_key(pl.router_profile_name) = public.profile_key(x.name)))
    order by (pl.router_profile_name = x.name) desc
    limit 1;

    if v_plan is null and x.label is not null and length(trim(x.label)) between 1 and 40 and x.price > 0 and x.uptime > 0 then
      insert into public.plans (tenant_id, name, price_ssp, uptime_seconds, validity_seconds, rate_limit, shared_users, color, router_profile_name, is_active)
      values (new.tenant_id, x.label, x.price, x.uptime, x.validity, x.rate, x.shared, v_colors[1 + abs(hashtext(x.name)) % 8], x.name, true)
      on conflict do nothing
      returning id into v_plan;
    end if;

    if v_plan is not null then
      insert into public.plan_routers (plan_id, router_id, profile_name, managed, tenant_id)
      values (v_plan, new.id, x.name, false, new.tenant_id)
      on conflict do nothing;
    end if;
    v_plan := null;
  end loop;
  return null;
end;
$$;
revoke all on function public.plans_from_router_profiles() from public, anon, authenticated;

-- A plan's settings changed: the routers where Hotzonex made its profile bring it in step.
create or replace function public.plans_queue_profile_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE'
     or (new.rate_limit is not distinct from old.rate_limit
         and new.shared_users = old.shared_users
         and new.name = old.name
         and new.price_ssp = old.price_ssp
         and new.uptime_seconds = old.uptime_seconds
         and new.validity_seconds is not distinct from old.validity_seconds) then
    return new;
  end if;

  insert into public.router_jobs (router_id, type, payload, created_by)
  select pr.router_id, 'sync_profiles', jsonb_build_object('plan_id', new.id), auth.uid()
  from public.plan_routers pr
  join public.routers r on r.id = pr.router_id
  where pr.plan_id = new.id
    and pr.managed
    and r.status <> 'pending'
    and not exists (
      select 1 from public.router_jobs j
      where j.router_id = pr.router_id and j.type = 'sync_profiles' and j.status = 'queued'
        and j.payload->>'plan_id' = new.id::text and not (j.payload ? 'remove_profile')
    );
  return new;
end;
$$;

-- A router ticked for a plan: Hotzonex makes the profile there. Unticked: the profile is removed
-- from that router (kept while hotspot users are on it). Final version in plan_routers_unlink_only_present.
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

  if exists (select 1 from public.routers r where r.id = old.router_id and r.status <> 'pending')
     and exists (select 1 from public.plans p where p.id = old.plan_id) then
    insert into public.router_jobs (router_id, type, payload, created_by)
    values (old.router_id, 'sync_profiles',
            jsonb_build_object('remove_profile', old.profile_name, 'plan_id', old.plan_id, 'keep_plan', true), auth.uid());
  end if;
  return null;
end;
$$;
revoke all on function public.plan_routers_queue_sync() from public, anon, authenticated;

create trigger plan_routers_queue_sync after insert or delete on public.plan_routers
  for each row execute function public.plan_routers_queue_sync();

-- Router logins (MikroTicket vouchers) find their plan through the router's own profile name.
do $$
declare
  v_def text := pg_get_functiondef('public.record_router_logins'::regproc);
  v_old text := 'left join public.plans p on p.tenant_id = v_router.tenant_id and p.router_profile_name = u.profile';
  v_new text := 'left join lateral (
      select pl.id, pl.price_ssp from public.plans pl
      left join public.plan_routers pr on pr.plan_id = pl.id and pr.router_id = p_router_id
      where pl.tenant_id = v_router.tenant_id and (pr.profile_name = u.profile or pl.router_profile_name = u.profile)
      order by (pr.profile_name = u.profile) desc nulls last
      limit 1
    ) p on true';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'record_router_logins: expected plan lookup not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
