-- WhatsApp alerts: owners can change their alert numbers at most 10 times a day, so the shared
-- Hotzonex sender number cannot be pointed at strangers again and again (spam would get it blocked).

do $$
declare
  v_def text := pg_get_functiondef('public.save_alert_whatsapp(text[])'::regprocedure);
  v_old text := 'raise exception ''Only the owner can change alerts.'' using errcode = ''42501'';
  end if;';
  v_new text := 'raise exception ''Only the owner can change alerts.'' using errcode = ''42501'';
  end if;
  if (select count(*) from public.audit_log
      where tenant_id = v_tenant and action = ''alerts.whatsapp_numbers'' and created_at > now() - interval ''1 day'') >= 10 then
    raise exception ''The WhatsApp numbers were changed too often today. Try again tomorrow.'' using errcode = ''54000'';
  end if;';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'save_alert_whatsapp: owner check not found';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
