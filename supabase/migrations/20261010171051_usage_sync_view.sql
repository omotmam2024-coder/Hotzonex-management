-- Phase 7 (part 1): index and batch status view.
create index if not exists active_sessions_voucher_idx on public.active_sessions (voucher_id);

-- Batch status: count vouchers that reached the router even after expired ones
-- were removed from it again.
create or replace view public.voucher_batch_status
with (security_invoker = true)
as
select
  b.id,
  b.created_at,
  b.site_id,
  b.router_id,
  b.plan_id,
  b.quantity,
  b.code_length,
  b.created_by,
  b.note,
  s.name as site_name,
  r.name as router_name,
  p.name as plan_name,
  p.color as plan_color,
  p.price_ssp,
  p.uptime_seconds,
  coalesce(v.voucher_count, 0) as voucher_count,
  coalesce(v.pushed_count, 0) as pushed_count,
  j.status as push_status,
  j.result->>'error' as push_error,
  j.finished_at as push_finished_at
from public.voucher_batches b
join public.sites s on s.id = b.site_id
join public.routers r on r.id = b.router_id
join public.plans p on p.id = b.plan_id
left join lateral (
  select count(*)::integer as voucher_count,
         count(*) filter (where vv.on_router or vv.status in ('sold', 'active', 'expired'))::integer as pushed_count
  from public.vouchers vv
  where vv.batch_id = b.id
) v on true
left join lateral (
  select jj.status, jj.result, jj.finished_at
  from public.router_jobs jj
  where jj.type = 'push_vouchers' and jj.payload->>'batch_id' = b.id::text
  order by jj.created_at desc
  limit 1
) j on true;
