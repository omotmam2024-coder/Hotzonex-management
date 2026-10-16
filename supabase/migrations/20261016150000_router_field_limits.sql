-- Router fields an admin can also change through the API: kept short and free of control
-- characters in the database itself (they go into RouterOS scripts and the tunnel config).
alter table public.routers
  add constraint routers_name_sane check (char_length(name) <= 80 and name !~ '[[:cntrl:]]'),
  add constraint routers_dns_name_sane check (dns_name is null or (char_length(dns_name) <= 253 and dns_name !~ '[[:cntrl:][:space:]]')),
  add constraint routers_hotspot_server_sane check (hotspot_server is null or (char_length(hotspot_server) <= 64 and hotspot_server !~ '[[:cntrl:]]'));
