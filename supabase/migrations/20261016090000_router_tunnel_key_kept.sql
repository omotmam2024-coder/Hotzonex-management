-- The router's WireGuard private key is kept (encrypted like router passwords, AES-256-GCM with the
-- Vault key; never readable by the browser), so its tunnel script can be shown again without a new
-- key. Before, every "Tunnel script" click made a new key and locked out a router that had
-- connected with the previous script.
alter table public.routers add column wg_private_enc text;
comment on column public.routers.wg_private_enc is 'Encrypted WireGuard private key of the router (service role only).';
