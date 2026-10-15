-- 1. Hotzonex Cloud's own business is never billed; every other business is.
-- 2. Support mode: a platform admin can step into a customer's business (as its admin) for a set
--    time, to set up and fix their routers. The customer is told, and every action is in their
--    audit log as done by the platform admin.
-- 3. Platform powers (support mode, billing, all businesses) need a 2-step login (authenticator
--    code, "aal2"): a stolen password alone can no longer reach every customer.
-- 4. Trigger and internal helpers can no longer be called through the API.

-- 1 ------------------------------------------------------------------------------------------
update public.tenant_billing tb set exempt = true, updated_at = now()
where tb.tenant_id in (select p.tenant_id from public.platform_admins a join public.profiles p on p.id = a.user_id);
update public.tenant_billing tb set exempt = false, updated_at = now()
where tb.tenant_id not in (select p.tenant_id from public.platform_admins a join public.profiles p on p.id = a.user_id);

do $$
declare
  v_def text := pg_get_functiondef('public.billing_run'::regproc);
  v_old text := 'join public.tenants t on t.id = tb.tenant_id where not tb.exempt';
  v_new text := 'join public.tenants t on t.id = tb.tenant_id where not tb.exempt
      and tb.tenant_id not in (select p.tenant_id from public.platform_admins a join public.profiles p on p.id = a.user_id)';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'billing_run: tenant loop not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;

-- 3 (used by 2) --------------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- 2 ------------------------------------------------------------------------------------------
alter table public.platform_admins
  add column acting_tenant_id uuid references public.tenants (id) on delete set null,
  add column acting_until timestamptz;

-- The business the caller works in: their own, or the one a platform admin is supporting now.
create or replace function public.app_tenant_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.acting_tenant_id
     from public.platform_admins a
     join public.profiles p on p.id = a.user_id and p.is_active
     join public.tenants own on own.id = p.tenant_id and own.is_active
     where a.user_id = auth.uid() and a.acting_tenant_id is not null and a.acting_until > now()
       and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'),
    (select p.tenant_id
     from public.profiles p
     join public.tenants t on t.id = p.tenant_id
     where p.id = auth.uid() and p.is_active and t.is_active));
$$;

-- Sites follow the business the caller works in (so support mode reaches the customer's sites).
create or replace function public.can_access_site(target_site uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sites s
    where s.id = target_site
      and s.tenant_id = public.app_tenant_id()
      and (public.app_role() = 'admin' or public.app_site_id() = target_site));
$$;

alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check check (kind in (
  'router_offline', 'router_online', 'push_failed', 'push_warning', 'low_stock', 'payment_request', 'billing', 'test', 'support'));

/** Platform admins: manage a customer's business for a while (15 minutes to 8 hours). */
create or replace function public.platform_support_start(p_tenant_id uuid, p_minutes integer default 120)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_until timestamptz := now() + make_interval(mins => least(greatest(coalesce(p_minutes, 120), 15), 480));
  v_me text := (select full_name from public.profiles where id = auth.uid());
begin
  if not public.is_platform_admin() then
    raise exception 'Support mode needs your 2-step login: open Security, turn it on, then log in again with your code.' using errcode = '42501';
  end if;
  select name into v_name from public.tenants where id = p_tenant_id;
  if v_name is null then
    raise exception 'Business not found.' using errcode = 'P0002';
  end if;
  if p_tenant_id = (select p.tenant_id from public.profiles p where p.id = auth.uid()) then
    raise exception 'This is your own business.' using errcode = '22023';
  end if;
  update public.platform_admins set acting_tenant_id = p_tenant_id, acting_until = v_until where user_id = auth.uid();
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (p_tenant_id, auth.uid(), 'support.started', jsonb_build_object('by', v_me, 'until', v_until));
  perform public.raise_alert(p_tenant_id, 'support', 'support:' || auth.uid() || ':' || extract(epoch from now())::bigint,
    'Hotzonex Cloud support opened your account',
    coalesce(v_me, 'Hotzonex Cloud') || ' can manage your routers and settings until ' || to_char(v_until at time zone 'Africa/Juba', 'DD Mon HH24:MI') || '. Every change is recorded.',
    null, null, true);
  perform public.wake_alerts_sender();
  return jsonb_build_object('tenant_id', p_tenant_id, 'name', v_name, 'until', v_until);
end;
$$;

create or replace function public.platform_support_stop()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_t uuid;
begin
  select acting_tenant_id into v_t from public.platform_admins where user_id = auth.uid();
  if v_t is null then
    return;
  end if;
  update public.platform_admins set acting_tenant_id = null, acting_until = null where user_id = auth.uid();
  insert into public.audit_log (tenant_id, user_id, action, details) values (v_t, auth.uid(), 'support.ended', '{}'::jsonb);
end;
$$;

/** The business a platform admin is supporting right now (null when none, or not with 2-step login). */
create or replace function public.support_session()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when a.acting_tenant_id is not null and a.acting_until > now() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
              then jsonb_build_object('tenant_id', t.id, 'name', t.name, 'timezone', t.timezone, 'is_active', t.is_active, 'logo_url', t.logo_url, 'until', a.acting_until)
         end
  from public.platform_admins a left join public.tenants t on t.id = a.acting_tenant_id
  where a.user_id = auth.uid();
$$;

revoke all on function public.platform_support_start(uuid, integer) from public, anon;
revoke all on function public.platform_support_stop() from public, anon;
revoke all on function public.support_session() from public, anon;
grant execute on function public.platform_support_start(uuid, integer) to authenticated;
grant execute on function public.platform_support_stop() to authenticated;
grant execute on function public.support_session() to authenticated;

-- 4 ------------------------------------------------------------------------------------------
revoke all on function public.sales_commission_and_credit() from public, anon, authenticated;
revoke all on function public.tenants_add_billing() from public, anon, authenticated;
revoke all on function public.router_code_length(uuid) from authenticated;
