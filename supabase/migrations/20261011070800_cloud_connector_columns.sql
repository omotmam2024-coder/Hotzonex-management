-- Cloud connector: every MikroTik router now calls the router-gateway Edge Function
-- over HTTPS (RouterOS scheduler + /tool fetch). No computer on the router's network,
-- no VPN and no public IP are needed. A router proves who it is with a random token
-- shown once in its setup script; only the token's SHA-256 is kept here.

alter table public.routers
  add column token_hash text unique,
  add column last_usage_at timestamptz;

comment on column public.routers.token_hash is 'SHA-256 (hex) of the router''s connector token. Never readable by the browser.';
comment on column public.routers.last_usage_at is 'When the router last reported active users and voucher counters.';

-- token_hash stays service-role only.
grant select (last_usage_at) on public.routers to authenticated;
