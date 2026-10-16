-- Subscription plans with limits (AUDIT.md §9, High).
--
-- * subscription_plans: what each plan allows (routers, sites, active staff, vouchers generated per
--   month; null = no limit) and, optionally, its own price per router per month (null = the
--   standard price on the Billing settings). Edited by the platform owner only.
-- * tenant_billing.plan_id: the plan of each business. Businesses that exist today get "business"
--   (no surprise blocks); new businesses start on "starter".
-- * Limits are enforced by the database (a trigger on routers, sites, profiles and voucher
--   batches), whatever screen or function adds the row. Businesses that are not billed (Hotzonex's
--   own) have no limits.
-- * billing_usage(): an owner sees their plan and usage. public_pricing(): the public landing page
--   shows the plans (no login). platform_*: the platform owner edits plans and moves businesses.

create table if not exists public.subscription_plans (
  id text primary key check (id ~ '^[a-z0-9-]{2,30}$'),
  name text not null check (length(btrim(name)) between 1 and 40),
  description text not null default '' check (length(description) <= 300),
  price_per_router_ssp integer check (price_per_router_ssp is null or price_per_router_ssp >= 0),
  max_routers integer check (max_routers is null or max_routers >= 0),
  max_sites integer check (max_sites is null or max_sites >= 0),
  max_staff integer check (max_staff is null or max_staff >= 0),
  max_vouchers_month integer check (max_vouchers_month is null or max_vouchers_month >= 0),
  sort integer not null default 0,
  is_public boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;
revoke all on public.subscription_plans from anon, authenticated;

insert into public.subscription_plans (id, name, description, max_routers, max_sites, max_staff, max_vouchers_month, sort) values
  ('starter', 'Starter', 'One hotspot: one router, one site, a few cashiers.', 1, 1, 3, 5000, 1),
  ('business', 'Business', 'Several sites and routers, cashiers and agents.', 5, 3, 15, 30000, 2),
  ('pro', 'Pro', 'No limits: as many routers, sites, staff and vouchers as you need.', null, null, null, null, 3)
on conflict (id) do nothing;

alter table public.tenant_billing add column if not exists plan_id text references public.subscription_plans (id);
update public.tenant_billing set plan_id = 'business' where plan_id is null;
alter table public.tenant_billing alter column plan_id set default 'starter';
alter table public.tenant_billing alter column plan_id set not null;

-- ---------------------------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------------------------

create or replace function public.plan_limit_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_exempt boolean;
  v_tz text;
  v_count bigint;
  v_upgrade constant text := ' Ask Hotzonex Cloud to move you to a bigger plan.';
begin
  if new.tenant_id is null then
    return new;
  end if;
  select sp.* into v_plan
  from public.tenant_billing tb join public.subscription_plans sp on sp.id = tb.plan_id
  where tb.tenant_id = new.tenant_id;
  select tb.exempt into v_exempt from public.tenant_billing tb where tb.tenant_id = new.tenant_id;
  -- No plan row (being created), not billed, or Hotzonex Cloud's own business: no limits.
  if v_plan.id is null or v_exempt
     or exists (select 1 from public.platform_admins a join public.profiles p on p.id = a.user_id where p.tenant_id = new.tenant_id) then
    return new;
  end if;

  if tg_table_name = 'routers' and v_plan.max_routers is not null then
    select count(*) into v_count from public.routers where tenant_id = new.tenant_id;
    if v_count >= v_plan.max_routers then
      raise exception 'Your % plan allows % router(s).%', v_plan.name, v_plan.max_routers, v_upgrade using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'sites' and v_plan.max_sites is not null then
    select count(*) into v_count from public.sites where tenant_id = new.tenant_id;
    if v_count >= v_plan.max_sites then
      raise exception 'Your % plan allows % site(s).%', v_plan.name, v_plan.max_sites, v_upgrade using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'profiles' and v_plan.max_staff is not null then
    -- Only a login that becomes active counts (switching staff off is always allowed).
    if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
      select count(*) into v_count from public.profiles where tenant_id = new.tenant_id and is_active and id <> new.id;
      if v_count >= v_plan.max_staff then
        raise exception 'Your % plan allows % staff login(s).%', v_plan.name, v_plan.max_staff, v_upgrade using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'voucher_batches' and v_plan.max_vouchers_month is not null then
    select coalesce(t.timezone, 'Africa/Juba') into v_tz from public.tenants t where t.id = new.tenant_id;
    select coalesce(sum(b.quantity), 0) into v_count
    from public.voucher_batches b
    where b.tenant_id = new.tenant_id
      and b.created_at >= (date_trunc('month', now() at time zone v_tz) at time zone v_tz);
    if v_count + new.quantity > v_plan.max_vouchers_month then
      raise exception 'Your % plan allows % vouchers a month; % made already this month.%',
        v_plan.name, v_plan.max_vouchers_month, v_count, v_upgrade using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.plan_limit_check() from public, anon, authenticated;

-- After aa_set_tenant (BEFORE triggers run in name order), so tenant_id is filled in.
create trigger ac_plan_limit before insert on public.routers for each row execute function public.plan_limit_check();
create trigger ac_plan_limit before insert on public.sites for each row execute function public.plan_limit_check();
create trigger ac_plan_limit before insert or update of is_active on public.profiles for each row execute function public.plan_limit_check();
create trigger ac_plan_limit before insert on public.voucher_batches for each row execute function public.plan_limit_check();

-- ---------------------------------------------------------------------------------------------
-- Price: a business's own price, else its plan's price, else the standard price.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  v_def text := pg_get_functiondef('public.billing_run'::regproc);
  v_new text := replace(v_def,
    'v_price := coalesce(b.price_per_router_ssp, v_std);',
    'v_price := coalesce(b.price_per_router_ssp, (select sp.price_per_router_ssp from public.subscription_plans sp where sp.id = b.plan_id), v_std);');
begin
  if v_new = v_def then
    raise exception 'billing_run: price line not found';
  end if;
  execute v_new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reading plans and usage
-- ---------------------------------------------------------------------------------------------

/** The owner's plan and how much of it is used (Billing page). */
create or replace function public.billing_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_tz text;
  v_result jsonb;
begin
  if v_tenant is null or public.app_role() is distinct from 'admin' then
    raise exception 'Only the business owner can see the plan.' using errcode = '42501';
  end if;
  select coalesce(timezone, 'Africa/Juba') into v_tz from public.tenants where id = v_tenant;
  select jsonb_build_object(
    'plan', jsonb_build_object('id', sp.id, 'name', sp.name, 'description', sp.description,
      'max_routers', sp.max_routers, 'max_sites', sp.max_sites, 'max_staff', sp.max_staff, 'max_vouchers_month', sp.max_vouchers_month),
    'limited', not tb.exempt,
    'usage', jsonb_build_object(
      'routers', (select count(*) from public.routers where tenant_id = v_tenant),
      'sites', (select count(*) from public.sites where tenant_id = v_tenant),
      'staff', (select count(*) from public.profiles where tenant_id = v_tenant and is_active),
      'vouchers_month', (select coalesce(sum(quantity), 0) from public.voucher_batches
                         where tenant_id = v_tenant and created_at >= (date_trunc('month', now() at time zone v_tz) at time zone v_tz))))
  into v_result
  from public.tenant_billing tb join public.subscription_plans sp on sp.id = tb.plan_id
  where tb.tenant_id = v_tenant;
  return v_result;
end;
$$;

revoke all on function public.billing_usage() from public, anon;
grant execute on function public.billing_usage() to authenticated;

/** The public plans and prices, for the landing page (no login). */
create or replace function public.public_pricing()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'standard_price_per_router_ssp', coalesce(nullif(public.billing_config('billing_price_per_router_ssp', '0'), '')::integer, 0),
    'trial_days', coalesce(nullif(public.billing_config('billing_trial_days', '14'), '')::integer, 14),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
        'price_per_router_ssp', price_per_router_ssp, 'max_routers', max_routers, 'max_sites', max_sites,
        'max_staff', max_staff, 'max_vouchers_month', max_vouchers_month) order by sort)
      from public.subscription_plans where is_public), '[]'::jsonb));
$$;

revoke all on function public.public_pricing() from public;
grant execute on function public.public_pricing() to anon, authenticated;

/** Platform owner: every plan (also hidden ones) and each business's plan and usage this month. */
create or replace function public.platform_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can see plans.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'plans', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.sort) from public.subscription_plans sp), '[]'::jsonb),
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', tb.tenant_id, 'plan_id', tb.plan_id, 'exempt', tb.exempt,
        'vouchers_month', (select coalesce(sum(b.quantity), 0) from public.voucher_batches b
          where b.tenant_id = tb.tenant_id
            and b.created_at >= (date_trunc('month', now() at time zone coalesce(t.timezone, 'Africa/Juba')) at time zone coalesce(t.timezone, 'Africa/Juba')))))
      from public.tenant_billing tb join public.tenants t on t.id = tb.tenant_id), '[]'::jsonb));
end;
$$;

revoke all on function public.platform_plans() from public, anon;
grant execute on function public.platform_plans() to authenticated;

create or replace function public.platform_set_business_plan(p_tenant_id uuid, p_plan_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can change plans.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subscription_plans where id = p_plan_id) then
    raise exception 'That plan does not exist.' using errcode = 'P0002';
  end if;
  update public.tenant_billing set plan_id = p_plan_id, updated_at = now() where tenant_id = p_tenant_id;
  if not found then
    raise exception 'Business not found.' using errcode = 'P0002';
  end if;
  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), 'billing.plan_changed', jsonb_build_object('plan_id', p_plan_id), p_tenant_id);
end;
$$;

revoke all on function public.platform_set_business_plan(uuid, text) from public, anon;
grant execute on function public.platform_set_business_plan(uuid, text) to authenticated;

create or replace function public.platform_save_plan(
  p_id text, p_name text, p_description text, p_price_per_router_ssp integer,
  p_max_routers integer, p_max_sites integer, p_max_staff integer, p_max_vouchers_month integer, p_is_public boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can change plans.' using errcode = '42501';
  end if;
  insert into public.subscription_plans (id, name, description, price_per_router_ssp, max_routers, max_sites, max_staff, max_vouchers_month, is_public, sort)
  values (lower(btrim(p_id)), btrim(p_name), coalesce(p_description, ''), p_price_per_router_ssp, p_max_routers, p_max_sites, p_max_staff,
          p_max_vouchers_month, coalesce(p_is_public, true), (select coalesce(max(sort), 0) + 1 from public.subscription_plans))
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, price_per_router_ssp = excluded.price_per_router_ssp,
    max_routers = excluded.max_routers, max_sites = excluded.max_sites, max_staff = excluded.max_staff,
    max_vouchers_month = excluded.max_vouchers_month, is_public = excluded.is_public, updated_at = now();
  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), 'billing.plan_saved', jsonb_build_object('plan_id', lower(btrim(p_id)), 'name', btrim(p_name),
    'price_per_router_ssp', p_price_per_router_ssp, 'max_routers', p_max_routers, 'max_sites', p_max_sites,
    'max_staff', p_max_staff, 'max_vouchers_month', p_max_vouchers_month), public.platform_tenant_id());
end;
$$;

revoke all on function public.platform_save_plan(text, text, text, integer, integer, integer, integer, integer, boolean) from public, anon;
grant execute on function public.platform_save_plan(text, text, text, integer, integer, integer, integer, integer, boolean) to authenticated;
