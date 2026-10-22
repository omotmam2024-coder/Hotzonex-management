-- Owners can remove a router or a plan completely, even when it has vouchers and sales, so the
-- app stays neat. This also erases those sales from every report and cash-up, so it is for owners
-- only (support mode included), needs the name typed, and leaves a line in the audit log.
--   removal_preview(kind, id)      what would go (no change)
--   force_remove_router(id, name)  the router, its vouchers, batches, sales, router logins, jobs;
--                                  plans that were only on this router and have nothing left go too
--   force_remove_plan(id, name)    the plan, its vouchers, batches, sales and payment requests; its
--                                  unsold cards and its Hotzonex profile are removed from the routers

create or replace function public.removal_preview(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.app_tenant_id();
begin
  if public.app_role() is distinct from 'admin' or v_tenant is null then
    raise exception 'Only the owner can remove things for good.' using errcode = '42501';
  end if;
  if p_kind = 'router' then
    if not exists (select 1 from public.routers where id = p_id and tenant_id = v_tenant) then
      raise exception 'Router not found.' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
      'name', (select name from public.routers where id = p_id),
      'vouchers', (select count(*) from public.vouchers where router_id = p_id),
      'batches', (select count(*) from public.voucher_batches where router_id = p_id),
      'sales', (select count(*) from public.sales where router_id = p_id),
      'revenue', (select coalesce(sum(amount_ssp), 0) from public.sales where router_id = p_id and voided_at is null),
      'router_logins', (select count(*) from public.router_logins where router_id = p_id),
      'plans_only_here', (select count(*) from public.plan_routers pr where pr.router_id = p_id
                            and not exists (select 1 from public.plan_routers o where o.plan_id = pr.plan_id and o.router_id <> p_id)));
  elsif p_kind = 'plan' then
    if not exists (select 1 from public.plans where id = p_id and tenant_id = v_tenant) then
      raise exception 'This plan no longer exists.' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
      'name', (select name from public.plans where id = p_id),
      'vouchers', (select count(*) from public.vouchers where plan_id = p_id),
      'batches', (select count(*) from public.voucher_batches where plan_id = p_id),
      'sales', (select count(*) from public.sales where plan_id = p_id),
      'revenue', (select coalesce(sum(amount_ssp), 0) from public.sales where plan_id = p_id and voided_at is null),
      'unsold_on_routers', (select count(*) from public.vouchers where plan_id = p_id and status = 'unused' and on_router));
  end if;
  raise exception 'Unknown item.' using errcode = '22023';
end;
$$;

create or replace function public.force_remove_router(p_router_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_router public.routers%rowtype;
  v_counts jsonb;
  v_plans uuid[];
  v_plans_removed integer := 0;
begin
  if public.app_role() is distinct from 'admin' or v_tenant is null then
    raise exception 'Only the owner can remove things for good.' using errcode = '42501';
  end if;
  select * into v_router from public.routers where id = p_router_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Router not found.' using errcode = 'P0002';
  end if;
  if lower(btrim(coalesce(p_name, ''))) <> lower(btrim(v_router.name)) then
    raise exception 'Type the name exactly to remove it for good.' using errcode = '22023';
  end if;

  v_counts := public.removal_preview('router', p_router_id);
  select coalesce(array_agg(plan_id), '{}') into v_plans from public.plan_routers where router_id = p_router_id;

  delete from public.sales where router_id = p_router_id;
  delete from public.vouchers where router_id = p_router_id;
  delete from public.voucher_batches where router_id = p_router_id;
  delete from public.router_logins where router_id = p_router_id;
  delete from public.router_jobs where router_id = p_router_id;
  delete from public.routers where id = p_router_id;

  -- Plans that were only on this router and have nothing left anywhere.
  with gone as (
    delete from public.plans p
    where p.id = any (v_plans) and p.tenant_id = v_tenant
      and not exists (select 1 from public.plan_routers pr where pr.plan_id = p.id)
      and not exists (select 1 from public.vouchers v where v.plan_id = p.id)
      and not exists (select 1 from public.voucher_batches b where b.plan_id = p.id)
      and not exists (select 1 from public.sales s where s.plan_id = p.id)
      and not exists (select 1 from public.payment_requests r where r.plan_id = p.id)
    returning 1)
  select count(*) into v_plans_removed from gone;

  v_counts := v_counts || jsonb_build_object('plans_removed', v_plans_removed);
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_tenant, auth.uid(), 'router.force_removed', v_counts || jsonb_build_object('router_id', p_router_id));
  return v_counts;
end;
$$;

create or replace function public.force_remove_plan(p_plan_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_plan public.plans%rowtype;
  v_counts jsonb;
begin
  if public.app_role() is distinct from 'admin' or v_tenant is null then
    raise exception 'Only the owner can remove things for good.' using errcode = '42501';
  end if;
  select * into v_plan from public.plans where id = p_plan_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'This plan no longer exists.' using errcode = 'P0002';
  end if;
  if lower(btrim(coalesce(p_name, ''))) <> lower(btrim(v_plan.name)) then
    raise exception 'Type the name exactly to remove it for good.' using errcode = '22023';
  end if;

  v_counts := public.removal_preview('plan', p_plan_id);

  -- The routers remove the plan's unsold cards (200 per job) and the profile Hotzonex made.
  insert into public.router_jobs (router_id, type, payload, created_by)
  select c.router_id, 'disable_voucher',
         jsonb_build_object('delete', true, 'vouchers', jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code))),
         auth.uid()
  from (
    select v.router_id, v.id, v.code, (row_number() over (partition by v.router_id order by v.code) - 1) / 200 as chunk
    from public.vouchers v
    join public.routers r on r.id = v.router_id and r.status <> 'pending'
    where v.plan_id = p_plan_id and v.status = 'unused' and v.on_router
  ) c
  group by c.router_id, c.chunk;

  insert into public.router_jobs (router_id, type, payload, created_by)
  select pr.router_id, 'sync_profiles', jsonb_build_object('remove_profile', pr.profile_name, 'plan_id', p_plan_id, 'keep_plan', true), auth.uid()
  from public.plan_routers pr
  join public.routers r on r.id = pr.router_id and r.status <> 'pending'
  where pr.plan_id = p_plan_id and pr.managed;

  delete from public.payment_requests where plan_id = p_plan_id;
  delete from public.sales where plan_id = p_plan_id;
  delete from public.vouchers where plan_id = p_plan_id;
  delete from public.voucher_batches where plan_id = p_plan_id;
  delete from public.plans where id = p_plan_id;

  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_tenant, auth.uid(), 'plan.force_removed', v_counts || jsonb_build_object('plan_id', p_plan_id));
  return v_counts;
end;
$$;

revoke all on function public.removal_preview(text, uuid), public.force_remove_router(uuid, text), public.force_remove_plan(uuid, text) from public, anon;
grant execute on function public.removal_preview(text, uuid), public.force_remove_router(uuid, text), public.force_remove_plan(uuid, text) to authenticated;
