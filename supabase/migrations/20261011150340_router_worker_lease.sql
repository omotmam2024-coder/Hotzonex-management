-- One router worker per router at a time: the minute check can overlap a run that is still
-- busy (a run may take up to 100 seconds). The lease expires by itself if a worker is stopped.
alter table public.routers add column worker_lease_until timestamptz;
