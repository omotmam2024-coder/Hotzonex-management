-- MTN MoMo API payments on the Buy page.
--
-- 1. momo_accounts: each business's own MTN MoMo Open API (Collections) login. The API key and the
--    subscription key are stored encrypted by the momo Edge Function (AES-256-GCM, key in Vault);
--    no browser role can read the table. momo_account() tells an admin what is set, never a key.
-- 2. payment_requests.method: 'manual' (the customer types the transaction ID, a cashier confirms)
--    or 'api' (Hotzonex asked MoMo to charge the customer's phone; MoMo's answer confirms it).
-- 3. fulfil_payment_request: the card-and-sale step of a confirmation, shared by the cashier's
--    confirm_payment_request and the automatic MoMo confirmation (service role only).

create table if not exists public.momo_accounts (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default false,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  target_environment text not null default 'sandbox' check (target_environment ~ '^[a-z]{3,40}$'),
  currency text not null default 'SSP' check (currency ~ '^[A-Z]{3}$'),
  api_user text not null check (api_user ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  api_key_enc text not null,
  subscription_key_enc text not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.momo_accounts enable row level security;
revoke all on public.momo_accounts from public, anon, authenticated;
create index if not exists momo_accounts_updated_by_fk_idx on public.momo_accounts (updated_by);

alter table public.payment_requests
  add column if not exists method text not null default 'manual' check (method in ('manual', 'api')),
  add column if not exists momo_ref uuid unique,
  add column if not exists momo_txn_id text check (length(momo_txn_id) <= 80),
  add column if not exists checked_at timestamptz;
grant select (method, momo_txn_id) on public.payment_requests to authenticated;
create index if not exists payment_requests_api_pending on public.payment_requests (created_at)
  where method = 'api' and status = 'pending';

-- What an admin sees of the business's MoMo login: whether it is set and on, never a key.
create or replace function public.momo_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.momo_accounts%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this.' using errcode = '42501';
  end if;
  select * into v from public.momo_accounts where tenant_id = public.app_tenant_id();
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object('configured', true, 'enabled', v.enabled, 'environment', v.environment,
    'target_environment', v.target_environment, 'currency', v.currency, 'api_user', v.api_user, 'updated_at', v.updated_at);
end;
$$;
revoke all on function public.momo_account() from public, anon;
grant execute on function public.momo_account() to authenticated;

-- The card and the sale for a payment request that is known to be paid. p_by: the cashier who
-- confirmed it, or null when MoMo itself confirmed the payment.
create or replace function public.fulfil_payment_request(p_id uuid, p_by uuid, p_momo_txn_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
  select * into v_req from public.payment_requests where id = p_id for update;
  if not found then
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
    values (v_router.site_id, v_router.id, v_plan.id, 1, v_len, p_by, 'Mobile-money purchase')
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
    values (v_router.id, 'push_vouchers', jsonb_build_object('batch_id', v_batch), p_by);
    perform public.wake_direct_worker(v_router.id);
  end if;

  update public.vouchers set status = 'sold', sold_at = v_now where id = v_voucher.id;
  insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at)
  values (v_voucher.id, v_voucher.site_id, v_voucher.router_id, v_voucher.plan_id, p_by, v_req.amount_ssp, 'mobile_money', v_now)
  returning id into v_sale;
  update public.payment_requests
  set status = 'confirmed', voucher_id = v_voucher.id, sale_id = v_sale, decided_by = p_by, decided_at = v_now,
      momo_txn_id = coalesce(p_momo_txn_id, momo_txn_id)
  where id = p_id;
  update public.alerts set resolved_at = v_now where tenant_id = v_req.tenant_id and key = 'payment:' || p_id and resolved_at is null;
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_req.tenant_id, p_by, 'payment.confirmed', jsonb_build_object('payment_id', p_id, 'code', v_voucher.code, 'txn_ref', v_req.txn_ref,
    'amount', v_req.amount_ssp, 'method', v_req.method, 'momo_txn_id', p_momo_txn_id));
  return jsonb_build_object('code', v_voucher.code, 'on_router', v_voucher.on_router, 'sale_id', v_sale);
end;
$$;
revoke all on function public.fulfil_payment_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fulfil_payment_request(uuid, uuid, text) to service_role;

-- The cashier's Confirm: checks who may confirm, then the shared step above.
create or replace function public.confirm_payment_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.payment_requests%rowtype;
begin
  if public.app_role() is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  select * into v_req from public.payment_requests where id = p_id and tenant_id = public.app_tenant_id() for update;
  if not found or not public.can_access_site(v_req.site_id) then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  return public.fulfil_payment_request(p_id, auth.uid());
end;
$$;
revoke all on function public.confirm_payment_request(uuid) from public, anon;
grant execute on function public.confirm_payment_request(uuid) to authenticated;

-- MoMo payments a customer left before MoMo answered are checked every 2 minutes (buy, "momo_sweep").
create or replace function public.wake_momo_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := (select replace(value, '/router-direct', '/buy') from public.app_config where key = 'direct_worker_url');
  v_secret text := (select value from public.app_config where key = 'direct_worker_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (select 1 from public.payment_requests where method = 'api' and status = 'pending') then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'momo_sweep'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hzc-worker', v_secret),
    timeout_milliseconds := 5000
  );
end;
$$;
revoke all on function public.wake_momo_sweep() from public, anon, authenticated;

select cron.unschedule('hzc-momo-sweep') where exists (select 1 from cron.job where jobname = 'hzc-momo-sweep');
select cron.schedule('hzc-momo-sweep', '*/2 * * * *', 'select public.wake_momo_sweep()');
