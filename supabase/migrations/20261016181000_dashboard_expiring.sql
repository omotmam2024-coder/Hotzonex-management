-- Dashboard "expiring soon" (AUDIT.md §4): cards whose validity ends within the next hours, by plan.
-- A card's validity starts at its first login (router_logins.first_login_at) and lasts the plan's
-- validity_seconds. Only cards still on the router count (seen by the last router checks): cards
-- whose time is used up are removed from the router, so they are not "expiring".
-- Read-only; owners and managers see their own business (managers: their site).

create or replace function public.expiring_soon(p_site_id uuid default null, p_hours integer default 24)
returns table(plan_id uuid, plan_name text, plan_color text, cards integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.name, p.color, count(*)::integer
  from public.router_logins l
  join public.plans p on p.id = l.plan_id
  where l.tenant_id = public.app_tenant_id()
    and public.app_role() in ('admin', 'manager')
    and public.can_access_site(l.site_id)
    and (p_site_id is null or l.site_id = p_site_id)
    and l.first_login_at is not null
    and l.last_seen_at > now() - interval '10 minutes'
    and p.validity_seconds is not null
    and l.first_login_at + make_interval(secs => p.validity_seconds) between now() and now() + make_interval(hours => least(greatest(p_hours, 1), 168))
  group by p.id, p.name, p.color
  order by count(*) desc;
$$;

revoke all on function public.expiring_soon(uuid, integer) from public, anon;
grant execute on function public.expiring_soon(uuid, integer) to authenticated;
