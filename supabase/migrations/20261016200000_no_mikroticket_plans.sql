-- Hotzonex plans and MikroTicket profiles are kept apart (owner's request, 16 October 2026).
--
-- 1. Router profiles no longer become Hotzonex plans by themselves: the trigger that made a plan of
--    every priced profile it saw on a router (e.g. MikroTicket's) is switched off. Plans are made
--    in Hotzonex only, each with its own router profile (named hzc-…).
-- 2. The plans that were made from MikroTicket profiles are switched off: they leave the Sell,
--    Generate and Buy screens, but stay in the database so past sales and reports keep their names.
--    Nothing changes on the routers: MikroTicket's profiles and cards keep working, and MikroTicket
--    card sales are still counted in reports.
--
-- Undo: alter table public.routers enable trigger plans_from_router_profiles;
--       then switch the plans back on in Plans (or set is_active = true).

alter table public.routers disable trigger plans_from_router_profiles;

update public.plans p
set is_active = false
where p.is_active
  and p.router_profile_name like 'profile\_%'
  and exists (select 1 from public.plan_routers l where l.plan_id = p.id)
  and not exists (select 1 from public.plan_routers l where l.plan_id = p.id and l.managed);
