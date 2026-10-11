-- The minute tick wakes the worker only when at least one router uses a direct connection.
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
  if not exists (select 1 from public.routers where connection = 'direct') then
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
