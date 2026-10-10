-- Phase 3: record router removals made by admins in the audit log.
-- Removals by the Router Agent (a router that failed its first connection test)
-- run without a logged-in user and are not audited, because that router was never saved.

create or replace function public.audit_router_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.audit_log (user_id, action, details)
    values (auth.uid(), 'router.removed', jsonb_build_object('router_id', old.id, 'name', old.name, 'ip', host(old.ip_address)));
  end if;
  return old;
end;
$$;

revoke all on function public.audit_router_delete() from public;

create trigger routers_audit_delete
  after delete on public.routers
  for each row execute function public.audit_router_delete();
