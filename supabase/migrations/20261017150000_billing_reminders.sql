-- Subscription reminders in the business's language (owner's request, 17 October 2026).
--
-- Businesses that use Hotzonex Cloud are told on WhatsApp (and Telegram) before their service runs
-- out: 7, 3 and 1 day before the paid month ends, and 7, 3 and 1 day before a free trial ends,
-- next to the existing notices (new invoice, due in 2 days, app paused, payment received).
-- The alerts Edge Function writes them in the business's language: English, Arabic or Kiswahili
-- (alert_settings.lang), with default texts the platform admin can change (Businesses page).
--
-- * alert_settings.lang: 'en' (default), 'ar' or 'sw'; owners choose it on the Alerts page.
-- * billing_reminders(): called at the end of the daily billing run. Each reminder is sent once
--   (alert key trial_ending:<business>:<days> or renew:<invoice>:<days>).
-- * The old single "trial ends in 3 days" notice is replaced by the 7 / 3 / 1 day reminders.
-- Additive only.

alter table public.alert_settings add column if not exists lang text not null default 'en' check (lang in ('en', 'ar', 'sw'));

create or replace function public.billing_reminders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_std integer := coalesce(nullif(public.billing_config('billing_price_per_router_ssp', '0'), '')::integer, 0);
  v_howto text := public.billing_config('billing_instructions', '');
  v_today date := (now() at time zone 'Africa/Juba')::date;
  b record;
  v_days integer;
  v_price integer;
  v_routers integer;
  v_last public.invoices%rowtype;
  v_sent integer := 0;
begin
  for b in
    select tb.*, t.name from public.tenant_billing tb join public.tenants t on t.id = tb.tenant_id
    where not tb.exempt and t.is_active
      and tb.tenant_id not in (select p.tenant_id from public.platform_admins a join public.profiles p on p.id = a.user_id)
  loop
    v_price := coalesce(b.price_per_router_ssp, (select sp.price_per_router_ssp from public.subscription_plans sp where sp.id = b.plan_id), v_std);
    if b.status = 'trial' and b.trial_ends_at is not null and b.trial_ends_at > now() then
      v_days := (b.trial_ends_at at time zone 'Africa/Juba')::date - v_today;
      if v_days in (7, 3, 1) then
        perform public.billing_notice(b.tenant_id, 'trial_ending:' || b.tenant_id || ':' || v_days,
          'Your free trial ends in ' || v_days || ' day(s), on ' || to_char(b.trial_ends_at at time zone 'Africa/Juba', 'DD Mon'),
          case when v_price > 0 then 'Then Hotzonex Cloud costs ' || to_char(v_price, 'FM999,999,999') || ' SSP per router per month. See the Billing page.'
               else 'See the Billing page.' end);
        v_sent := v_sent + 1;
      end if;
      continue;
    end if;
    continue when b.status <> 'active' or v_price <= 0;
    -- The month that is paid: remind before it ends (an unpaid invoice has its own "due" notice).
    select * into v_last from public.invoices where tenant_id = b.tenant_id order by period_end desc, created_at desc limit 1;
    continue when v_last.id is null or v_last.status <> 'paid';
    v_days := v_last.period_end - v_today;
    if v_days in (7, 3, 1) then
      select greatest(count(*), 1) into v_routers from public.routers where tenant_id = b.tenant_id and status <> 'pending';
      perform public.billing_notice(b.tenant_id, 'renew:' || v_last.id || ':' || v_days,
        'Hotzonex Cloud is paid until ' || to_char(v_last.period_end, 'DD Mon') || ' (' || v_days || ' day(s) left)',
        'Next month: about ' || to_char(v_routers * v_price, 'FM999,999,999') || ' SSP (' || v_routers || ' router(s)). ' || v_howto);
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.billing_reminders() from public, anon, authenticated;

-- The daily billing run: the 7 / 3 / 1 day reminders replace its single "trial ends in 3 days" notice.
do $$
declare
  v_def text := pg_get_functiondef('public.billing_run()'::regprocedure);
  v_trial text := 'if b.trial_ends_at is not null and b.trial_ends_at < now() + interval ''3 days'' then';
  v_end text := '  return jsonb_build_object(''invoices'', v_made, ''switched_off'', v_off);';
begin
  if position(v_trial in v_def) = 0 or position(v_end in v_def) = 0 then
    raise exception 'billing_run: expected text not found';
  end if;
  v_def := replace(v_def, v_trial, 'if false then  -- trial reminders: billing_reminders() (7, 3 and 1 day before)');
  v_def := replace(v_def, v_end, '  return jsonb_build_object(''invoices'', v_made, ''switched_off'', v_off, ''reminders'', public.billing_reminders());');
  execute v_def;
end $$;

-- get_alert_settings also returns the message language.
do $$
declare
  v_def text := pg_get_functiondef('public.get_alert_settings()'::regprocedure);
  v_old text := '''whatsapp_numbers'', to_jsonb(v.whatsapp_numbers));';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'get_alert_settings: return list not found';
  end if;
  execute replace(v_def, v_old, '''whatsapp_numbers'', to_jsonb(v.whatsapp_numbers),
    ''lang'', v.lang);');
end $$;

create or replace function public.save_alert_language(p_lang text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
begin
  if not public.is_admin() then
    raise exception 'Only the owner can change alerts.' using errcode = '42501';
  end if;
  if p_lang is null or p_lang not in ('en', 'ar', 'sw') then
    raise exception 'Choose English, Arabic or Kiswahili.' using errcode = '22023';
  end if;
  insert into public.alert_settings (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
  update public.alert_settings set lang = p_lang, updated_at = now() where tenant_id = v_tenant;
  return public.get_alert_settings();
end;
$$;
revoke all on function public.save_alert_language(text) from public, anon;
grant execute on function public.save_alert_language(text) to authenticated;
