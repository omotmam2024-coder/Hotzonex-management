-- What businesses pay Hotzonex Cloud can be shown in dollars next to South Sudanese Pounds.
-- One platform-wide rate (SSP for 1 US dollar), set by a platform admin under
-- Businesses → Billing for Hotzonex Cloud. Empty = no dollar amounts are shown.
-- The rate reaches the landing page prices, the business's own Billing page and invoices, the
-- platform billing screen and (through the alerts function) the billing messages.

insert into public.app_config (key, value) values ('billing_usd_rate', '')
on conflict (key) do nothing;

create or replace function public.platform_set_billing_usd_rate(p_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can change billing.' using errcode = '42501';
  end if;
  if p_rate is not null and p_rate <> 0 and (p_rate < 1 or p_rate > 1000000) then
    raise exception 'The dollar rate is how many pounds one US dollar costs (for example 4500).' using errcode = '22023';
  end if;
  insert into public.app_config (key, value)
  values ('billing_usd_rate', case when p_rate is null or p_rate = 0 then '' else round(p_rate, 2)::text end)
  on conflict (key) do update set value = excluded.value;
end;
$$;

revoke all on function public.platform_set_billing_usd_rate(numeric) from public, anon;
grant execute on function public.platform_set_billing_usd_rate(numeric) to authenticated;

-- Show the rate where the three screens read their billing figures.
do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  -- A business owner's Billing page.
  v_def := pg_get_functiondef('public.billing_overview()'::regprocedure);
  v_old := '''instructions'', public.billing_config(''billing_instructions'', ''''),';
  v_new := v_old || E'\n    ''usd_rate'', nullif(public.billing_config(''billing_usd_rate'', ''''), '''')::numeric,';
  if position(v_old in v_def) = 0 then raise exception 'billing_overview: expected line not found'; end if;
  execute replace(v_def, v_old, v_new);

  -- The platform admin's billing screen.
  v_def := pg_get_functiondef('public.platform_billing()'::regprocedure);
  v_old := '''instructions'', public.billing_config(''billing_instructions'', ''''),';
  v_new := v_old || E'\n      ''usd_rate'', nullif(public.billing_config(''billing_usd_rate'', ''''), '''')::numeric,';
  if position(v_old in v_def) = 0 then raise exception 'platform_billing: expected line not found'; end if;
  execute replace(v_def, v_old, v_new);

  -- The public prices on the landing page.
  v_def := pg_get_functiondef('public.public_pricing()'::regprocedure);
  v_old := '''standard_price_per_router_ssp'',';
  v_new := '''usd_rate'', nullif(public.billing_config(''billing_usd_rate'', ''''), '''')::numeric,' || E'\n    ' || v_old;
  if position(v_old in v_def) = 0 then raise exception 'public_pricing: expected line not found'; end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
