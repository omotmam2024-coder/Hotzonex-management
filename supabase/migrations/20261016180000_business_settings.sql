-- Business settings for owners: name, logo and a USD exchange rate (AUDIT.md §4 USD, §9 branding).
--
-- * tenants.usd_rate: how many SSP make 1 USD, set by the owner. The app shows USD next to SSP when
--   it is set (prices and sales stay in SSP).
-- * save_business_settings(): the owner (role admin) of the business changes its name, logo and
--   rate. Recorded in the audit log.
-- * Storage bucket "logos": public images (they print on cards and show on the Buy page); a
--   business's owner can only write inside the folder named after the business id.

alter table public.tenants add column if not exists usd_rate numeric(12, 2);
alter table public.tenants add constraint tenants_usd_rate_positive check (usd_rate is null or usd_rate > 0);
grant select (usd_rate) on public.tenants to authenticated;

create or replace function public.save_business_settings(p_name text, p_logo_url text, p_usd_rate numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_logo text := nullif(btrim(coalesce(p_logo_url, '')), '');
  v_old public.tenants%rowtype;
begin
  if v_tenant is null or public.app_role() is distinct from 'admin' then
    raise exception 'Only the business owner can change these settings.' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 100 then
    raise exception 'The business name must be 1 to 100 characters.' using errcode = '22023';
  end if;
  if v_logo is not null and (length(v_logo) > 500 or v_logo !~ '^(https://|/)') then
    raise exception 'The logo must be an uploaded image or an https:// address.' using errcode = '22023';
  end if;
  if p_usd_rate is not null and (p_usd_rate <= 0 or p_usd_rate > 1000000) then
    raise exception 'The exchange rate must be the number of SSP for 1 USD.' using errcode = '22023';
  end if;

  select * into v_old from public.tenants where id = v_tenant;
  begin
    update public.tenants set name = v_name, logo_url = v_logo, usd_rate = round(p_usd_rate, 2) where id = v_tenant;
  exception when unique_violation then
    raise exception 'Another business already uses the name %.', v_name using errcode = '23505';
  end;

  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), 'business.settings', jsonb_build_object(
    'name', jsonb_build_object('from', v_old.name, 'to', v_name),
    'logo_changed', v_old.logo_url is distinct from v_logo,
    'usd_rate', jsonb_build_object('from', v_old.usd_rate, 'to', round(p_usd_rate, 2))), v_tenant);
end;
$$;

revoke all on function public.save_business_settings(text, text, numeric) from public, anon;
grant execute on function public.save_business_settings(text, text, numeric) to authenticated;

-- Logos: readable by everyone (printed cards, the public Buy page); written only by the owner, in
-- their own business's folder; images up to 1 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "logos: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = public.app_tenant_id()::text and public.app_role() = 'admin');
create policy "logos: owner replaces" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = public.app_tenant_id()::text and public.app_role() = 'admin');
create policy "logos: owner removes" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = public.app_tenant_id()::text and public.app_role() = 'admin');
