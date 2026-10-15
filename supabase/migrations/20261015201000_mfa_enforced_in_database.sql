-- Someone who turned on the 2-step login gets no access at all until they have typed the code
-- (enforced here, not only in the app): a stolen password alone opens nothing.
create or replace function public.mfa_satisfied()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

create or replace function public.app_tenant_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select case when public.mfa_satisfied() then coalesce(
    (select a.acting_tenant_id
     from public.platform_admins a
     join public.profiles p on p.id = a.user_id and p.is_active
     join public.tenants own on own.id = p.tenant_id and own.is_active
     where a.user_id = auth.uid() and a.acting_tenant_id is not null and a.acting_until > now()
       and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'),
    (select p.tenant_id
     from public.profiles p
     join public.tenants t on t.id = p.tenant_id
     where p.id = auth.uid() and p.is_active and t.is_active)) end;
$$;

create or replace function public.app_role()
returns text
language sql stable security definer set search_path = public as $$
  select p.role
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = auth.uid() and p.is_active and t.is_active and public.mfa_satisfied();
$$;

create or replace function public.billing_tenant_of_caller()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid() and p.is_active and p.role = 'admin' and public.mfa_satisfied();
$$;
