-- Audit trail for money and setup events (AUDIT.md §1, High).
--
-- audit_log already records router changes, staff creation, deletes and support visits (written by
-- the Edge Functions). It did not record sales, voids, voucher generation, plan or price changes,
-- staff role / access changes or cash handovers. One trigger function now writes those rows for
-- every path (app, router worker, mobile-money confirmation), so nothing depends on the screen used.
--
-- Who: auth.uid() (null when the router worker or a scheduled job made the change).
-- What: action + a small JSON of the facts. When: created_at. Which business: tenant_id.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_action text;
  v_details jsonb;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  if tg_table_name = 'sales' then
    if tg_op = 'INSERT' then
      v_action := 'sale.recorded';
      v_details := jsonb_build_object('sale_id', new.id, 'voucher_id', new.voucher_id, 'amount_ssp', new.amount_ssp,
        'payment_method', new.payment_method, 'seller_id', new.seller_id, 'site_id', new.site_id, 'router_id', new.router_id);
    elsif old.voided_at is null and new.voided_at is not null then
      v_action := 'sale.voided';
      v_details := jsonb_build_object('sale_id', new.id, 'voucher_id', new.voucher_id, 'amount_ssp', new.amount_ssp,
        'reason', new.void_reason, 'voided_by', new.voided_by);
    end if;

  elsif tg_table_name = 'voucher_batches' and tg_op = 'INSERT' then
    v_action := 'vouchers.generated';
    v_details := jsonb_build_object('batch_id', new.id, 'quantity', new.quantity, 'code_length', new.code_length,
      'plan_id', new.plan_id, 'router_id', new.router_id, 'site_id', new.site_id);

  elsif tg_table_name = 'plans' then
    if tg_op = 'INSERT' then
      v_action := 'plan.created';
      v_details := jsonb_build_object('plan_id', new.id, 'name', new.name, 'price_ssp', new.price_ssp);
    else
      foreach k in array array['name', 'price_ssp', 'uptime_seconds', 'validity_seconds', 'rate_limit', 'data_limit_mb', 'shared_users', 'is_active'] loop
        if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
          v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
        end if;
      end loop;
      if v_changes <> '{}'::jsonb then
        v_action := 'plan.updated';
        v_details := jsonb_build_object('plan_id', new.id, 'name', new.name, 'changes', v_changes);
      end if;
    end if;

  elsif tg_table_name = 'profiles' and tg_op = 'UPDATE' then
    foreach k in array array['role', 'is_active', 'site_id', 'commission_pct', 'credit_limit_ssp'] loop
      if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
      end if;
    end loop;
    if v_changes <> '{}'::jsonb then
      v_action := 'staff.changed';
      v_details := jsonb_build_object('staff_id', new.id, 'name', new.full_name, 'changes', v_changes);
    end if;

  elsif tg_table_name = 'cash_handovers' and tg_op = 'INSERT' then
    v_action := 'cash.received';
    v_details := jsonb_build_object('handover_id', new.id, 'seller_id', new.seller_id, 'amount_ssp', new.amount_ssp,
      'site_id', new.site_id, 'note', new.note);
  end if;

  if v_action is not null then
    insert into public.audit_log (user_id, action, details, tenant_id)
    values (auth.uid(), v_action, v_details, new.tenant_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

-- AFTER triggers: tenant_id has been filled in by the BEFORE triggers (aa_set_tenant).
drop trigger if exists zz_audit on public.sales;
create trigger zz_audit after insert or update of voided_at on public.sales
  for each row execute function public.audit_row_change();

drop trigger if exists zz_audit on public.voucher_batches;
create trigger zz_audit after insert on public.voucher_batches
  for each row execute function public.audit_row_change();

drop trigger if exists zz_audit on public.plans;
create trigger zz_audit after insert or update on public.plans
  for each row execute function public.audit_row_change();

drop trigger if exists zz_audit on public.profiles;
create trigger zz_audit after update on public.profiles
  for each row execute function public.audit_row_change();

drop trigger if exists zz_audit on public.cash_handovers;
create trigger zz_audit after insert on public.cash_handovers
  for each row execute function public.audit_row_change();

-- The audit page and exports filter by business, action and time.
create index if not exists audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);
