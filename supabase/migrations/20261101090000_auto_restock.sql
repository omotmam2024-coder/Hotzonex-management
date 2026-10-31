-- Automatic restocking (opt-in): "keep at least N cards of this plan on this router; when fewer are left,
-- make M more and put them on the router". The owner sets a rule per router and plan.
--
--   restock_rules              one row per (router, plan)
--   save_restock_rule(...)     owner only: add (p_id null) or change a rule
--   remove_restock_rule(p_id)  owner only
--   run_restock()              run every 10 minutes by pg_cron
--
-- Safety, all enforced here:
--   * only for an ONLINE router of an active site, an active plan and an active business;
--   * nothing while a card push for that router is still waiting (cards not yet on the router count as stock);
--   * at most one batch per rule every 30 minutes and 2000 cards per rule in 24 hours;
--   * the subscription's monthly voucher limit still applies (the batch insert is refused over it): the owner
--     gets one alert a day per rule instead of silent retries;
--   * the batches are marked note = 'auto-restock' (created_by is empty) and logged in the audit trail;
--   * at most 20 rules per business.
-- Undo: select cron.unschedule('hzc-restock'); drop function public.run_restock(); drop function public.remove_restock_rule(uuid);
--       drop function public.save_restock_rule(uuid, uuid, uuid, integer, integer, boolean); drop table public.restock_rules;

create table public.restock_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  router_id uuid not null references public.routers (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete cascade,
  keep_min integer not null check (keep_min between 1 and 1000),
  add_quantity integer not null check (add_quantity between 1 and 1000),
  is_active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  constraint restock_one_rule_per_router_plan unique (router_id, plan_id)
);
create index restock_rules_tenant on public.restock_rules (tenant_id);

alter table public.restock_rules enable row level security;
create policy tenant_isolation on public.restock_rules as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy restock_rules_read on public.restock_rules for select to authenticated
  using ((select public.app_role()) = 'admin');
revoke all on public.restock_rules from anon, authenticated;
grant select on public.restock_rules to authenticated;
grant all on public.restock_rules to service_role;

create or replace function public.save_restock_rule(
  p_id uuid, p_router_id uuid, p_plan_id uuid, p_keep_min integer, p_add_quantity integer, p_is_active boolean
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_id uuid;
begin
  if v_tenant is null or public.app_role() is distinct from 'admin' then
    raise exception 'Only the business owner can set up automatic restocking.' using errcode = '42501';
  end if;
  if p_keep_min is null or p_keep_min not between 1 and 1000 then
    raise exception 'Keep at least: type a number from 1 to 1000.' using errcode = '22023';
  end if;
  if p_add_quantity is null or p_add_quantity not between 1 and 1000 then
    raise exception 'Cards to add each time: type a number from 1 to 1000.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.routers where id = p_router_id and tenant_id = v_tenant) then
    raise exception 'Router not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id and tenant_id = v_tenant and is_active) then
    raise exception 'This plan does not exist or is switched off.' using errcode = 'P0002';
  end if;
  if p_id is null and (select count(*) from public.restock_rules where tenant_id = v_tenant) >= 20 then
    raise exception 'You can have at most 20 automatic restock rules.' using errcode = '54000';
  end if;

  begin
    if p_id is null then
      insert into public.restock_rules (tenant_id, router_id, plan_id, keep_min, add_quantity, is_active)
      values (v_tenant, p_router_id, p_plan_id, p_keep_min, p_add_quantity, coalesce(p_is_active, true))
      returning id into v_id;
    else
      update public.restock_rules
      set router_id = p_router_id, plan_id = p_plan_id, keep_min = p_keep_min, add_quantity = p_add_quantity, is_active = coalesce(p_is_active, true)
      where id = p_id and tenant_id = v_tenant
      returning id into v_id;
      if v_id is null then
        raise exception 'Rule not found.' using errcode = 'P0002';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'There is already a rule for this router and plan.' using errcode = '23505';
  end;

  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), case when p_id is null then 'restock.create' else 'restock.update' end,
          jsonb_build_object('rule_id', v_id, 'router_id', p_router_id, 'plan_id', p_plan_id, 'keep_min', p_keep_min, 'add_quantity', p_add_quantity, 'active', coalesce(p_is_active, true)), v_tenant);
  return v_id;
end;
$$;
revoke all on function public.save_restock_rule(uuid, uuid, uuid, integer, integer, boolean) from public, anon;
grant execute on function public.save_restock_rule(uuid, uuid, uuid, integer, integer, boolean) to authenticated;

create or replace function public.remove_restock_rule(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
begin
  if v_tenant is null or public.app_role() is distinct from 'admin' then
    raise exception 'Only the business owner can remove restock rules.' using errcode = '42501';
  end if;
  delete from public.restock_rules where id = p_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Rule not found.' using errcode = 'P0002';
  end if;
  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), 'restock.remove', jsonb_build_object('rule_id', p_id), v_tenant);
end;
$$;
revoke all on function public.remove_restock_rule(uuid) from public, anon;
grant execute on function public.remove_restock_rule(uuid) to authenticated;

create or replace function public.run_restock()
returns integer
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  r record;
  v_stock integer;
  v_today integer;
  v_len integer;
  v_batch uuid;
  v_inserted integer;
  v_rows integer;
  v_rounds integer;
  v_made integer := 0;
  v_day text := to_char(now(), 'YYYY-MM-DD');
begin
  for r in
    select rr.id as rule_id, rr.tenant_id, rr.router_id, rr.plan_id, rr.keep_min, rr.add_quantity,
           ro.name as router_name, ro.site_id, pl.name as plan_name
    from public.restock_rules rr
    join public.routers ro on ro.id = rr.router_id and ro.status = 'online'
    join public.sites st on st.id = ro.site_id and st.is_active
    join public.plans pl on pl.id = rr.plan_id and pl.is_active
    join public.tenants t on t.id = rr.tenant_id and t.is_active
    where rr.is_active and (rr.last_run_at is null or rr.last_run_at < now() - interval '30 minutes')
    order by rr.created_at
    limit 50
  loop
    -- Cards that exist but are not on the router yet count as stock, so a slow push never doubles a batch.
    select count(*) into v_stock from public.vouchers v
    where v.router_id = r.router_id and v.plan_id = r.plan_id and v.status = 'unused' and v.printed_at is null;
    continue when v_stock >= r.keep_min;
    continue when exists (select 1 from public.router_jobs j where j.router_id = r.router_id and j.type = 'push_vouchers' and j.status in ('queued', 'running'));

    select coalesce(sum(b.quantity), 0) into v_today from public.voucher_batches b
    where b.router_id = r.router_id and b.plan_id = r.plan_id and b.note = 'auto-restock' and b.created_at > now() - interval '24 hours';
    if v_today + r.add_quantity > 2000 then
      update public.restock_rules set last_run_at = now() where id = r.rule_id;
      perform public.raise_alert(r.tenant_id, 'push_warning', 'restock_cap:' || r.rule_id || ':' || v_day,
        'Automatic restock paused: ' || r.plan_name || ' on ' || r.router_name,
        'It already added ' || v_today || ' cards in the last 24 hours (the limit is 2000). Check that cards are really being sold, or restock by hand.', r.site_id, r.router_id);
      continue;
    end if;

    begin
      v_len := public.router_code_length(r.router_id);
      insert into public.voucher_batches (site_id, router_id, plan_id, quantity, code_length, created_by, note)
      values (r.site_id, r.router_id, r.plan_id, r.add_quantity, v_len, null, 'auto-restock')
      returning id into v_batch;

      v_inserted := 0;
      v_rounds := 0;
      loop
        insert into public.vouchers (batch_id, router_id, site_id, plan_id, code)
        select v_batch, r.router_id, r.site_id, r.plan_id, g.code
        from (select public.random_numeric_code(v_len) as code from generate_series(1, r.add_quantity - v_inserted)) g
        where not exists (select 1 from public.router_logins l where l.router_id = r.router_id and l.username = g.code)
        on conflict on constraint vouchers_code_per_router do nothing;
        get diagnostics v_rows = row_count;
        v_inserted := v_inserted + v_rows;
        exit when v_inserted >= r.add_quantity;
        v_rounds := v_rounds + 1;
        if v_rounds >= 25 then
          raise exception 'Could not find enough unused % digit codes.', v_len;
        end if;
      end loop;

      insert into public.router_jobs (router_id, type, payload, created_by)
      values (r.router_id, 'push_vouchers', jsonb_build_object('batch_id', v_batch), null);

      update public.restock_rules set last_run_at = now() where id = r.rule_id;
      perform public.raise_alert(r.tenant_id, 'report', 'restock:' || v_batch,
        'Automatic restock: ' || r.add_quantity || ' × ' || r.plan_name || ' added to ' || r.router_name,
        'Only ' || v_stock || ' were left (you asked to keep at least ' || r.keep_min || ').', r.site_id, r.router_id);
      v_made := v_made + 1;
    exception when others then
      -- Nothing from this attempt is kept (the plan's monthly voucher limit, a full code space, ...).
      update public.restock_rules set last_run_at = now() where id = r.rule_id;
      perform public.raise_alert(r.tenant_id, 'push_warning', 'restock_failed:' || r.rule_id || ':' || v_day,
        'Automatic restock could not add ' || r.plan_name || ' to ' || r.router_name, sqlerrm, r.site_id, r.router_id);
    end;
  end loop;
  if v_made > 0 or exists (select 1 from public.alerts where sent_at is null and send_attempts < 5 and created_at > now() - interval '1 hour') then
    perform public.wake_alerts_sender();
  end if;
  return v_made;
end;
$$;
revoke all on function public.run_restock() from public, anon, authenticated;
grant execute on function public.run_restock() to service_role;

select cron.schedule('hzc-restock', '*/10 * * * *', 'select public.run_restock()');
