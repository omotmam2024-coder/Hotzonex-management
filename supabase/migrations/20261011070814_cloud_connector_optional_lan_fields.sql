-- The router's LAN address and login are no longer needed (the router connects out by itself).
-- The columns are kept, empty, so nothing is dropped from a live database.
alter table public.routers
  alter column ip_address drop not null,
  alter column port drop not null,
  alter column use_https drop not null,
  alter column username drop not null,
  alter column password_enc drop not null;
