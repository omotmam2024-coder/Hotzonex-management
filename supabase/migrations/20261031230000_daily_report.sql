-- Daily owner report: today's revenue and cards sold (and yesterday's), the best plan, voids and offline
-- routers, sent through the business's connected Telegram / WhatsApp at 18:00 in its own time zone, in
-- the language chosen for alerts (English, Arabic, Kiswahili). Off until the owner switches it on.
--
--   alert_settings.notify_daily_report    the switch (default off)
--   save_daily_report(p_enabled)          owner only
--   get_alert_settings()                  also returns notify_daily_report
--   send_daily_reports(p_hour)            run every hour by pg_cron: for each business with the switch on, a
--                                         channel connected and local time = p_hour (18), one 'report' alert
--                                         per day (the alert key makes a second run the same day do nothing)
--   report_day_totals(...)                the numbers (same sales as the Reports and Insights pages)
-- The alerts sender already sends kinds it does not know, so the Edge Function needs no change.
-- Undo: select cron.unschedule('hzc-daily-report'); drop function public.send_daily_reports(integer);
--       drop function public.report_day_totals(uuid, date, text); drop function public.save_daily_report(boolean);
--       restore get_alert_settings (20261015140000...); alter table public.alert_settings drop column notify_daily_report;
--       restore alerts_kind_check without 'report'.

alter table public.alert_settings add column if not exists notify_daily_report boolean not null default false;

alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check check (kind in (
  'router_offline', 'router_online', 'push_failed', 'push_warning', 'low_stock', 'payment_request', 'billing', 'test', 'support', 'report'));

create or replace function public.get_alert_settings()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v public.alert_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change alerts.' using errcode = '42501';
  end if;
  insert into public.alert_settings (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
  select * into v from public.alert_settings where tenant_id = v_tenant;
  return jsonb_build_object(
    'telegram_connected', v.telegram_chat_id is not null,
    'telegram_chat_title', v.telegram_chat_title,
    'notify_offline', v.notify_offline,
    'notify_push', v.notify_push,
    'notify_low_stock', v.notify_low_stock,
    'low_stock_threshold', v.low_stock_threshold,
    'notify_payments', v.notify_payments,
    'notify_daily_report', v.notify_daily_report,
    'whatsapp_numbers', to_jsonb(v.whatsapp_numbers),
    'lang', v.lang);
end;
$$;

create or replace function public.save_daily_report(p_enabled boolean)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.app_tenant_id();
begin
  if v_tenant is null or public.app_role() is distinct from 'admin' then
    raise exception 'Only the business owner can change the daily report.' using errcode = '42501';
  end if;
  insert into public.alert_settings (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
  update public.alert_settings set notify_daily_report = coalesce(p_enabled, false), updated_at = now() where tenant_id = v_tenant;
  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), 'alerts.daily_report', jsonb_build_object('enabled', coalesce(p_enabled, false)), v_tenant);
end;
$$;
revoke all on function public.save_daily_report(boolean) from public, anon;
grant execute on function public.save_daily_report(boolean) to authenticated;

create or replace function public.report_day_totals(p_tenant uuid, p_day date, p_tz text)
returns table(sold integer, ssp bigint, top_plan text, voids integer)
language sql stable security definer set search_path to 'public' as $$
  with live as (
    select s.plan_id, s.amount_ssp as amount
    from public.sales s
    where s.tenant_id = p_tenant and s.voided_at is null
      and s.sold_at >= (p_day::timestamp at time zone p_tz) and s.sold_at < ((p_day + 1)::timestamp at time zone p_tz)
    union all
    select l.plan_id, l.price_ssp
    from public.router_logins l
    where l.tenant_id = p_tenant and l.used and l.first_login_known and l.price_ssp > 0
      and l.first_login_at >= (p_day::timestamp at time zone p_tz) and l.first_login_at < ((p_day + 1)::timestamp at time zone p_tz)
    union all
    select v.plan_id, p.price_ssp
    from public.vouchers v join public.plans p on p.id = v.plan_id
    where v.tenant_id = p_tenant and v.first_used_at is not null and p.price_ssp > 0
      and not exists (select 1 from public.sales s where s.voucher_id = v.id)
      and v.first_used_at >= (p_day::timestamp at time zone p_tz) and v.first_used_at < ((p_day + 1)::timestamp at time zone p_tz)
  )
  select count(*)::integer,
         coalesce(sum(amount), 0)::bigint,
         (select p.name from live l2 join public.plans p on p.id = l2.plan_id group by p.name order by sum(l2.amount) desc limit 1),
         (select count(*)::integer from public.sales s2 where s2.tenant_id = p_tenant and s2.voided_at >= (p_day::timestamp at time zone p_tz) and s2.voided_at < ((p_day + 1)::timestamp at time zone p_tz))
  from live;
$$;
revoke all on function public.report_day_totals(uuid, date, text) from public, anon, authenticated;

create or replace function public.send_daily_reports(p_hour integer default 18)
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_today record;
  v_yest record;
  v_day date;
  v_off integer;
  v_title text;
  v_body text;
  v_new integer := 0;
  f constant text := 'FM999,999,999,999';
begin
  for r in
    select s.tenant_id, s.lang, coalesce(t.timezone, 'Africa/Juba') as tz
    from public.alert_settings s
    join public.tenants t on t.id = s.tenant_id
    where s.notify_daily_report and t.is_active
      and (s.telegram_chat_id is not null or cardinality(s.whatsapp_numbers) > 0)
      and extract(hour from now() at time zone coalesce(t.timezone, 'Africa/Juba'))::integer = p_hour
  loop
    v_day := (now() at time zone r.tz)::date;
    select * into v_today from public.report_day_totals(r.tenant_id, v_day, r.tz);
    select * into v_yest from public.report_day_totals(r.tenant_id, v_day - 1, r.tz);
    select count(*) into v_off from public.routers where tenant_id = r.tenant_id and status = 'offline';

    if r.lang = 'ar' then
      v_title := 'التقرير اليومي: ' || to_char(v_today.ssp, f) || ' SSP';
      v_body := 'البطاقات المباعة: ' || v_today.sold || E'\nأمس: ' || to_char(v_yest.ssp, f) || ' SSP (' || v_yest.sold || E' بطاقة)'
        || case when v_today.top_plan is not null then E'\nأفضل باقة: ' || v_today.top_plan else '' end
        || E'\nمبيعات ملغاة: ' || v_today.voids || E'\nراوترات متوقفة: ' || v_off;
    elsif r.lang = 'sw' then
      v_title := 'Ripoti ya kila siku: ' || to_char(v_today.ssp, f) || ' SSP';
      v_body := 'Vocha zilizouzwa: ' || v_today.sold || E'\nJana: ' || to_char(v_yest.ssp, f) || ' SSP (vocha ' || v_yest.sold || ')'
        || case when v_today.top_plan is not null then E'\nKifurushi bora: ' || v_today.top_plan else '' end
        || E'\nMauzo yaliyofutwa: ' || v_today.voids || E'\nRouter zilizozimika: ' || v_off;
    else
      v_title := 'Daily report: ' || to_char(v_today.ssp, f) || ' SSP';
      v_body := 'Cards sold: ' || v_today.sold || E'\nYesterday: ' || to_char(v_yest.ssp, f) || ' SSP (' || v_yest.sold || ' cards)'
        || case when v_today.top_plan is not null then E'\nBest plan: ' || v_today.top_plan else '' end
        || E'\nVoided today: ' || v_today.voids || E'\nRouters offline: ' || v_off;
    end if;

    if public.raise_alert(r.tenant_id, 'report', 'report:' || v_day, v_title, v_body) then
      v_new := v_new + 1;
    end if;
  end loop;
  if v_new > 0 then
    perform public.wake_alerts_sender();
  end if;
  return v_new;
end;
$$;
revoke all on function public.send_daily_reports(integer) from public, anon, authenticated;
grant execute on function public.send_daily_reports(integer) to service_role;

-- Every hour: businesses whose local time is 18:xx get their report.
select cron.schedule('hzc-daily-report', '5 * * * *', 'select public.send_daily_reports()');
