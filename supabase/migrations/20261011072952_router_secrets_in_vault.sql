-- Router passwords (direct connection) are encrypted with AES-256-GCM by the Edge Functions.
-- The key is generated here, kept in Supabase Vault, and readable only by the service role.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'router_secret_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'router_secret_key', 'AES-256 key for router passwords');
  end if;
end;
$$;

create or replace function public.router_secret_key()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'router_secret_key' limit 1;
$$;

revoke all on function public.router_secret_key() from public, anon, authenticated;
grant execute on function public.router_secret_key() to service_role;

-- Shared secret the database sends when it wakes the router-direct worker.
insert into public.app_config (key, value)
values ('direct_worker_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- URL of this project's router-direct function (change the project ref for another project).
insert into public.app_config (key, value)
values ('direct_worker_url', 'https://tyiwnaxdejtsdofgnuow.supabase.co/functions/v1/router-direct')
on conflict (key) do nothing;
