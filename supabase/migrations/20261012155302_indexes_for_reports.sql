-- Lookups by plan and router used by reports, plan checks and deletes; keeps them fast as sales grow.
create index if not exists vouchers_plan_id_idx on public.vouchers (plan_id);
create index if not exists voucher_batches_plan_id_idx on public.voucher_batches (plan_id);
create index if not exists sales_plan_id_idx on public.sales (plan_id);
create index if not exists sales_router_id_idx on public.sales (router_id);
create index if not exists router_logins_plan_id_idx on public.router_logins (plan_id);
create index if not exists router_logins_site_id_idx on public.router_logins (site_id);
