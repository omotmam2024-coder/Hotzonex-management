-- Customers check how much time or data is left on their card (Buy page → "Check my card").
-- The `buy` Edge Function answers it; this table only remembers each check for a short time so it can
-- limit them per device and per business (a stream of checks would be someone guessing card codes).
-- No policies and no grants for browsers: only the service role (the Edge Function) reads and writes it.
-- Undo: drop table public.balance_checks;

create table public.balance_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_ip text not null,
  checked_at timestamptz not null default now()
);
create index balance_checks_ip_time on public.balance_checks (client_ip, checked_at);
create index balance_checks_tenant_time on public.balance_checks (tenant_id, checked_at);

alter table public.balance_checks enable row level security;
revoke all on public.balance_checks from anon, authenticated;
grant all on public.balance_checks to service_role;
