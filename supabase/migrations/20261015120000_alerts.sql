-- Alerts: router offline / back online, card batches that failed or need attention, low stock.
-- Found every 2 minutes by alerts_scan(), kept as a history in the app, and sent to the business's
-- Telegram chat by the "alerts" Edge Function (the bot token is an Edge Function secret).

create table public.alert_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  telegram_chat_id text,
  telegram_chat_title text,
  link_code text unique,
  link_code_expires_at timestamptz,
  notify_offline boolean not null default true,
  notify_push boolean not null default true,
  notify_low_stock boolean not null default true,
  low_stock_threshold integer not null default 10 check (low_stock_threshold between 1 and 1000),
  notify_payments boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('router_offline', 'router_online', 'push_failed', 'push_warning', 'low_stock', 'payment_request', 'billing', 'test')),
  key text not null,
  title text not null,
  body text not null default '',
  site_id uuid references public.sites (id) on delete set null,
  router_id uuid references public.routers (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  sent_at timestamptz,
  send_attempts integer not null default 0,
  send_error text
);
-- One open alert per subject (a router stays "offline" once until it is back).
create unique index alerts_open_key on public.alerts (tenant_id, key) where resolved_at is null;
create index alerts_unsent on public.alerts (created_at) where sent_at is null;
create index alerts_tenant_created on public.alerts (tenant_id, created_at desc);

alter table public.alert_settings enable row level security;
alter table public.alerts enable row level security;
create policy tenant_isolation on public.alert_settings as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy tenant_isolation on public.alerts as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy alert_settings_admin_read on public.alert_settings for select to authenticated using ((select public.is_admin()));
create policy alerts_read on public.alerts for select to authenticated
  using ((select public.is_admin()) or (site_id is not null and site_id = (select public.app_site_id())));
revoke all on public.alert_settings, public.alerts from anon, authenticated;
grant select (tenant_id, telegram_chat_title, notify_offline, notify_push, notify_low_stock, low_stock_threshold, notify_payments, updated_at)
  on public.alert_settings to authenticated;
grant select on public.alerts to authenticated;

-- Where the sender lives (same project, next to the router worker) and the Telegram webhook secret.
insert into public.app_config (key, value)
select 'alerts_url', replace(value, '/router-direct', '/alerts') from public.app_config where key = 'direct_worker_url'
on conflict (key) do nothing;
insert into public.app_config (key, value)
values ('telegram_webhook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

/** Raises an alert unless the same subject is already open. Returns true when it is new. */
create or replace function public.raise_alert(
  p_tenant_id uuid, p_kind text, p_key text, p_title text, p_body text default '',
  p_site_id uuid default null, p_router_id uuid default null, p_resolved boolean default false
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.alerts (tenant_id, kind, key, title, body, site_id, router_id, resolved_at)
  values (p_tenant_id, p_kind, p_key, left(p_title, 200), left(coalesce(p_body, ''), 1000), p_site_id, p_router_id, case when p_resolved then now() end)
  on conflict (tenant_id, key) where resolved_at is null do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.raise_alert(uuid, text, text, text, text, uuid, uuid, boolean) from public, anon, authenticated;

/** Wakes the alerts sender (fire and forget), like the router worker. */
create or replace function public.wake_alerts_sender()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from public.app_config where key = 'alerts_url');
  v_secret text := (select value from public.app_config where key = 'direct_worker_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'send'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hzc-worker', v_secret),
    timeout_milliseconds := 5000
  );
end;
$$;
revoke all on function public.wake_alerts_sender() from public, anon, authenticated;

/** Finds what needs attention in every business, then wakes the sender when something is new. */
create or replace function public.alerts_scan()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_new integer := 0;
  v_rows integer;
  r record;
begin
  -- Routers that have not answered for 5 minutes.
  for r in
    select ro.id, ro.tenant_id, ro.site_id, ro.name, ro.last_seen_at, coalesce(t.timezone, 'Africa/Juba') as tz
    from public.routers ro join public.tenants t on t.id = ro.tenant_id
    where t.is_active and ro.status = 'offline' and coalesce(ro.last_seen_at, ro.created_at) < now() - interval '5 minutes'
  loop
    if public.raise_alert(r.tenant_id, 'router_offline', 'router_offline:' || r.id, r.name || ' is offline',
         case when r.last_seen_at is null then 'It has not answered yet.'
              else 'Last seen ' || to_char(r.last_seen_at at time zone r.tz, 'DD Mon HH24:MI') || '. Check its power and internet.' end,
         r.site_id, r.id) then
      v_new := v_new + 1;
    end if;
  end loop;

  -- Back online: the open offline alert is closed and a short "back online" message is sent.
  with back as (
    update public.alerts a set resolved_at = now()
    from public.routers ro
    where a.kind = 'router_offline' and a.resolved_at is null and ro.id = a.router_id and ro.status = 'online'
    returning a.tenant_id, a.site_id, a.router_id, ro.name, a.created_at
  )
  insert into public.alerts (tenant_id, kind, key, title, body, site_id, router_id, resolved_at)
  select b.tenant_id, 'router_online', 'router_online:' || b.router_id || ':' || extract(epoch from now())::bigint,
         b.name || ' is back online', 'It was offline for about ' || greatest(1, round(extract(epoch from now() - b.created_at) / 60))::int || ' min.',
         b.site_id, b.router_id, now()
  from back b;
  get diagnostics v_rows = row_count;
  v_new := v_new + v_rows;

  -- Card batches that failed, or that the router check flagged, in the last day.
  for r in
    select j.id, ro.tenant_id, ro.site_id, ro.id as router_id, ro.name, j.status, j.result
    from public.router_jobs j join public.routers ro on ro.id = j.router_id
    where j.type = 'push_vouchers' and j.finished_at > now() - interval '1 day'
      and (j.status = 'failed' or jsonb_array_length(coalesce(j.result -> 'warnings', '[]'::jsonb)) > 0)
  loop
    if r.status = 'failed' then
      if public.raise_alert(r.tenant_id, 'push_failed', 'push_failed:' || r.id, 'Cards could not be added to ' || r.name,
           coalesce(r.result ->> 'error', 'The router refused them.'), r.site_id, r.router_id, true) then
        v_new := v_new + 1;
      end if;
    elsif public.raise_alert(r.tenant_id, 'push_warning', 'push_warning:' || r.id, 'Check the new cards on ' || r.name,
            (select string_agg(w, E'\n') from jsonb_array_elements_text(r.result -> 'warnings') w), r.site_id, r.router_id, true) then
      v_new := v_new + 1;
    end if;
  end loop;

  -- Low stock of Hotzonex cards: plans a site keeps in stock, below the business's threshold.
  for r in
    select st.tenant_id, st.id as site_id, st.name as site_name, p.id as plan_id, p.name as plan_name,
           coalesce(s.low_stock_threshold, 10) as threshold,
           count(v.id) filter (where v.status = 'unused' and v.on_router and v.printed_at is null) as available
    from public.sites st
    join public.tenants t on t.id = st.tenant_id and t.is_active
    join public.plans p on p.tenant_id = st.tenant_id and p.is_active
    join public.vouchers v on v.site_id = st.id and v.plan_id = p.id
    left join public.alert_settings s on s.tenant_id = st.tenant_id
    where st.is_active
    group by 1, 2, 3, 4, 5, 6
  loop
    if r.available < r.threshold then
      if public.raise_alert(r.tenant_id, 'low_stock', 'low_stock:' || r.site_id || ':' || r.plan_id,
           r.site_name || ': ' || r.available || ' × ' || r.plan_name || ' left',
           'Generate more cards before they run out.', r.site_id) then
        v_new := v_new + 1;
      end if;
    else
      update public.alerts set resolved_at = now()
      where tenant_id = r.tenant_id and key = 'low_stock:' || r.site_id || ':' || r.plan_id and resolved_at is null;
    end if;
  end loop;

  if v_new > 0 or exists (select 1 from public.alerts where sent_at is null and send_attempts < 5 and created_at > now() - interval '1 day') then
    perform public.wake_alerts_sender();
  end if;
  return v_new;
end;
$$;
revoke all on function public.alerts_scan() from public, anon, authenticated;

/** The business's alert settings (made with the defaults on first use). Admins only. */
create or replace function public.get_alert_settings()
returns jsonb
language plpgsql security definer set search_path = public as $$
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
    'notify_payments', v.notify_payments);
end;
$$;

create or replace function public.save_alert_settings(
  p_notify_offline boolean, p_notify_push boolean, p_notify_low_stock boolean, p_low_stock_threshold integer, p_notify_payments boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
begin
  if not public.is_admin() then
    raise exception 'Only admins can change alerts.' using errcode = '42501';
  end if;
  if p_low_stock_threshold is null or p_low_stock_threshold not between 1 and 1000 then
    raise exception 'The low-stock level must be from 1 to 1000.' using errcode = '22023';
  end if;
  insert into public.alert_settings (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
  update public.alert_settings
  set notify_offline = coalesce(p_notify_offline, notify_offline),
      notify_push = coalesce(p_notify_push, notify_push),
      notify_low_stock = coalesce(p_notify_low_stock, notify_low_stock),
      low_stock_threshold = p_low_stock_threshold,
      notify_payments = coalesce(p_notify_payments, notify_payments),
      updated_at = now()
  where tenant_id = v_tenant;
  return public.get_alert_settings();
end;
$$;
revoke all on function public.get_alert_settings() from public, anon;
revoke all on function public.save_alert_settings(boolean, boolean, boolean, integer, boolean) from public, anon;
grant execute on function public.get_alert_settings() to authenticated;
grant execute on function public.save_alert_settings(boolean, boolean, boolean, integer, boolean) to authenticated;

select cron.schedule('hzc-alerts', '*/2 * * * *', 'select public.alerts_scan()');

-- The card check after each push is shown with the batch.
create or replace view public.voucher_batch_status with (security_invoker = true) as
 select b.id, b.created_at, b.site_id, b.router_id, b.plan_id, b.quantity, b.code_length, b.created_by, b.note,
    s.name as site_name, r.name as router_name, p.name as plan_name, p.color as plan_color, p.price_ssp, p.uptime_seconds,
    coalesce(v.voucher_count, 0) as voucher_count, coalesce(v.pushed_count, 0) as pushed_count,
    j.status as push_status, (j.result ->> 'error') as push_error, j.finished_at as push_finished_at,
    coalesce(j.result -> 'warnings', '[]'::jsonb) as push_warnings
   from public.voucher_batches b
     join public.sites s on s.id = b.site_id
     join public.routers r on r.id = b.router_id
     join public.plans p on p.id = b.plan_id
     left join lateral (
       select count(*)::integer as voucher_count,
              count(*) filter (where vv.on_router or vv.status = any (array['sold', 'active', 'expired']))::integer as pushed_count
       from public.vouchers vv where vv.batch_id = b.id) v on true
     left join lateral (
       select jj.status, jj.result, jj.finished_at from public.router_jobs jj
       where jj.type = 'push_vouchers' and (jj.payload ->> 'batch_id') = b.id::text
       order by jj.created_at desc limit 1) j on true;
