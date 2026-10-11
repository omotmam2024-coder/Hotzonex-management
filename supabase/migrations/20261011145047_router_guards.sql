-- ---------------------------------------------------------------------------
-- 6. Routers: keep sales history, no moving between sites once used
-- ---------------------------------------------------------------------------
create or replace function public.routers_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if exists (select 1 from public.vouchers v where v.router_id = old.id) then
    raise exception 'Router % has Hotzonex vouchers and sales, so it cannot be removed. Switch its site off instead.', old.name
      using errcode = '23503';
  end if;
  select count(*) into v_used from public.router_logins l where l.router_id = old.id and l.used;
  if v_used > 0 then
    raise exception 'Router % has % activated vouchers in the sales history, so it cannot be removed.', old.name, v_used
      using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke execute on function public.routers_guard_delete() from authenticated;
create trigger routers_guard_delete before delete on public.routers for each row execute function public.routers_guard_delete();

create or replace function public.routers_guard_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.site_id <> old.site_id
     and (exists (select 1 from public.vouchers v where v.router_id = old.id)
          or exists (select 1 from public.router_logins l where l.router_id = old.id and l.used)) then
    raise exception 'Router % already has vouchers or sales at its site, so it cannot move to another site.', old.name
      using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke execute on function public.routers_guard_site() from authenticated;
create trigger routers_guard_site before update of site_id on public.routers for each row execute function public.routers_guard_site();

create or replace function public.audit_router_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.audit_log (tenant_id, user_id, action, details)
    values (old.tenant_id, auth.uid(), 'router.removed', jsonb_build_object('router_id', old.id, 'name', old.name, 'ip', host(old.ip_address)));
  end if;
  return old;
end;
$$;
