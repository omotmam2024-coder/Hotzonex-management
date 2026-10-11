-- The hotspot server and its DNS name are now read from the router at its first check,
-- so they are empty until then.
alter table public.routers
  alter column hotspot_server drop not null,
  alter column dns_name drop not null;
