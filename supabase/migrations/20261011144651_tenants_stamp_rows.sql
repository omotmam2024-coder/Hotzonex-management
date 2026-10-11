-- ---------------------------------------------------------------------------
-- 4. Stamp tenant_id on new rows; a row never moves to another business, and
--    it may only point at plans, routers, sites and staff of its own business.
--    TG_ARGV[0]: 'site' (from site_id), 'router' (from router_id) or 'session'.
-- ---------------------------------------------------------------------------
create or replace function public.set_row_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_tenant uuid;
  v_ref uuid;
  k text;
  v_table text;
begin
  if tg_op = 'UPDATE'
     and new.tenant_id is not distinct from old.tenant_id
     and j->'site_id' is not distinct from o->'site_id'
     and j->'router_id' is not distinct from o->'router_id'
     and j->'plan_id' is not distinct from o->'plan_id'
     and j->'batch_id' is not distinct from o->'batch_id'
     and j->'seller_id' is not distinct from o->'seller_id' then
    return new;
  end if;

  if tg_argv[0] = 'site' and j->>'site_id' is not null then
    select s.tenant_id into v_tenant from public.sites s where s.id = (j->>'site_id')::uuid;
  elsif tg_argv[0] = 'router' and j->>'router_id' is not null then
    select r.tenant_id into v_tenant from public.routers r where r.id = (j->>'router_id')::uuid;
  end if;
  if v_tenant is null then
    v_tenant := case when tg_op = 'UPDATE' then old.tenant_id else coalesce(new.tenant_id, public.app_tenant_id()) end;
  end if;
  if v_tenant is null then
    raise exception 'No business was given for this % row.', tg_table_name using errcode = '23502';
  end if;
  if tg_op = 'UPDATE' and v_tenant is distinct from old.tenant_id then
    raise exception 'A % row cannot move to another business.', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.tenant_id is not null and new.tenant_id <> v_tenant then
    raise exception 'This % row belongs to another business.', tg_table_name using errcode = '42501';
  end if;
  new.tenant_id := v_tenant;

  foreach k in array array['site_id', 'router_id', 'plan_id', 'batch_id', 'seller_id'] loop
    continue when j->>k is null or (tg_op = 'UPDATE' and j->k is not distinct from o->k);
    v_table := case k when 'site_id' then 'sites' when 'router_id' then 'routers' when 'plan_id' then 'plans'
                      when 'batch_id' then 'voucher_batches' else 'profiles' end;
    execute format('select tenant_id from public.%I where id = $1', v_table) into v_ref using (j->>k)::uuid;
    if v_ref is not null and v_ref <> v_tenant then
      raise exception 'The % of this % row belongs to another business.', k, tg_table_name using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.set_row_tenant() from authenticated;

create trigger aa_set_tenant before insert or update on public.sites for each row execute function public.set_row_tenant('session');
create trigger aa_set_tenant before insert or update on public.plans for each row execute function public.set_row_tenant('session');
create trigger aa_set_tenant before insert or update on public.profiles for each row execute function public.set_row_tenant('site');
create trigger aa_set_tenant before insert or update on public.routers for each row execute function public.set_row_tenant('site');
create trigger aa_set_tenant before insert or update on public.vouchers for each row execute function public.set_row_tenant('site');
create trigger aa_set_tenant before insert or update on public.voucher_batches for each row execute function public.set_row_tenant('site');
create trigger aa_set_tenant before insert or update on public.sales for each row execute function public.set_row_tenant('site');
create trigger aa_set_tenant before insert or update on public.router_logins for each row execute function public.set_row_tenant('site');
create trigger aa_set_tenant before insert or update on public.active_sessions for each row execute function public.set_row_tenant('router');
create trigger aa_set_tenant before insert or update on public.router_jobs for each row execute function public.set_row_tenant('router');
create trigger aa_set_tenant before insert or update on public.portal_configs for each row execute function public.set_row_tenant('router');

create or replace function public.audit_set_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.tenant_id := coalesce(new.tenant_id, public.app_tenant_id());
  return new;
end;
$$;
revoke execute on function public.audit_set_tenant() from authenticated;
create trigger aa_set_tenant before insert on public.audit_log for each row execute function public.audit_set_tenant();
