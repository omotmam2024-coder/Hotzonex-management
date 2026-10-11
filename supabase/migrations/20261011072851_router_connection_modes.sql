-- Two ways to connect a router:
--   cloud  : the router calls the router-gateway Edge Function (setup script, works behind CGNAT)
--   direct : Hotzonex calls the router's REST API at a public IP / DNS name with its admin login
alter table public.routers
  add column connection text not null default 'cloud' check (connection in ('cloud', 'direct')),
  add column host text check (host is null or length(host) between 1 and 253),
  add column hotspot_info jsonb;

comment on column public.routers.host is 'Direct connection: public IP address or DNS name of the router (REST API).';
comment on column public.routers.hotspot_info is 'Read-only snapshot of the router''s own hotspot setup (servers, profiles, user profiles) from its last check.';

-- Browser may read the connection details, never password_enc or token_hash.
grant select (connection, host, hotspot_info, username, port, use_https) on public.routers to authenticated;

-- Settings the database needs to wake the direct-connection worker. Service role only.
create table public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant all on public.app_config to service_role;
