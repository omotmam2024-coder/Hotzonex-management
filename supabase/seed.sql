-- =============================================================================
-- Hotzonex Cloud — starter data: one site, one admin login, three sample plans.
--
-- Local:  runs automatically on `supabase db reset`.
-- Hosted: paste into Supabase → SQL Editor and run once, AFTER changing the
--         admin email and password below. Change the password again after the
--         first login (Supabase → Authentication → Users → Send password reset).
-- Safe to run more than once: existing rows are left as they are.
-- =============================================================================

do $$
declare
  -- >>> Change these two values before running on a real project. <<<
  v_admin_email text := 'admin@hotzonex.local';
  v_admin_password text := 'Hotzonex-Admin-2026!';
  -- <<<

  v_admin_name text := 'Hotzonex Admin';
  v_site_id uuid;
  v_user_id uuid;
begin
  -- Site
  insert into public.sites (name) values ('HQ')
  on conflict (name) do nothing;
  select id into v_site_id from public.sites where name = 'HQ';

  -- Admin login (Supabase Auth user + identity), created only if the email is new.
  select id into v_user_id from auth.users where email = lower(v_admin_email);
  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      lower(v_admin_email), extensions.crypt(v_admin_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_admin_name), now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id::text, 'email',
      jsonb_build_object('sub', v_user_id::text, 'email', lower(v_admin_email), 'email_verified', true),
      now(), now(), now()
    );
  end if;

  -- Admin profile (all sites)
  insert into public.profiles (id, full_name, role, site_id, is_active)
  values (v_user_id, v_admin_name, 'admin', null, true)
  on conflict (id) do nothing;

  -- Sample plans. Uptime and validity are in seconds, prices in whole SSP.
  insert into public.plans
    (name, price_ssp, uptime_seconds, validity_seconds, rate_limit, data_limit_mb, shared_users, color, router_profile_name)
  values
    ('2 Hours', 1000, 7200, 86400, '2M/2M', null, 1, '#16a34a', 'hzc-2h'),
    ('1 Day', 3000, 86400, 172800, '3M/3M', null, 1, '#2563eb', 'hzc-1d'),
    ('1 Week', 15000, 604800, 604800, '4M/4M', null, 1, '#dc2626', 'hzc-1w')
  on conflict (name) do nothing;
end;
$$;
