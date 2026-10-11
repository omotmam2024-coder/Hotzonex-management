-- Third way to connect a router: "tunnel". The router keeps a WireGuard tunnel open to the admin's
-- tunnel server (VPS); Hotzonex calls its REST API through the server's HTTPS relay. No scheduler.
alter table public.routers drop constraint routers_connection_check;
alter table public.routers add constraint routers_connection_check check (connection in ('cloud', 'direct', 'tunnel'));

alter table public.routers
  add column tunnel_ip text unique check (tunnel_ip is null or tunnel_ip ~ '^10\.99\.0\.([2-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-4])$'),
  add column wg_public_key text check (wg_public_key is null or wg_public_key ~ '^[A-Za-z0-9+/]{43}=$');

comment on column public.routers.tunnel_ip is 'Tunnel connection: the router''s WireGuard address (10.99.0.x) on the tunnel server.';
comment on column public.routers.wg_public_key is 'Tunnel connection: the router''s WireGuard public key (the private key is only in its setup script).';

grant select (tunnel_ip) on public.routers to authenticated;

-- The direct worker also serves tunnel routers.
create or replace function public.wake_direct_worker(p_router_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := (select value from public.app_config where key = 'direct_worker_url');
  v_secret text := (select value from public.app_config where key = 'direct_worker_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (select 1 from public.routers where connection in ('direct', 'tunnel')) then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := case when p_router_id is null then '{}'::jsonb else jsonb_build_object('router_id', p_router_id) end,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hzc-worker', v_secret),
    timeout_milliseconds := 5000
  );
end;
$$;

create or replace function public.router_jobs_wake_direct()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.routers r where r.id = new.router_id and r.connection in ('direct', 'tunnel')) then
    perform public.wake_direct_worker(new.router_id);
  end if;
  return new;
end;
$$;
