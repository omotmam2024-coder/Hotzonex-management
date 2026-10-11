-- ---------------------------------------------------------------------------
-- 9. Platform admins: list businesses, switch one off
-- ---------------------------------------------------------------------------
create or replace function public.platform_tenants()
returns table(id uuid, name text, timezone text, currency text, is_active boolean, created_at timestamptz,
              sites bigint, routers bigint, staff bigint, admin_names text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can see all businesses.' using errcode = '42501';
  end if;
  return query
  select t.id, t.name, t.timezone, t.currency, t.is_active, t.created_at,
         (select count(*) from public.sites s where s.tenant_id = t.id),
         (select count(*) from public.routers r where r.tenant_id = t.id),
         (select count(*) from public.profiles p where p.tenant_id = t.id and p.is_active),
         (select string_agg(p.full_name, ', ' order by p.full_name) from public.profiles p
          where p.tenant_id = t.id and p.role = 'admin' and p.is_active)
  from public.tenants t
  order by t.name;
end;
$$;

create or replace function public.platform_set_tenant_active(p_tenant_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only Hotzonex Cloud platform admins can switch a business on or off.' using errcode = '42501';
  end if;
  if p_tenant_id = (select p.tenant_id from public.profiles p where p.id = auth.uid()) and not p_active then
    raise exception 'You cannot switch off your own business.' using errcode = '55000';
  end if;
  update public.tenants set is_active = coalesce(p_active, true) where id = p_tenant_id;
  if not found then
    raise exception 'Business not found.' using errcode = 'P0002';
  end if;
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (p_tenant_id, auth.uid(), case when p_active then 'tenant.enabled' else 'tenant.disabled' end, '{}'::jsonb);
end;
$$;

grant execute on function public.platform_tenants(), public.platform_set_tenant_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Indexes and housekeeping
-- ---------------------------------------------------------------------------
-- The Sell screen's next-voucher pick and stock count.
create index if not exists vouchers_sell_idx on public.vouchers (router_id, plan_id, created_at, id)
  where status = 'unused' and on_router and printed_at is null;
create index if not exists vouchers_site_created_idx on public.vouchers (site_id, created_at);
