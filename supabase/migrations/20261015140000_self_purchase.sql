-- Self-purchase ("send and confirm"): a customer opens the site's Buy page (also from the hotspot,
-- through the walled garden), sends mobile money to the business's number, and types the
-- transaction ID. A cashier checks it on their phone and taps Confirm: a card from stock is sold
-- to the customer (or one is made and added to the router at once) and the page shows its code.

alter table public.sites
  add column buy_enabled boolean not null default false,
  add column buy_slug text unique check (buy_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  add column buy_instructions text check (length(buy_instructions) <= 500);
comment on column public.sites.buy_slug is 'Address of the public Buy page: /buy/<slug>.';
comment on column public.sites.buy_instructions is 'Shown to customers: where to send the money (number and name).';

alter table public.sales drop constraint sales_payment_method_check;
alter table public.sales add constraint sales_payment_method_check check (payment_method in ('cash', 'mobile_money'));

alter table public.router_jobs drop constraint router_jobs_type_check;
alter table public.router_jobs add constraint router_jobs_type_check check (type in (
  'test_connection', 'push_vouchers', 'sync_profiles', 'disable_voucher', 'disconnect_user', 'install_portal', 'restore_portal', 'walled_garden'));

create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  amount_ssp integer not null check (amount_ssp >= 0),
  phone text not null check (phone ~ '^\+?[0-9]{7,15}$'),
  provider text not null check (provider in ('mtn_momo', 'mgurush', 'digicash', 'other')),
  txn_ref text not null check (length(txn_ref) between 4 and 40),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'expired')),
  claim_token_hash text not null,
  client_ip text,
  voucher_id uuid references public.vouchers (id) on delete set null,
  sale_id uuid references public.sales (id) on delete set null,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  reject_reason text check (length(reject_reason) <= 200),
  created_at timestamptz not null default now()
);
-- A transaction ID can be used once per business (a rejected one may be typed again correctly).
create unique index payment_requests_txn_once on public.payment_requests (tenant_id, upper(txn_ref)) where status <> 'rejected';
create index payment_requests_site_pending on public.payment_requests (site_id, created_at desc) where status = 'pending';
create index payment_requests_tenant_created on public.payment_requests (tenant_id, created_at desc);
create index payment_requests_phone on public.payment_requests (phone, created_at desc);
create index payment_requests_ip on public.payment_requests (client_ip, created_at desc);

alter table public.payment_requests enable row level security;
create policy tenant_isolation on public.payment_requests as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy payment_requests_read on public.payment_requests for select to authenticated
  using ((select public.is_admin()) or site_id = (select public.app_site_id()));
revoke all on public.payment_requests from anon, authenticated;
grant select (id, site_id, plan_id, amount_ssp, phone, provider, txn_ref, status, voucher_id, sale_id, decided_by, decided_at, reject_reason, created_at)
  on public.payment_requests to authenticated;

-- The alerts sender may also be woken by the Buy function (service role).
grant execute on function public.wake_alerts_sender() to service_role;
grant execute on function public.raise_alert(uuid, text, text, text, text, uuid, uuid, boolean) to service_role;

/** The usual length of a router's own numeric cards (MikroTicket's), from the users seen on it. */
create or replace function public.router_code_length(p_router_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select length(username) from public.router_logins
    where router_id = p_router_id and username ~ '^[0-9]{6,10}$'
    group by 1 having count(*) >= 5 order by count(*) desc limit 1), 8);
$$;
revoke all on function public.router_code_length(uuid) from public, anon;
grant execute on function public.router_code_length(uuid) to authenticated, service_role;

/**
 * Confirms a customer's payment after the cashier has seen the money arrive. The card comes from
 * the site's stock (unsold, unprinted, on a router); with none left, one is made for a router of the
 * site that carries the plan and added to it at once (the customer's page shows it within a minute).
 */
create or replace function public.confirm_payment_request(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.app_role();
  v_req public.payment_requests%rowtype;
  v_plan public.plans%rowtype;
  v_voucher public.vouchers%rowtype;
  v_router public.routers%rowtype;
  v_batch uuid;
  v_len integer;
  v_sale uuid;
  v_now timestamptz := now();
  v_tries integer := 0;
begin
  if v_role is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  select * into v_req from public.payment_requests where id = p_id and tenant_id = public.app_tenant_id() for update;
  if not found or not public.can_access_site(v_req.site_id) then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This payment was already %.', v_req.status using errcode = '55000';
  end if;
  select * into v_plan from public.plans where id = v_req.plan_id;

  -- A card from stock: like the Sell screen.
  select v.* into v_voucher
  from public.vouchers v join public.routers r on r.id = v.router_id
  where v.site_id = v_req.site_id and v.plan_id = v_req.plan_id and v.status = 'unused' and v.on_router and v.printed_at is null
  order by (r.status = 'online') desc, v.created_at, v.id
  limit 1
  for update of v skip locked;

  if not found then
    -- None left: one is made now on a router of the site that carries this plan.
    select r.* into v_router
    from public.routers r
    where r.site_id = v_req.site_id and r.status <> 'pending'
      and (exists (select 1 from public.plan_routers pr where pr.router_id = r.id and pr.plan_id = v_req.plan_id)
           or not exists (select 1 from public.plan_routers pr where pr.plan_id = v_req.plan_id))
    order by (r.status = 'online') desc, r.created_at
    limit 1;
    if not found then
      raise exception 'No router at this site carries %. Tick a router for this plan on the Plans page.', v_plan.name using errcode = '55000';
    end if;
    v_len := public.router_code_length(v_router.id);
    insert into public.voucher_batches (site_id, router_id, plan_id, quantity, code_length, created_by, note)
    values (v_router.site_id, v_router.id, v_plan.id, 1, v_len, auth.uid(), 'Mobile-money purchase')
    returning id into v_batch;
    loop
      insert into public.vouchers (batch_id, router_id, site_id, plan_id, code)
      select v_batch, v_router.id, v_router.site_id, v_plan.id, g.code
      from (select public.random_numeric_code(v_len) as code) g
      where not exists (select 1 from public.router_logins l where l.router_id = v_router.id and l.username = g.code)
      on conflict on constraint vouchers_code_per_router do nothing
      returning * into v_voucher;
      exit when v_voucher.id is not null;
      v_tries := v_tries + 1;
      if v_tries > 25 then
        raise exception 'Could not find a free code on %.', v_router.name using errcode = '54000';
      end if;
    end loop;
    insert into public.router_jobs (router_id, type, payload, created_by)
    values (v_router.id, 'push_vouchers', jsonb_build_object('batch_id', v_batch), auth.uid());
    perform public.wake_direct_worker(v_router.id);
  end if;

  update public.vouchers set status = 'sold', sold_at = v_now where id = v_voucher.id;
  insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at)
  values (v_voucher.id, v_voucher.site_id, v_voucher.router_id, v_voucher.plan_id, auth.uid(), v_req.amount_ssp, 'mobile_money', v_now)
  returning id into v_sale;
  update public.payment_requests
  set status = 'confirmed', voucher_id = v_voucher.id, sale_id = v_sale, decided_by = auth.uid(), decided_at = v_now
  where id = p_id;
  update public.alerts set resolved_at = v_now where tenant_id = v_req.tenant_id and key = 'payment:' || p_id and resolved_at is null;
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_req.tenant_id, auth.uid(), 'payment.confirmed', jsonb_build_object('payment_id', p_id, 'code', v_voucher.code, 'txn_ref', v_req.txn_ref, 'amount', v_req.amount_ssp));
  return jsonb_build_object('code', v_voucher.code, 'on_router', v_voucher.on_router, 'sale_id', v_sale);
end;
$$;

create or replace function public.reject_payment_request(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req public.payment_requests%rowtype;
begin
  if public.app_role() is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Give the customer a reason.' using errcode = '22023';
  end if;
  select * into v_req from public.payment_requests where id = p_id and tenant_id = public.app_tenant_id() for update;
  if not found or not public.can_access_site(v_req.site_id) then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This payment was already %.', v_req.status using errcode = '55000';
  end if;
  update public.payment_requests
  set status = 'rejected', reject_reason = left(trim(p_reason), 200), decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  update public.alerts set resolved_at = now() where tenant_id = v_req.tenant_id and key = 'payment:' || p_id and resolved_at is null;
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_req.tenant_id, auth.uid(), 'payment.rejected', jsonb_build_object('payment_id', p_id, 'txn_ref', v_req.txn_ref, 'reason', left(trim(p_reason), 200)));
end;
$$;

/**
 * Turns a site's Buy page on or off. The router(s) of the site let not-yet-logged-in customers
 * reach the page (walled garden for the given hosts: the app and Supabase).
 */
create or replace function public.save_buy_settings(p_site_id uuid, p_enabled boolean, p_slug text, p_instructions text, p_hosts text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_site public.sites%rowtype;
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_hosts text[];
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the Buy page.' using errcode = '42501';
  end if;
  select * into v_site from public.sites where id = p_site_id and tenant_id = public.app_tenant_id();
  if not found then
    raise exception 'Site not found.' using errcode = 'P0002';
  end if;
  if p_enabled and v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' then
    raise exception 'The page address may use 3 to 40 small letters, digits and dashes.' using errcode = '22023';
  end if;
  if p_enabled and length(trim(coalesce(p_instructions, ''))) < 5 then
    raise exception 'Tell customers where to send the money (number and name).' using errcode = '22023';
  end if;
  if exists (select 1 from public.sites where buy_slug = v_slug and id <> p_site_id) then
    raise exception 'This page address is taken. Choose another.' using errcode = '23505';
  end if;
  select array_agg(distinct lower(h)) into v_hosts
  from unnest(coalesce(p_hosts, '{}')) h
  where h ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';

  update public.sites
  set buy_enabled = p_enabled, buy_slug = nullif(v_slug, ''), buy_instructions = nullif(trim(coalesce(p_instructions, '')), '')
  where id = p_site_id;

  insert into public.router_jobs (router_id, type, payload, created_by)
  select r.id, 'walled_garden', jsonb_build_object('enable', p_enabled, 'hosts', to_jsonb(coalesce(v_hosts, '{}'))), auth.uid()
  from public.routers r where r.site_id = p_site_id and r.connection in ('direct', 'tunnel') and r.status <> 'pending';
  perform public.wake_direct_worker(null);
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_site.tenant_id, auth.uid(), 'site.buy_page', jsonb_build_object('site_id', p_site_id, 'enabled', p_enabled, 'slug', v_slug));
end;
$$;

revoke all on function public.confirm_payment_request(uuid) from public, anon;
revoke all on function public.reject_payment_request(uuid, text) from public, anon;
revoke all on function public.save_buy_settings(uuid, boolean, text, text, text[]) from public, anon;
grant execute on function public.confirm_payment_request(uuid) to authenticated;
grant execute on function public.reject_payment_request(uuid, text) to authenticated;
grant execute on function public.save_buy_settings(uuid, boolean, text, text, text[]) to authenticated;

-- Payments nobody confirmed within a day expire (checked with the alerts every 2 minutes).
do $$
declare
  v_def text := pg_get_functiondef('public.alerts_scan'::regproc);
  v_old text := '  if v_new > 0 or exists';
  v_new text := '  with old as (
    update public.payment_requests set status = ''expired''
    where status = ''pending'' and created_at < now() - interval ''1 day''
    returning tenant_id, id
  )
  update public.alerts a set resolved_at = now() from old where a.tenant_id = old.tenant_id and a.key = ''payment:'' || old.id and a.resolved_at is null;

  if v_new > 0 or exists';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'alerts_scan: end block not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
