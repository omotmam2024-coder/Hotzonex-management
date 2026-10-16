-- Signed-in users and visitors never need TRUNCATE, TRIGGER or REFERENCES on any table (AUDIT.md §1,
-- Medium). They were granted on plan_routers and router_profile_ignores by an early migration. The
-- REST API cannot use them, but the database should not allow what the app never does.
-- (DELETE on those two tables stays: plans and ignored profiles are unlinked through the app,
-- and RLS still limits every row to the caller's business.)
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- Tables made by later migrations get the same rule.
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
