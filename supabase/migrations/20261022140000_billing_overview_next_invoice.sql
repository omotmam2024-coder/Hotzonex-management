-- The owner's Billing page shows the real price (the business's own price, else its subscription
-- plan's price, else the standard price, as the monthly invoice uses), the plan's name, the business
-- name for printed invoices, and when the next invoice comes and how much it will be.

do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.billing_overview()'::regprocedure);

  v_old := '''price_per_router_ssp'', coalesce(b.price_per_router_ssp, v_std),';
  v_new := '''price_per_router_ssp'', coalesce(b.price_per_router_ssp, (select sp.price_per_router_ssp from public.subscription_plans sp where sp.id = b.plan_id), v_std),'
    || E'\n    ''plan_name'', (select sp.name from public.subscription_plans sp where sp.id = b.plan_id),'
    || E'\n    ''business_name'', (select t.name from public.tenants t where t.id = v_tenant),'
    || E'\n    ''next_invoice_on'', case when coalesce(b.exempt, true) then null'
    || E'\n      when b.status = ''trial'' and b.trial_ends_at is not null then (b.trial_ends_at at time zone ''Africa/Juba'')::date'
    || E'\n      else coalesce((select max(i.period_end) + 1 from public.invoices i where i.tenant_id = v_tenant and i.status <> ''void''), (now() at time zone ''Africa/Juba'')::date) end,'
    || E'\n    ''next_invoice_amount'', case when coalesce(b.exempt, true) then null'
    || E'\n      else greatest((select count(*) from public.routers r where r.tenant_id = v_tenant and r.status <> ''pending''), 1)'
    || E'\n        * coalesce(b.price_per_router_ssp, (select sp.price_per_router_ssp from public.subscription_plans sp where sp.id = b.plan_id), v_std) end,';
  if position(v_old in v_def) = 0 then raise exception 'billing_overview: price line not found'; end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
