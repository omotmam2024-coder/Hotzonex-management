-- Deleting staff (owner's request, 24 October 2026).
--
-- A staff member with no sales, cash or payment history is deleted completely (their login, and with
-- it their profile). One with history keeps a switched-off profile so their name stays on past sales
-- and cash-ups; removed_at marks it as deleted: it leaves the Staff page and can never be switched on
-- again, and the login itself is destroyed (create-staff, action "delete"). Additive only.

alter table public.profiles add column if not exists removed_at timestamptz;

comment on column public.profiles.removed_at is
  'When the owner deleted this staff member. Kept (switched off) only so past sales and cash-ups keep their name.';
