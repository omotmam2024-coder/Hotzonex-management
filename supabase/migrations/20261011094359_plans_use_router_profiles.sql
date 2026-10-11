-- Plans may use a user profile that already exists on the router (e.g. made by MikroTicket),
-- whose names contain spaces and colons and can be long.
alter table public.plans drop constraint plans_router_profile_name_check;
alter table public.plans add constraint plans_router_profile_name_check
  check (router_profile_name !~ '[[:cntrl:]]' and length(router_profile_name) between 1 and 200 and router_profile_name = btrim(router_profile_name));
