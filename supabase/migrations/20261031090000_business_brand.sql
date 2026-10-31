-- Per-business branding: a brand colour and a short tagline, shown on the business's Buy page and
-- printed cards/receipts (the name and logo already are). Only the business owner (role admin) can
-- change them, through save_business_brand(); logged in the audit log.
--
-- * brand_color: '#rrggbb' or null (null = the Hotzonex blue). The strict format also means the value
--   is safe to put into a style attribute.
-- * tagline: up to 80 characters or null.
-- authenticated already has table-level SELECT on tenants (own row only, by RLS) and no UPDATE.

alter table public.tenants add column if not exists brand_color text;
alter table public.tenants add column if not exists tagline text;
alter table public.tenants add constraint tenants_brand_color_format check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.tenants add constraint tenants_tagline_length check (tagline is null or char_length(tagline) between 1 and 80);

create or replace function public.save_business_brand(p_color text, p_tagline text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_color text := nullif(lower(btrim(coalesce(p_color, ''))), '');
  v_tagline text := nullif(btrim(coalesce(p_tagline, '')), '');
  v_old public.tenants%rowtype;
begin
  if v_tenant is null or public.app_role() is distinct from 'admin' then
    raise exception 'Only the business owner can change these settings.' using errcode = '42501';
  end if;
  if v_color is not null and v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'The brand colour must look like #15479c.' using errcode = '22023';
  end if;
  if v_tagline is not null and char_length(v_tagline) > 80 then
    raise exception 'The tagline can be at most 80 characters.' using errcode = '22023';
  end if;

  select * into v_old from public.tenants where id = v_tenant;
  update public.tenants set brand_color = v_color, tagline = v_tagline where id = v_tenant;

  insert into public.audit_log (user_id, action, details, tenant_id)
  values (auth.uid(), 'business.brand', jsonb_build_object(
    'color', jsonb_build_object('from', v_old.brand_color, 'to', v_color),
    'tagline', jsonb_build_object('from', v_old.tagline, 'to', v_tagline)), v_tenant);
end;
$$;

revoke all on function public.save_business_brand(text, text) from public, anon;
grant execute on function public.save_business_brand(text, text) to authenticated;
