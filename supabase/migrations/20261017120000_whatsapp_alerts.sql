-- WhatsApp alerts (owner's request, 17 October 2026).
--
-- Hotzonex Cloud sends alerts from its own WhatsApp number (a sender SIM linked to the tunnel
-- server, see supabase/functions/_shared/whatsapp.ts). Each business chooses up to 5 WhatsApp
-- numbers that receive its alerts, next to (or instead of) Telegram.
--
-- * alert_settings.whatsapp_numbers: digits with country code (e.g. 211924904216).
-- * alerts.telegram_sent_at / whatsapp_sent_at: each way of sending is done once, so a retry after
--   one of them failed never repeats the other. sent_at still means "nothing left to send".
-- * save_alert_whatsapp(): owners set the numbers. Local numbers (0 + 9 digits) are South Sudan.
-- Additive only.

alter table public.alert_settings
  add column if not exists whatsapp_numbers text[] not null default '{}'
    check (cardinality(whatsapp_numbers) <= 5);
alter table public.alerts add column if not exists telegram_sent_at timestamptz;
alter table public.alerts add column if not exists whatsapp_sent_at timestamptz;

/** "0924 904 216" / "+211924904216" / "00211…" → "211924904216"; null when it is not a phone number. */
create or replace function public.normalize_whatsapp_number(p text)
returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  n text := regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g');
begin
  if n like '+%' then
    n := substr(n, 2);
  elsif n like '00%' then
    n := substr(n, 3);
  elsif n ~ '^0[0-9]{9}$' then
    n := '211' || substr(n, 2);
  end if;
  return case when n ~ '^[1-9][0-9]{7,14}$' then n end;
end;
$$;

create or replace function public.save_alert_whatsapp(p_numbers text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_clean text[] := '{}';
  v_raw text;
  v_n text;
begin
  if not public.is_admin() then
    raise exception 'Only the owner can change alerts.' using errcode = '42501';
  end if;
  foreach v_raw in array coalesce(p_numbers, '{}') loop
    continue when btrim(v_raw) = '';
    v_n := public.normalize_whatsapp_number(v_raw);
    if v_n is null then
      raise exception '"%" is not a phone number. Use the full number, for example 0924904216 or +211924904216.', left(v_raw, 30)
        using errcode = '22023';
    end if;
    if not v_n = any (v_clean) then
      v_clean := v_clean || v_n;
    end if;
  end loop;
  if cardinality(v_clean) > 5 then
    raise exception 'Up to 5 WhatsApp numbers.' using errcode = '22023';
  end if;
  insert into public.alert_settings (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
  update public.alert_settings set whatsapp_numbers = v_clean, updated_at = now() where tenant_id = v_tenant;
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_tenant, auth.uid(), 'alerts.whatsapp_numbers', jsonb_build_object('count', cardinality(v_clean)));
  return public.get_alert_settings();
end;
$$;

-- get_alert_settings also returns the WhatsApp numbers.
do $$
declare
  v_def text := pg_get_functiondef('public.get_alert_settings()'::regprocedure);
  v_old text := '''notify_payments'', v.notify_payments);';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'get_alert_settings: return list not found';
  end if;
  execute replace(v_def, v_old, '''notify_payments'', v.notify_payments,
    ''whatsapp_numbers'', to_jsonb(v.whatsapp_numbers));');
end $$;

revoke all on function public.normalize_whatsapp_number(text) from public, anon, authenticated;
revoke all on function public.save_alert_whatsapp(text[]) from public, anon;
grant execute on function public.save_alert_whatsapp(text[]) to authenticated;
