-- Phase 4: plan → router profile sync, batch push status, and push retries.

-- ---------------------------------------------------------------------------
-- Plans: a saved plan queues a sync_profiles job for every tested router so the
-- agent creates/updates the matching /ip/hotspot/user/profile.
-- ---------------------------------------------------------------------------

create or replace function public.plans_guard_profile_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.router_profile_name <> old.router_profile_name
     and exists (select 1 from public.vouchers v where v.plan_id = new.id) then
    raise exception 'The RouterOS profile name of plan % cannot change after vouchers were made for it.', old.name
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger plans_guard_profile_name
  before update on public.plans
  for each row execute function public.plans_guard_profile_name();

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
  where r.status <> 'pending'
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

create trigger plans_queue_profile_sync
  after insert or update on public.plans
  for each row execute function public.plans_queue_profile_sync();

revoke all on function public.plans_guard_profile_name() from public;
revoke all on function public.plans_queue_profile_sync() from public;

-- ---------------------------------------------------------------------------
-- Batch status: one row per batch with push progress and the latest push job.
-- security_invoker keeps the caller's RLS (admins all, managers own site).
-- ---------------------------------------------------------------------------

create index router_jobs_push_batch_idx
  on public.router_jobs ((payload->>'batch_id'), created_at desc)
  where type = 'push_vouchers';

create view public.voucher_batch_status
with (security_invoker = true)
as
select
  b.id,
  b.created_at,
  b.site_id,
  b.router_id,
  b.plan_id,
  b.quantity,
  b.code_length,
  b.created_by,
  b.note,
  s.name as site_name,
  r.name as router_name,
  p.name as plan_name,
  p.color as plan_color,
  p.price_ssp,
  p.uptime_seconds,
  coalesce(v.voucher_count, 0) as voucher_count,
  coalesce(v.pushed_count, 0) as pushed_count,
  j.status as push_status,
  j.result->>'error' as push_error,
  j.finished_at as push_finished_at
from public.voucher_batches b
join public.sites s on s.id = b.site_id
join public.routers r on r.id = b.router_id
join public.plans p on p.id = b.plan_id
left join lateral (
  select count(*)::integer as voucher_count,
         count(*) filter (where vv.on_router)::integer as pushed_count
  from public.vouchers vv
  where vv.batch_id = b.id
) v on true
left join lateral (
  select jj.status, jj.result, jj.finished_at
  from public.router_jobs jj
  where jj.type = 'push_vouchers' and jj.payload->>'batch_id' = b.id::text
  order by jj.created_at desc
  limit 1
) j on true;

revoke all on public.voucher_batch_status from anon;
grant select on public.voucher_batch_status to authenticated;

-- ---------------------------------------------------------------------------
-- queue_batch_push: (re)queue pushing a batch to its router. Safe to call any
-- number of times: returns the already-waiting job if there is one, and the
-- agent skips vouchers that are already on the router.
-- ---------------------------------------------------------------------------

create or replace function public.queue_batch_push(p_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
  v_batch public.voucher_batches%rowtype;
  v_job_id uuid;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can push vouchers.' using errcode = '42501';
  end if;

  select * into v_batch from public.voucher_batches where id = p_batch_id;
  if not found then
    raise exception 'Batch not found.' using errcode = 'P0002';
  end if;
  if not public.can_access_site(v_batch.site_id) then
    raise exception 'You can only push vouchers for your own site.' using errcode = '42501';
  end if;

  select j.id into v_job_id
  from public.router_jobs j
  where j.type = 'push_vouchers'
    and j.payload->>'batch_id' = p_batch_id::text
    and j.status in ('queued', 'running')
  limit 1;
  if v_job_id is not null then
    return v_job_id;
  end if;

  insert into public.router_jobs (router_id, type, payload, created_by)
  values (v_batch.router_id, 'push_vouchers', jsonb_build_object('batch_id', p_batch_id), auth.uid())
  returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.queue_batch_push(uuid) from public;
grant execute on function public.queue_batch_push(uuid) to authenticated;
