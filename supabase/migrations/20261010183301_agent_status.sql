-- Router Agent heartbeat: each running agent upserts one row about every 20 s
-- (computer name, its LAN addresses, version, job types). The web app uses it to
-- say plainly whether an agent is online, stopped, or has never connected.

create table public.agent_status (
  id text primary key check (length(id) between 1 and 200),
  last_seen_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  hostname text not null,
  version text,
  lan_addresses text[] not null default '{}',
  job_types text[] not null default '{}'
);

alter table public.agent_status enable row level security;

create policy agent_status_select on public.agent_status
  for select to authenticated
  using (public.app_role() in ('admin', 'manager'));

revoke all on public.agent_status from anon, authenticated;
grant select on public.agent_status to authenticated;
grant all on public.agent_status to service_role;
