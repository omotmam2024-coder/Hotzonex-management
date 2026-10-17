-- Consistency fixes from the 17 October review.
--
-- 1. Audit log without duplicates: void_sale already logs 'sale.voided' (with the voucher code),
--    and staff / plan changes made by Edge Functions (create-staff, the item remover, the router worker)
--    are logged by those functions with the real caller. The audit trigger no longer writes a
--    second row for these. (The sales trigger still fires on voids; the function ignores them.)
-- 2. sell_voucher: when the same sale attempt arrives twice at the same moment, the second call
--    returns the sale only if it belongs to the same cashier (as the first lookup already did).
-- 3. Two pure helper functions are not callable by signed-in users (they never needed to be).

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
  -- Staff and plan changes made by an Edge Function (service role, no signed-in user) are logged
  -- by that function with the real caller, so they are not written twice.
  if tg_table_name in ('profiles', 'plans') and auth.uid() is null then
    return null;
  end if;

  if tg_table_name = 'sales' then
    -- Voids are logged by void_sale (with the voucher code), so only new sales are written here.
    if tg_op = 'INSERT' then
      v_action := 'sale.recorded';
      v_details := jsonb_build_object('sale_id', new.id, 'voucher_id', new.voucher_id, 'amount_ssp', new.amount_ssp,
        'payment_method', new.payment_method, 'seller_id', new.seller_id, 'site_id', new.site_id, 'router_id', new.router_id);
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
    foreach k in array array['role', 'is_active', 'site_id'] loop
      if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
      end if;
    end loop;
    if v_changes <> '{}'::jsonb then
      v_action := 'staff.changed';
      v_details := jsonb_build_object('staff_id', new.id, 'name', new.full_name, 'changes', v_changes);
    end if;
  end if;

  if v_action is not null then
    insert into public.audit_log (user_id, action, details, tenant_id)
    values (auth.uid(), v_action, v_details, new.tenant_id);
  end if;
  return null;
end;
$$;

do $$
declare
  v_def text := pg_get_functiondef('public.sell_voucher(uuid, uuid, uuid)'::regprocedure);
  v_old text := 'where s.tenant_id = v_tenant and s.request_id = p_request_id;';
  v_new text := 'where s.tenant_id = v_tenant and s.request_id = p_request_id and s.seller_id = auth.uid();';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'sell_voucher: retry lookup not found';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

revoke execute on function public.router_own_profiles(jsonb) from public, anon, authenticated;
revoke execute on function public.profile_key(text) from public, anon, authenticated;
