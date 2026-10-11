-- Optional daily cleanup. Not applied yet: run it once in Supabase → SQL Editor.
-- Deletes finished router jobs older than 30 days, stale online rows and cron logs older than 7 days.

create or replace function public.hzc_cleanup()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.router_jobs where status in ('done', 'failed') and coalesce(finished_at, created_at) < now() - interval '30 days';
  delete from public.active_sessions where updated_at < now() - interval '1 day';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end;
$$;
revoke execute on function public.hzc_cleanup() from authenticated;

select cron.schedule('hzc-cleanup', '17 3 * * *', 'select public.hzc_cleanup()');

