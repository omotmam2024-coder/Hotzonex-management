-- Billing fixes found in review.
-- 1. A business was switched off on the morning of the day its invoice said it was due (due_at is
--    the start of that day). It is now switched off only once the due day is over.
-- 2. A voided invoice came back the next morning (the next invoice was counted from the last
--    invoice that was not void). The voided month now stays forgiven.
do $$
declare
  v_def text := pg_get_functiondef('public.billing_run'::regproc);
  v_new text;
begin
  v_new := replace(v_def,
    'select * into v_last from public.invoices where tenant_id = b.tenant_id and status <> ''void'' order by period_end desc limit 1;',
    'select * into v_last from public.invoices where tenant_id = b.tenant_id order by period_end desc, created_at desc limit 1;');
  v_new := replace(v_new,
    'if v_inv.due_at < now() then',
    'if v_inv.due_at + interval ''1 day'' < now() then');
  if v_new = v_def or strpos(v_new, 'status <> ''void'' order by period_end') > 0 or strpos(v_new, 'v_inv.due_at + interval ''1 day'' < now()') = 0 then
    raise exception 'billing_run: expected text not found';
  end if;
  execute v_new;
end;
$$;

-- 3. A business added by a platform admin got no free trial and was invoiced the next morning.
--    New businesses now start with the same trial as self sign-ups.
create or replace function public.tenants_add_billing()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_days integer := least(greatest(coalesce(nullif(public.billing_config('billing_trial_days', '14'), '')::integer, 14), 0), 90);
begin
  insert into public.tenant_billing (tenant_id, status, trial_ends_at)
  values (new.id, case when v_days > 0 then 'trial' else 'active' end, case when v_days > 0 then now() + make_interval(days => v_days) end)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

-- 4. Marking a paused business "Not billed" left it switched off. It is now switched back on.
do $$
declare
  v_def text := pg_get_functiondef('public.platform_set_business_billing'::regproc);
  v_new text;
begin
  v_new := replace(v_def,
    '  where tenant_id = p_tenant_id;
end;',
    '  where tenant_id = p_tenant_id;
  -- Not billed any more: a business paused for an unpaid invoice is switched back on.
  if p_exempt then
    update public.tenant_billing set status = ''active'', suspended_at = null, updated_at = now()
    where tenant_id = p_tenant_id and status = ''suspended'';
    if found then
      update public.tenants set is_active = true where id = p_tenant_id;
    end if;
  end if;
end;');
  if v_new = v_def then
    raise exception 'platform_set_business_billing: expected text not found';
  end if;
  execute v_new;
end;
$$;
