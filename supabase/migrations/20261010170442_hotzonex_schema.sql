-- =============================================================================
-- Hotzonex Cloud — database schema
--
-- One migration: tables, indexes, Row Level Security, column grants and the
-- security-definer functions that own every money and voucher-status change.
--
-- Conventions
--   * Durations are integer seconds. Money is integer SSP.
--   * Reports group by the Africa/Juba time zone.
--   * The browser (role "authenticated") never writes sales, vouchers or
--     router passwords directly. The Router Agent and Edge Functions use the
--     service role, which bypasses RLS.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- =============================================================================
-- Tables
-- =============================================================================

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null unique check (length(trim(name)) > 0),
  timezone text not null default 'Africa/Juba',
  auto_sale_on_login boolean not null default false,
  is_active boolean not null default true
);

-- One row per staff login. Passwords live only in Supabase Auth.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  full_name text not null check (length(trim(full_name)) > 0),
  role text not null check (role in ('admin', 'manager', 'seller')),
  site_id uuid references public.sites (id) on delete restrict,
  is_active boolean not null default true,
  -- Managers and sellers always belong to exactly one site; admins may span all sites.
  constraint profiles_site_required check (role = 'admin' or site_id is not null)
);

create table public.routers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  site_id uuid not null references public.sites (id) on delete restrict,
  name text not null unique check (length(trim(name)) > 0),
  -- Routers are reached only by private LAN address from the Router Agent.
  ip_address inet not null check (
    family(ip_address) = 4
    and masklen(ip_address) = 32
    and (ip_address << '10.0.0.0/8' or ip_address << '172.16.0.0/12' or ip_address << '192.168.0.0/16')
  ),
  port integer not null default 80 check (port between 1 and 65535),
  use_https boolean not null default false,
  username text not null check (length(username) > 0),
  -- AES-256-GCM ciphertext written only by the add-router Edge Function. Never readable by the browser.
  password_enc text not null,
  hotspot_server text not null check (length(trim(hotspot_server)) > 0),
  dns_name text not null check (length(trim(dns_name)) > 0),
  status text not null default 'pending' check (status in ('pending', 'online', 'offline')),
  last_seen_at timestamptz,
  model text,
  ros_version text,
  last_error text
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null unique check (length(trim(name)) > 0),
  price_ssp integer not null check (price_ssp > 0),
  uptime_seconds integer not null check (uptime_seconds > 0),
  validity_seconds integer check (validity_seconds is null or validity_seconds > 0),
  rate_limit text check (rate_limit is null or rate_limit ~ '^[0-9]+[kKmMgG]?/[0-9]+[kKmMgG]?$'),
  data_limit_mb integer check (data_limit_mb is null or data_limit_mb > 0),
  shared_users integer not null default 1 check (shared_users between 1 and 50),
  color text not null default '#1f6feb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  router_profile_name text not null unique check (router_profile_name ~ '^[A-Za-z0-9_.-]{1,64}$'),
  is_active boolean not null default true
);

create table public.voucher_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  site_id uuid not null references public.sites (id) on delete restrict,
  router_id uuid not null references public.routers (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 1000),
  code_length integer not null check (code_length between 6 and 10),
  created_by uuid references public.profiles (id) on delete set null,
  note text
);

create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  batch_id uuid not null references public.voucher_batches (id) on delete restrict,
  router_id uuid not null references public.routers (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  code text not null check (code ~ '^[0-9]{6,10}$'),
  status text not null default 'unused' check (status in ('unused', 'sold', 'active', 'expired', 'disabled')),
  on_router boolean not null default false,
  printed_at timestamptz,
  sold_at timestamptz,
  first_used_at timestamptz,
  expires_at timestamptz,
  uptime_used_seconds integer not null default 0 check (uptime_used_seconds >= 0),
  bytes_used bigint not null default 0 check (bytes_used >= 0),
  constraint vouchers_code_per_router unique (router_id, code)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  voucher_id uuid not null unique references public.vouchers (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  router_id uuid not null references public.routers (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  -- Null for automatic "sell on first login" sales.
  seller_id uuid references public.profiles (id) on delete restrict,
  amount_ssp integer not null check (amount_ssp >= 0),
  payment_method text not null default 'cash' check (payment_method = 'cash'),
  sold_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text,
  constraint sales_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(trim(void_reason)) > 0)
  )
);

create table public.router_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Kept (router_id set null) when a router that failed its first test is removed,
  -- so the browser can still read the failure message.
  router_id uuid references public.routers (id) on delete set null,
  type text not null check (type in ('test_connection', 'push_vouchers', 'sync_profiles', 'disable_voucher', 'disconnect_user')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  result jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz
);

create table public.active_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  router_id uuid not null references public.routers (id) on delete cascade,
  voucher_id uuid references public.vouchers (id) on delete set null,
  code text not null,
  mac_address text not null default '',
  ip_address text,
  uptime_seconds integer not null default 0,
  bytes_in bigint not null default 0,
  bytes_out bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint active_sessions_unique unique (router_id, code, mac_address)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb
);

-- =============================================================================
-- Indexes
-- =============================================================================

create index profiles_site_id_idx on public.profiles (site_id);
create index routers_site_id_idx on public.routers (site_id);
create index voucher_batches_router_idx on public.voucher_batches (router_id, created_at desc);
create index vouchers_router_status_plan_idx on public.vouchers (router_id, status, plan_id);
create index vouchers_code_idx on public.vouchers (code);
create index vouchers_batch_idx on public.vouchers (batch_id);
create index vouchers_site_status_idx on public.vouchers (site_id, status);
create index sales_sold_at_idx on public.sales (sold_at);
create index sales_site_sold_at_idx on public.sales (site_id, sold_at);
create index sales_seller_sold_at_idx on public.sales (seller_id, sold_at);
create index router_jobs_status_created_idx on public.router_jobs (status, created_at);
create index router_jobs_router_idx on public.router_jobs (router_id, created_at desc);
create index active_sessions_router_idx on public.active_sessions (router_id);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- =============================================================================
-- Caller helpers (SECURITY DEFINER so policies can read profiles without
-- recursing into the profiles policies)
-- =============================================================================

create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.app_site_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.site_id from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

-- True when the caller is active staff allowed to see data for the given site:
-- admins and staff with no site (all sites) see everything, others only their own site.
create or replace function public.can_access_site(target_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (p.role = 'admin' or p.site_id is null or p.site_id = target_site)
  )
$$;

-- Internal: append to the audit log. Not callable from the browser.
create or replace function public.write_audit(p_action text, p_details jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (user_id, action, details) values (auth.uid(), p_action, coalesce(p_details, '{}'::jsonb))
$$;

-- Internal: random numeric code from a cryptographic source, first digit 1-9.
create or replace function public.random_numeric_code(p_length integer)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_code text := '';
  v_byte integer;
begin
  while length(v_code) < p_length loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    if length(v_code) = 0 then
      -- 252 = 9 * 28: reject the top bytes so every first digit is equally likely.
      if v_byte < 252 then
        v_code := (v_byte % 9 + 1)::text;
      end if;
    elsif v_byte < 250 then
      v_code := v_code || (v_byte % 10)::text;
    end if;
  end loop;
  return v_code;
end;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.sites enable row level security;
alter table public.profiles enable row level security;
alter table public.routers enable row level security;
alter table public.plans enable row level security;
alter table public.voucher_batches enable row level security;
alter table public.vouchers enable row level security;
alter table public.sales enable row level security;
alter table public.router_jobs enable row level security;
alter table public.active_sessions enable row level security;
alter table public.audit_log enable row level security;

-- Sites: staff see the sites they work at; only admins change them.
create policy sites_select on public.sites
  for select to authenticated using (public.can_access_site(id));
create policy sites_admin_insert on public.sites
  for insert to authenticated with check (public.is_admin());
create policy sites_admin_update on public.sites
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles: everyone reads their own row (even when inactive, so the app can
-- say "account disabled"); admins read all; managers read staff at their site.
-- Accounts are created by the create-staff Edge Function (service role).
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.is_admin());
create policy profiles_select_manager on public.profiles
  for select to authenticated using (public.app_role() = 'manager' and site_id = public.app_site_id());
create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Routers: staff see routers of their sites (never the password column, see
-- grants below). Admins may rename/edit and delete; inserts and password
-- changes go through the add-router Edge Function.
create policy routers_select on public.routers
  for select to authenticated using (public.can_access_site(site_id));
create policy routers_admin_update on public.routers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy routers_admin_delete on public.routers
  for delete to authenticated using (public.is_admin());

-- Plans: every active staff member reads plans; admins manage them.
create policy plans_select on public.plans
  for select to authenticated using (public.app_role() is not null);
create policy plans_admin_insert on public.plans
  for insert to authenticated with check (public.is_admin());
create policy plans_admin_update on public.plans
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Voucher batches and vouchers: admins and managers of the site. Sellers do
-- not read voucher codes directly; they receive a code only by selling one.
create policy voucher_batches_select on public.voucher_batches
  for select to authenticated
  using (public.app_role() in ('admin', 'manager') and public.can_access_site(site_id));
create policy vouchers_select on public.vouchers
  for select to authenticated
  using (public.app_role() in ('admin', 'manager') and public.can_access_site(site_id));

-- Sales: admins all, managers their site, sellers only their own sales.
create policy sales_select_admin_manager on public.sales
  for select to authenticated
  using (public.app_role() in ('admin', 'manager') and public.can_access_site(site_id));
create policy sales_select_seller on public.sales
  for select to authenticated
  using (public.app_role() = 'seller' and seller_id = auth.uid());

-- Router jobs: staff read jobs for routers they can see. Admins may queue the
-- jobs the browser starts itself (Test again, profile sync, Disconnect);
-- pushes and disables are queued only by database functions.
create policy router_jobs_select on public.router_jobs
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.app_role() in ('admin', 'manager')
      and exists (select 1 from public.routers r where r.id = router_id and public.can_access_site(r.site_id))
    )
  );
create policy router_jobs_admin_insert on public.router_jobs
  for insert to authenticated
  with check (
    public.is_admin()
    and type in ('test_connection', 'sync_profiles', 'disconnect_user')
    and status = 'queued'
    and attempts = 0
    and result is null
    and started_at is null
    and finished_at is null
    and created_by = auth.uid()
  );

-- Active sessions: admins and managers of the site.
create policy active_sessions_select on public.active_sessions
  for select to authenticated
  using (
    public.app_role() in ('admin', 'manager')
    and exists (select 1 from public.routers r where r.id = router_id and public.can_access_site(r.site_id))
  );

-- Audit log: admins read; rows are written by functions and Edge Functions only.
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_admin());

-- =============================================================================
-- Table and column privileges
-- =============================================================================

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

grant select, insert, update on public.sites to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.plans to authenticated;
grant select on public.voucher_batches, public.vouchers, public.sales,
  public.active_sessions, public.audit_log to authenticated;
grant select, insert on public.router_jobs to authenticated;

-- Routers: every column except password_enc. Admins may edit descriptive and
-- connection fields; status fields are written by the Router Agent.
grant select (
  id, created_at, site_id, name, ip_address, port, use_https, username,
  hotspot_server, dns_name, status, last_seen_at, model, ros_version, last_error
) on public.routers to authenticated;
grant update (name, site_id, ip_address, port, use_https, username, hotspot_server, dns_name)
  on public.routers to authenticated;
grant delete on public.routers to authenticated;

-- =============================================================================
-- generate_vouchers: create a batch of unique numeric codes and queue the push
-- =============================================================================

create or replace function public.generate_vouchers(
  p_router_id uuid,
  p_plan_id uuid,
  p_quantity integer,
  p_code_length integer default 8
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text := public.app_role();
  v_router public.routers%rowtype;
  v_plan public.plans%rowtype;
  v_batch_id uuid;
  v_inserted integer := 0;
  v_rows integer;
  v_rounds integer := 0;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can generate vouchers.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity not between 1 and 1000 then
    raise exception 'Quantity must be between 1 and 1000.' using errcode = '22023';
  end if;
  if p_code_length is null or p_code_length not between 6 and 10 then
    raise exception 'Code length must be between 6 and 10 digits.' using errcode = '22023';
  end if;

  select * into v_router from public.routers where id = p_router_id;
  if not found then
    raise exception 'Router not found.' using errcode = 'P0002';
  end if;
  if not public.can_access_site(v_router.site_id) then
    raise exception 'You can only generate vouchers for your own site.' using errcode = '42501';
  end if;
  if v_router.status = 'pending' then
    raise exception 'Router % has not passed its connection test yet.', v_router.name using errcode = '55000';
  end if;
  if not exists (select 1 from public.sites s where s.id = v_router.site_id and s.is_active) then
    raise exception 'The site for router % is switched off.', v_router.name using errcode = '55000';
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if not found or not v_plan.is_active then
    raise exception 'This plan does not exist or is switched off.' using errcode = 'P0002';
  end if;

  insert into public.voucher_batches (site_id, router_id, plan_id, quantity, code_length, created_by)
  values (v_router.site_id, v_router.id, v_plan.id, p_quantity, p_code_length, auth.uid())
  returning id into v_batch_id;

  -- Insert random codes; collisions with existing codes on this router are skipped
  -- and topped up on the next round.
  loop
    insert into public.vouchers (batch_id, router_id, site_id, plan_id, code)
    select v_batch_id, v_router.id, v_router.site_id, v_plan.id, public.random_numeric_code(p_code_length)
    from generate_series(1, p_quantity - v_inserted)
    on conflict on constraint vouchers_code_per_router do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
    exit when v_inserted >= p_quantity;
    v_rounds := v_rounds + 1;
    if v_rounds >= 25 then
      raise exception 'Could not find enough unused % digit codes on router %. Use a longer code length.',
        p_code_length, v_router.name using errcode = '54000';
    end if;
  end loop;

  insert into public.router_jobs (router_id, type, payload, created_by)
  values (v_router.id, 'push_vouchers', jsonb_build_object('batch_id', v_batch_id), auth.uid());

  return v_batch_id;
end;
$$;

-- =============================================================================
-- sell_voucher: atomically take the oldest sellable voucher and record a sale
-- =============================================================================

create or replace function public.sell_voucher(p_router_id uuid, p_plan_id uuid)
returns table (sale_id uuid, voucher_id uuid, code text, amount_ssp integer, sold_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text := public.app_role();
  v_router public.routers%rowtype;
  v_plan public.plans%rowtype;
  v_voucher public.vouchers%rowtype;
  v_now timestamptz := now();
  v_sale_id uuid;
begin
  if v_role is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;

  select * into v_router from public.routers where id = p_router_id;
  if not found then
    raise exception 'Router not found.' using errcode = 'P0002';
  end if;
  if not public.can_access_site(v_router.site_id) then
    raise exception 'You can only sell vouchers for your own site.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sites s where s.id = v_router.site_id and s.is_active) then
    raise exception 'The site for router % is switched off.', v_router.name using errcode = '55000';
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if not found or not v_plan.is_active then
    raise exception 'This plan does not exist or is switched off.' using errcode = 'P0002';
  end if;

  -- Pre-printed cards (printed_at set) may already be in a customer's hand, so the
  -- cashier never sells them; they are recorded through "Mark as sold" instead.
  select * into v_voucher
  from public.vouchers v
  where v.router_id = v_router.id
    and v.plan_id = v_plan.id
    and v.status = 'unused'
    and v.on_router
    and v.printed_at is null
  order by v.created_at, v.id
  limit 1
  for update skip locked;

  if not found then
    raise exception 'Out of stock: no % vouchers left on %. Generate more vouchers.', v_plan.name, v_router.name
      using errcode = 'P0001';
  end if;

  update public.vouchers v set status = 'sold', sold_at = v_now where v.id = v_voucher.id;

  insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at)
  values (v_voucher.id, v_router.site_id, v_router.id, v_plan.id, auth.uid(), v_plan.price_ssp, 'cash', v_now)
  returning id into v_sale_id;

  return query select v_sale_id, v_voucher.id, v_voucher.code, v_plan.price_ssp, v_now;
end;
$$;

-- =============================================================================
-- report_sales: totals per day / week (Mon-Sun) / month in Africa/Juba time.
-- Voided sales are excluded. Every period in the range is returned, with zeros
-- for periods without sales.
-- =============================================================================

create or replace function public.report_sales(
  p_site_id uuid,
  p_date_from date,
  p_date_to date,
  p_group_by text,
  p_plan_id uuid default null,
  p_seller_id uuid default null
)
returns table (period_start date, vouchers_sold bigint, revenue_ssp bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text := public.app_role();
  v_site uuid := p_site_id;
  v_step interval;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can open reports.' using errcode = '42501';
  end if;
  if v_role = 'manager' then
    -- Managers always report on their own site.
    if v_site is not null and v_site is distinct from public.app_site_id() then
      raise exception 'You can only see reports for your own site.' using errcode = '42501';
    end if;
    v_site := public.app_site_id();
  end if;
  if p_group_by not in ('day', 'week', 'month') then
    raise exception 'Group by must be day, week or month.' using errcode = '22023';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;
  if p_date_to - p_date_from > 3700 then
    raise exception 'The date range is too long (more than 10 years).' using errcode = '22023';
  end if;

  v_step := ('1 ' || p_group_by)::interval;

  return query
  with periods as (
    select gs::date as period_start
    from generate_series(
      date_trunc(p_group_by, p_date_from::timestamp),
      date_trunc(p_group_by, p_date_to::timestamp),
      v_step
    ) as gs
  ),
  totals as (
    select
      date_trunc(p_group_by, s.sold_at at time zone 'Africa/Juba')::date as period_start,
      count(*)::bigint as vouchers_sold,
      sum(s.amount_ssp)::bigint as revenue_ssp
    from public.sales s
    where s.voided_at is null
      and s.sold_at >= (p_date_from::timestamp at time zone 'Africa/Juba')
      and s.sold_at < ((p_date_to + 1)::timestamp at time zone 'Africa/Juba')
      and (v_site is null or s.site_id = v_site)
      and (p_plan_id is null or s.plan_id = p_plan_id)
      and (p_seller_id is null or s.seller_id = p_seller_id)
    group by 1
  )
  select p.period_start, coalesce(t.vouchers_sold, 0), coalesce(t.revenue_ssp, 0)
  from periods p
  left join totals t using (period_start)
  order by p.period_start;
end;
$$;

-- =============================================================================
-- Function privileges
-- =============================================================================

revoke all on function public.app_role() from public;
revoke all on function public.app_site_id() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.can_access_site(uuid) from public;
revoke all on function public.write_audit(text, jsonb) from public;
revoke all on function public.random_numeric_code(integer) from public;
revoke all on function public.generate_vouchers(uuid, uuid, integer, integer) from public;
revoke all on function public.sell_voucher(uuid, uuid) from public;
revoke all on function public.report_sales(uuid, date, date, text, uuid, uuid) from public;

grant execute on function public.app_role() to authenticated, service_role;
grant execute on function public.app_site_id() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.can_access_site(uuid) to authenticated, service_role;
grant execute on function public.write_audit(text, jsonb) to service_role;
grant execute on function public.random_numeric_code(integer) to service_role;
grant execute on function public.generate_vouchers(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.sell_voucher(uuid, uuid) to authenticated;
grant execute on function public.report_sales(uuid, date, date, text, uuid, uuid) to authenticated;

-- =============================================================================
-- Realtime: the browser listens for job results and live users. (routers is
-- left out so password_enc never travels over a Realtime channel.)
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.router_jobs, public.active_sessions;
  end if;
end;
$$;
