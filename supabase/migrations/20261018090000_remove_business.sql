-- Removing a business for good (the owner left Hotzonex Cloud). Switching off only pauses it; this
-- erases its sites, routers, plans, vouchers, sales, expenses, billing, alerts and staff, so it
-- cannot be undone. Platform admins only, through the delete-items function (which also removes
-- the staff logins and the logo), and only once the business is switched off and its name typed.
-- A short note of what was removed is kept in removed_businesses.

create table if not exists public.removed_businesses (
  id uuid primary key,
  name text not null,
  removed_at timestamptz not null default now(),
  removed_by uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb
);
alter table public.removed_businesses enable row level security;
revoke all on public.removed_businesses from anon, authenticated;
grant select on public.removed_businesses to authenticated;
create policy "removed businesses: platform admins read" on public.removed_businesses
  for select to authenticated using (public.is_platform_admin());

create or replace function public.remove_tenant(p_tenant_id uuid, p_by uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_users uuid[];
  v_counts jsonb;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'Business not found.' using errcode = 'P0002';
  end if;
  if v_tenant.is_active then
    raise exception 'Switch the business off before removing it.' using errcode = '55000';
  end if;
  if lower(btrim(coalesce(p_name, ''))) <> lower(btrim(v_tenant.name)) then
    raise exception 'Type the business name exactly to remove it.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_by and p.tenant_id = p_tenant_id)
     or exists (select 1 from public.profiles p join public.platform_admins a on a.user_id = p.id where p.tenant_id = p_tenant_id) then
    raise exception 'A Hotzonex Cloud platform admin belongs to this business, so it cannot be removed.' using errcode = '55000';
  end if;

  select coalesce(array_agg(p.id), '{}') into v_users from public.profiles p where p.tenant_id = p_tenant_id;
  v_counts := jsonb_build_object(
    'sites', (select count(*) from public.sites where tenant_id = p_tenant_id),
    'routers', (select count(*) from public.routers where tenant_id = p_tenant_id),
    'vouchers', (select count(*) from public.vouchers where tenant_id = p_tenant_id),
    'sales', (select count(*) from public.sales where tenant_id = p_tenant_id),
    'staff', cardinality(v_users));

  -- Children before parents (most links are "restrict" to keep sales history safe).
  delete from public.payment_requests where tenant_id = p_tenant_id;
  delete from public.cash_handovers where tenant_id = p_tenant_id;
  delete from public.expenses where tenant_id = p_tenant_id;
  delete from public.alerts where tenant_id = p_tenant_id;
  delete from public.alert_settings where tenant_id = p_tenant_id;
  delete from public.invoices where tenant_id = p_tenant_id;
  delete from public.tenant_billing where tenant_id = p_tenant_id;
  delete from public.active_sessions where tenant_id = p_tenant_id;
  delete from public.portal_configs where tenant_id = p_tenant_id;
  delete from public.router_logins where tenant_id = p_tenant_id;
  delete from public.router_profile_ignores where tenant_id = p_tenant_id;
  delete from public.plan_routers where tenant_id = p_tenant_id;
  delete from public.sales where tenant_id = p_tenant_id;
  delete from public.vouchers where tenant_id = p_tenant_id;
  delete from public.voucher_batches where tenant_id = p_tenant_id;
  delete from public.routers where tenant_id = p_tenant_id;
  delete from public.router_jobs where tenant_id = p_tenant_id;
  delete from public.plans where tenant_id = p_tenant_id;
  delete from public.profiles where tenant_id = p_tenant_id;
  delete from public.sites where tenant_id = p_tenant_id;
  delete from public.audit_log where tenant_id = p_tenant_id;
  delete from public.tenants where id = p_tenant_id;

  insert into public.removed_businesses (id, name, removed_by, details)
  values (p_tenant_id, v_tenant.name, p_by, v_counts)
  on conflict (id) do nothing;

  return jsonb_build_object('name', v_tenant.name, 'users', to_jsonb(v_users), 'counts', v_counts);
end;
$$;

revoke all on function public.remove_tenant(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.remove_tenant(uuid, uuid, text) to service_role;
