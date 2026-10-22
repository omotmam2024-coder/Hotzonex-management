-- Indexes on foreign-key columns the database advisor found without one.
-- They keep deletes (router/plan/business removal) and joins fast as the data grows.
create index if not exists alerts_router_id_fk_idx on public.alerts (router_id);
create index if not exists alerts_site_id_fk_idx on public.alerts (site_id);
create index if not exists audit_log_user_id_fk_idx on public.audit_log (user_id);
create index if not exists cash_handovers_received_by_fk_idx on public.cash_handovers (received_by);
create index if not exists cash_handovers_site_id_fk_idx on public.cash_handovers (site_id);
create index if not exists expenses_created_by_fk_idx on public.expenses (created_by);
create index if not exists expenses_site_id_fk_idx on public.expenses (site_id);
create index if not exists invoices_confirmed_by_fk_idx on public.invoices (confirmed_by);
create index if not exists payment_requests_decided_by_fk_idx on public.payment_requests (decided_by);
create index if not exists payment_requests_plan_id_fk_idx on public.payment_requests (plan_id);
create index if not exists payment_requests_sale_id_fk_idx on public.payment_requests (sale_id);
create index if not exists payment_requests_voucher_id_fk_idx on public.payment_requests (voucher_id);
create index if not exists plan_routers_tenant_id_fk_idx on public.plan_routers (tenant_id);
create index if not exists platform_admins_acting_tenant_id_fk_idx on public.platform_admins (acting_tenant_id);
create index if not exists removed_businesses_removed_by_fk_idx on public.removed_businesses (removed_by);
create index if not exists router_jobs_created_by_fk_idx on public.router_jobs (created_by);
create index if not exists router_profile_ignores_tenant_id_fk_idx on public.router_profile_ignores (tenant_id);
create index if not exists sales_voided_by_fk_idx on public.sales (voided_by);
create index if not exists tenant_billing_plan_id_fk_idx on public.tenant_billing (plan_id);
create index if not exists voucher_batches_created_by_fk_idx on public.voucher_batches (created_by);
create index if not exists voucher_batches_site_id_fk_idx on public.voucher_batches (site_id);
