-- Plans follow the router: every MikroTicket-style user profile found on a router (with a price
-- and a time in its name) becomes a plan of that business automatically. Hotzonex adds its own
-- profiles to a router only when the router has no profiles of its own.

-- Profiles the router owner made (not RouterOS's "default", not one Hotzonex added).
create or replace function public.router_own_profiles(p_info jsonb)
returns setof text
language sql
immutable
set search_path = pg_catalog
as $$
  select up->>'name'
  from jsonb_array_elements(case when jsonb_typeof(p_info->'user_profiles') = 'array' then p_info->'user_profiles' else '[]'::jsonb end) up
  where coalesce(up->>'name', '') not in ('', 'default') and up->>'name' not like 'hzc-%'
$$;

create or replace function public.plans_from_router_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_colors text[] := array['#16a34a', '#2563eb', '#dc2626', '#f59e0b', '#7c3aed', '#db2777', '#0891b2', '#475569'];
begin
  if new.hotspot_info is null
     or (tg_op = 'UPDATE' and new.hotspot_info->'user_profiles' is not distinct from old.hotspot_info->'user_profiles') then
    return null;
  end if;

  insert into public.plans (tenant_id, name, price_ssp, uptime_seconds, validity_seconds, rate_limit, shared_users, color, router_profile_name, is_active)
  select new.tenant_id, x.label, x.price, x.uptime, x.validity, x.rate, x.shared, v_colors[1 + abs(hashtext(x.name)) % 8], x.name, true
  from (
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
  ) x
  where x.label is not null and length(trim(x.label)) between 1 and 40
    and x.price > 0 and x.uptime > 0
    and not exists (select 1 from public.plans pl where pl.tenant_id = new.tenant_id and pl.router_profile_name = x.name)
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.plans_from_router_profiles() from public, anon, authenticated;

create trigger plans_from_router_profiles after insert or update of hotspot_info on public.routers
  for each row execute function public.plans_from_router_profiles();

-- A plan change only goes to routers of its own business that have no profiles of their own.
create or replace function public.plans_queue_profile_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.rate_limit is not distinct from old.rate_limit
     and new.shared_users = old.shared_users
     and new.router_profile_name = old.router_profile_name then
    return new;
  end if;

  insert into public.router_jobs (router_id, type, payload, created_by)
  select r.id, 'sync_profiles', jsonb_build_object('plan_id', new.id), auth.uid()
  from public.routers r
  where r.tenant_id = new.tenant_id
    and r.status <> 'pending'
    and not exists (select 1 from public.router_own_profiles(r.hotspot_info))
    and not exists (
      select 1 from public.router_jobs j
      where j.router_id = r.id
        and j.type = 'sync_profiles'
        and j.status = 'queued'
        and (j.payload->>'plan_id' = new.id::text or not (j.payload ? 'plan_id'))
    );
  return new;
end;
$$;
