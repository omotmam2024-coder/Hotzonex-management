-- Selling Hotzonex Cloud to other businesses: self sign-up with a free trial, then a monthly fee
-- per connected router. Invoices are paid by mobile money or bank and confirmed by hand by a
-- platform admin. An invoice unpaid after the grace period switches the business off; its admins
-- can still log in to see the invoice and send their payment reference (and their customers' WiFi
-- keeps working meanwhile).
--
-- Billing lives in its own tables (business admins may edit their tenants row, never these).
-- With the price at 0 (the default) no invoice is ever made.

create table public.tenant_billing (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  status text not null default 'active' check (status in ('trial', 'active', 'suspended')),
  exempt boolean not null default false,
  trial_ends_at timestamptz,
  price_per_router_ssp integer check (price_per_router_ssp is null or price_per_router_ssp >= 0),
  created_via text not null default 'platform' check (created_via in ('platform', 'signup')),
  signup_ip text,
  contact_phone text,
  suspended_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on column public.tenant_billing.exempt is 'Never billed (e.g. Hotzonex Cloud''s own business).';
comment on column public.tenant_billing.price_per_router_ssp is 'This business''s own price; null uses the standard price.';

-- Businesses that exist today are not billed until a platform admin says so.
insert into public.tenant_billing (tenant_id, status, exempt)
select id, 'active', true from public.tenants
on conflict (tenant_id) do nothing;

create or replace function public.tenants_add_billing()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_billing (tenant_id) values (new.id) on conflict (tenant_id) do nothing;
  return new;
end;
$$;
create trigger tenants_add_billing after insert on public.tenants for each row execute function public.tenants_add_billing();

create sequence public.invoice_number_seq;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  number text not null unique,
  period_start date not null,
  period_end date not null,
  routers integer not null check (routers >= 0),
  price_per_router_ssp integer not null check (price_per_router_ssp >= 0),
  amount_ssp integer not null check (amount_ssp >= 0),
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  due_at timestamptz not null,
  customer_ref text check (length(customer_ref) <= 60),
  customer_ref_at timestamptz,
  paid_at timestamptz,
  paid_ref text check (length(paid_ref) <= 60),
  confirmed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index invoices_tenant on public.invoices (tenant_id, period_end desc);
create index invoices_open on public.invoices (due_at) where status = 'open';

alter table public.tenant_billing enable row level security;
alter table public.invoices enable row level security;
-- No direct access: everything goes through the functions below.
revoke all on public.tenant_billing, public.invoices from anon, authenticated;

insert into public.app_config (key, value) values
  ('billing_price_per_router_ssp', '0'),
  ('billing_instructions', ''),
  ('billing_grace_days', '7'),
  ('billing_trial_days', '14')
on conflict (key) do nothing;

create or replace function public.billing_config(p_key text, p_default text)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_config where key = p_key), p_default);
$$;
revoke all on function public.billing_config(text, text) from public, anon, authenticated;

/** The signed-in admin's business, even when it is switched off (to see and pay its invoices). */
create or replace function public.billing_tenant_of_caller()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid() and p.is_active and p.role = 'admin';
$$;
revoke all on function public.billing_tenant_of_caller() from public, anon, authenticated;

/** The tenant of the first platform admin: where platform alerts (payments to confirm) go. */
create or replace function public.platform_tenant_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.tenant_id from public.platform_admins a join public.profiles p on p.id = a.user_id order by a.created_at limit 1;
$$;
revoke all on function public.platform_tenant_id() from public, anon, authenticated;

/** Raises a one-off billing message once per key (it is closed at once, so it never blocks). */
create or replace function public.billing_notice(p_tenant_id uuid, p_key text, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tenant_id is null or exists (select 1 from public.alerts where tenant_id = p_tenant_id and key = p_key) then
    return;
  end if;
  perform public.raise_alert(p_tenant_id, 'billing', p_key, p_title, p_body, null, null, true);
end;
$$;
revoke all on function public.billing_notice(uuid, text, text, text) from public, anon, authenticated;

/**
 * Daily: trials that ended start billing; each billed business gets an invoice for its next month
 * (routers connected × price); reminders before the due day; unpaid after the grace period → the
 * business is switched off. Businesses that pay are switched on again when the payment is confirmed.
 */
create or replace function public.billing_run()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_std integer := coalesce(nullif(public.billing_config('billing_price_per_router_ssp', '0'), '')::integer, 0);
  v_grace integer := coalesce(nullif(public.billing_config('billing_grace_days', '7'), '')::integer, 7);
  v_howto text := public.billing_config('billing_instructions', '');
  v_today date := (now() at time zone 'Africa/Juba')::date;
  b record;
  v_last public.invoices%rowtype;
  v_price integer;
  v_routers integer;
  v_start date;
  v_inv public.invoices%rowtype;
  v_made integer := 0;
  v_off integer := 0;
begin
  for b in
    select tb.*, t.name, t.is_active from public.tenant_billing tb join public.tenants t on t.id = tb.tenant_id where not tb.exempt
  loop
    v_price := coalesce(b.price_per_router_ssp, v_std);
    if b.status = 'trial' then
      if b.trial_ends_at is null or b.trial_ends_at > now() then
        if b.trial_ends_at is not null and b.trial_ends_at < now() + interval '3 days' then
          perform public.billing_notice(b.tenant_id, 'trial_ending:' || b.tenant_id, 'Your free trial ends on ' || to_char(b.trial_ends_at at time zone 'Africa/Juba', 'DD Mon'),
            case when v_price > 0 then 'Then Hotzonex Cloud costs ' || to_char(v_price, 'FM999,999,999') || ' SSP per router per month. See the Billing page.' else 'See the Billing page.' end);
        end if;
        continue;
      end if;
      update public.tenant_billing set status = 'active', updated_at = now() where tenant_id = b.tenant_id;
    end if;
    continue when v_price <= 0;

    -- The next month's invoice, once the last one has run out.
    select * into v_last from public.invoices where tenant_id = b.tenant_id and status <> 'void' order by period_end desc limit 1;
    if v_last.id is null or v_last.period_end < v_today then
      v_start := case when v_last.id is null then v_today else greatest(v_last.period_end + 1, v_today - 31) end;
      select greatest(count(*), 1) into v_routers from public.routers where tenant_id = b.tenant_id and status <> 'pending';
      insert into public.invoices (tenant_id, number, period_start, period_end, routers, price_per_router_ssp, amount_ssp, due_at)
      values (b.tenant_id, 'HZC-' || to_char(v_today, 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0'),
              v_start, (v_start + interval '1 month')::date - 1, v_routers, v_price, v_routers * v_price,
              ((greatest(v_start, v_today) + v_grace)::timestamp at time zone 'Africa/Juba'))
      returning * into v_inv;
      v_made := v_made + 1;
      perform public.billing_notice(b.tenant_id, 'invoice:' || v_inv.id,
        'Invoice ' || v_inv.number || ': ' || to_char(v_inv.amount_ssp, 'FM999,999,999') || ' SSP',
        v_inv.routers || ' router(s) × ' || to_char(v_price, 'FM999,999,999') || ' SSP, ' || to_char(v_inv.period_start, 'DD Mon') || '–' || to_char(v_inv.period_end, 'DD Mon')
          || '. Due ' || to_char(v_inv.due_at at time zone 'Africa/Juba', 'DD Mon') || '. ' || v_howto);
    end if;
  end loop;

  -- Reminders two days before, then switch-off after the due day.
  for v_inv in select i.* from public.invoices i join public.tenant_billing tb on tb.tenant_id = i.tenant_id where i.status = 'open' and not tb.exempt loop
    if v_inv.due_at < now() then
      update public.tenants set is_active = false where id = v_inv.tenant_id and is_active;
      if found then
        update public.tenant_billing set status = 'suspended', suspended_at = now(), updated_at = now() where tenant_id = v_inv.tenant_id;
        v_off := v_off + 1;
        perform public.billing_notice(v_inv.tenant_id, 'suspended:' || v_inv.id, 'Hotzonex Cloud is paused: invoice ' || v_inv.number || ' is unpaid',
          'Your WiFi keeps working, but the app is closed until it is paid. Pay ' || to_char(v_inv.amount_ssp, 'FM999,999,999') || ' SSP, then log in and send the transaction ID. ' || v_howto);
      end if;
    elsif v_inv.due_at < now() + interval '2 days' and v_inv.customer_ref is null then
      perform public.billing_notice(v_inv.tenant_id, 'due_soon:' || v_inv.id, 'Invoice ' || v_inv.number || ' is due on ' || to_char(v_inv.due_at at time zone 'Africa/Juba', 'DD Mon'),
        to_char(v_inv.amount_ssp, 'FM999,999,999') || ' SSP. ' || v_howto);
    end if;
  end loop;
  return jsonb_build_object('invoices', v_made, 'switched_off', v_off);
end;
$$;
revoke all on function public.billing_run() from public, anon, authenticated;
select cron.schedule('hzc-billing', '7 4 * * *', 'select public.billing_run()');

/** The business admin's billing page (works while the business is switched off for non-payment). */
create or replace function public.billing_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.billing_tenant_of_caller();
  b public.tenant_billing%rowtype;
  v_std integer := coalesce(nullif(public.billing_config('billing_price_per_router_ssp', '0'), '')::integer, 0);
begin
  if v_tenant is null then
    raise exception 'Only admins can see billing.' using errcode = '42501';
  end if;
  select * into b from public.tenant_billing where tenant_id = v_tenant;
  return jsonb_build_object(
    'status', coalesce(b.status, 'active'),
    'exempt', coalesce(b.exempt, true),
    'trial_ends_at', b.trial_ends_at,
    'price_per_router_ssp', coalesce(b.price_per_router_ssp, v_std),
    'routers', (select count(*) from public.routers where tenant_id = v_tenant and status <> 'pending'),
    'business_active', (select is_active from public.tenants where id = v_tenant),
    'instructions', public.billing_config('billing_instructions', ''),
    'invoices', coalesce((
      select jsonb_agg(row_to_json(i) order by i.period_start desc)
      from (select id, number, period_start, period_end, routers, price_per_router_ssp, amount_ssp, status, due_at, customer_ref, customer_ref_at, paid_at
            from public.invoices where tenant_id = v_tenant order by period_start desc limit 24) i), '[]'::jsonb));
end;
$$;

/** The business tells Hotzonex Cloud it has paid (the transaction ID); a platform admin confirms. */
create or replace function public.submit_invoice_payment(p_invoice_id uuid, p_ref text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.billing_tenant_of_caller();
  v_ref text := upper(regexp_replace(coalesce(p_ref, ''), '\s', '', 'g'));
  v_inv public.invoices%rowtype;
begin
  if v_tenant is null then
    raise exception 'Only admins can pay invoices.' using errcode = '42501';
  end if;
  if v_ref !~ '^[A-Z0-9.-]{4,40}$' then
    raise exception 'Type the transaction ID from your payment message.' using errcode = '22023';
  end if;
  update public.invoices set customer_ref = v_ref, customer_ref_at = now()
  where id = p_invoice_id and tenant_id = v_tenant and status = 'open'
  returning * into v_inv;
  if v_inv.id is null then
    raise exception 'This invoice is not open.' using errcode = '55000';
  end if;
  if public.platform_tenant_id() is not null then
    perform public.raise_alert(public.platform_tenant_id(), 'billing', 'invoice_paid:' || v_inv.id,
      'Invoice ' || v_inv.number || ' paid? ' || to_char(v_inv.amount_ssp, 'FM999,999,999') || ' SSP',
      (select name from public.tenants where id = v_tenant) || ' says it paid, ref ' || v_ref || '. Check it, then Mark paid on the Businesses page.');
    perform public.wake_alerts_sender();
  end if;
end;
$$;

/** Platform admins: every business's billing, open invoices and the standard settings. */
create or replace function public.platform_billing()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can see this.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'config', jsonb_build_object(
      'price_per_router_ssp', public.billing_config('billing_price_per_router_ssp', '0')::integer,
      'instructions', public.billing_config('billing_instructions', ''),
      'grace_days', public.billing_config('billing_grace_days', '7')::integer,
      'trial_days', public.billing_config('billing_trial_days', '14')::integer),
    'businesses', coalesce((
      select jsonb_agg(row_to_json(x) order by x.name)
      from (
        select t.id as tenant_id, t.name, t.is_active, t.created_at, tb.status, tb.exempt, tb.trial_ends_at, tb.price_per_router_ssp,
               tb.created_via, tb.contact_phone,
               (select count(*) from public.routers r where r.tenant_id = t.id and r.status <> 'pending') as routers,
               coalesce((select jsonb_agg(row_to_json(i) order by i.period_start desc)
                         from (select id, number, period_start, period_end, routers, amount_ssp, status, due_at, customer_ref, customer_ref_at, paid_at, paid_ref
                               from public.invoices where tenant_id = t.id order by period_start desc limit 6) i), '[]'::jsonb) as invoices
        from public.tenants t left join public.tenant_billing tb on tb.tenant_id = t.id
      ) x), '[]'::jsonb));
end;
$$;

create or replace function public.platform_set_billing_config(p_price integer, p_instructions text, p_grace_days integer, p_trial_days integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can change billing.' using errcode = '42501';
  end if;
  if p_price is null or p_price < 0 or p_grace_days not between 0 and 60 or p_trial_days not between 0 and 90 then
    raise exception 'Check the price (0 or more), grace days (0–60) and trial days (0–90).' using errcode = '22023';
  end if;
  insert into public.app_config (key, value) values
    ('billing_price_per_router_ssp', p_price::text),
    ('billing_instructions', left(trim(coalesce(p_instructions, '')), 500)),
    ('billing_grace_days', p_grace_days::text),
    ('billing_trial_days', p_trial_days::text)
  on conflict (key) do update set value = excluded.value;
end;
$$;

create or replace function public.platform_set_business_billing(p_tenant_id uuid, p_exempt boolean, p_price integer, p_trial_ends_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can change billing.' using errcode = '42501';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'The price cannot be negative.' using errcode = '22023';
  end if;
  insert into public.tenant_billing (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  update public.tenant_billing
  set exempt = coalesce(p_exempt, exempt),
      price_per_router_ssp = p_price,
      trial_ends_at = p_trial_ends_at,
      status = case when p_trial_ends_at is not null and p_trial_ends_at > now() and status <> 'suspended' then 'trial'
                    when status = 'trial' and (p_trial_ends_at is null or p_trial_ends_at <= now()) then 'active' else status end,
      updated_at = now()
  where tenant_id = p_tenant_id;
end;
$$;

/** Platform admins: an invoice is paid (after checking the money arrived). Switches the business back on when nothing else is overdue. */
create or replace function public.platform_mark_invoice(p_invoice_id uuid, p_status text, p_ref text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invoices%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can do this.' using errcode = '42501';
  end if;
  if p_status not in ('paid', 'void') then
    raise exception 'Mark an invoice paid or void.' using errcode = '22023';
  end if;
  update public.invoices
  set status = p_status,
      paid_at = case when p_status = 'paid' then now() end,
      paid_ref = case when p_status = 'paid' then left(coalesce(nullif(trim(p_ref), ''), customer_ref), 60) end,
      confirmed_by = auth.uid()
  where id = p_invoice_id and status = 'open'
  returning * into v_inv;
  if v_inv.id is null then
    raise exception 'This invoice is not open.' using errcode = '55000';
  end if;
  update public.alerts set resolved_at = now() where key = 'invoice_paid:' || v_inv.id and resolved_at is null;
  if not exists (select 1 from public.invoices where tenant_id = v_inv.tenant_id and status = 'open' and due_at < now()) then
    update public.tenants set is_active = true where id = v_inv.tenant_id and not is_active
      and exists (select 1 from public.tenant_billing where tenant_id = v_inv.tenant_id and status = 'suspended');
    update public.tenant_billing set status = 'active', suspended_at = null, updated_at = now() where tenant_id = v_inv.tenant_id and status = 'suspended';
  end if;
  if p_status = 'paid' then
    perform public.billing_notice(v_inv.tenant_id, 'receipt:' || v_inv.id, 'Thank you: invoice ' || v_inv.number || ' is paid',
      to_char(v_inv.amount_ssp, 'FM999,999,999') || ' SSP received.');
  end if;
end;
$$;

revoke all on function public.billing_overview() from public, anon;
revoke all on function public.submit_invoice_payment(uuid, text) from public, anon;
revoke all on function public.platform_billing() from public, anon;
revoke all on function public.platform_set_billing_config(integer, text, integer, integer) from public, anon;
revoke all on function public.platform_set_business_billing(uuid, boolean, integer, timestamptz) from public, anon;
revoke all on function public.platform_mark_invoice(uuid, text, text) from public, anon;
grant execute on function public.billing_overview() to authenticated;
grant execute on function public.submit_invoice_payment(uuid, text) to authenticated;
grant execute on function public.platform_billing() to authenticated;
grant execute on function public.platform_set_billing_config(integer, text, integer, integer) to authenticated;
grant execute on function public.platform_set_business_billing(uuid, boolean, integer, timestamptz) to authenticated;
grant execute on function public.platform_mark_invoice(uuid, text, text) to authenticated;
