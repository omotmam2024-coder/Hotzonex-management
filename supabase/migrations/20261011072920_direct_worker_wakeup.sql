create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Wakes the router-direct Edge Function (async HTTP via pg_net). Reads its URL and secret
-- from app_config; does nothing until both are set.
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
  perform net.http_post(
    url := v_url,
    body := case when p_router_id is null then '{}'::jsonb else jsonb_build_object('router_id', p_router_id) end,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hzc-worker', v_secret),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.wake_direct_worker(uuid) from public, anon, authenticated;
grant execute on function public.wake_direct_worker(uuid) to service_role;

-- A new job for a direct router runs straight away instead of waiting for the minute tick.
create or replace function public.router_jobs_wake_direct()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.routers r where r.id = new.router_id and r.connection = 'direct') then
    perform public.wake_direct_worker(new.router_id);
  end if;
  return new;
end;
$$;

revoke all on function public.router_jobs_wake_direct() from public, anon, authenticated;

create trigger router_jobs_wake_direct
  after insert on public.router_jobs
  for each row execute function public.router_jobs_wake_direct();

-- Every minute: status check, usage sync and any waiting jobs for all direct routers.
select cron.schedule('hzc-direct-routers', '* * * * *', $$select public.wake_direct_worker(null)$$);
