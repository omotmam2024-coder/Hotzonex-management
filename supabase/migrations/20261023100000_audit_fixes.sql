-- Audit fixes (October 2026).
--
-- 1. check_voucher: sellers are limited to 30 checks per 10 minutes and do not see cards that were
--    never printed or sold, so the check cannot be used to guess working codes.
-- 2. Business details and staff accounts change only through the functions that check them
--    (save_business_settings, set_seller_terms, the create-staff function), never by direct update.
-- 3. Sellers read only their own cash handovers; managers read their site's.
-- 4. Jobs sent from the app may only name a plan of the caller's own business.

create table if not exists public.voucher_checks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  user_id uuid not null,
  checked_at timestamptz not null default now()
);
create index if not exists voucher_checks_user_at on public.voucher_checks (user_id, checked_at desc);
alter table public.voucher_checks enable row level security;
revoke all on public.voucher_checks from public, anon, authenticated;

create or replace function public.check_voucher(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
  v_tenant uuid := public.app_tenant_id();
  v_role text := public.app_role();
  v_matches jsonb;
begin
  if v_role is null or v_tenant is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 64 then
    raise exception 'Type the voucher code.' using errcode = '22023';
  end if;
  -- Sellers check the cards customers bring back, a few at a time: a steady stream of checks
  -- would be someone guessing codes to find working cards.
  if v_role = 'seller' then
    if (select count(*) from public.voucher_checks c where c.user_id = auth.uid() and c.checked_at > now() - interval '10 minutes') >= 30 then
      raise exception 'Too many checks. Wait a few minutes and try again.' using errcode = '54000';
    end if;
    insert into public.voucher_checks (tenant_id, user_id) values (v_tenant, auth.uid());
  end if;

  with hz as (
    select jsonb_build_object(
      'source', 'hotzonex',
      'code', v.code,
      'status', v.status,
      'router', r.name,
      'site', s.name,
      'checked_at', r.last_usage_at,
      'router_status', r.status,
      'plan', p.name,
      'plan_color', p.color,
      'price_ssp', p.price_ssp,
      'uptime_limit', p.uptime_seconds,
      'validity_seconds', p.validity_seconds,
      'data_limit_mb', p.data_limit_mb,
      'created_at', v.created_at,
      'printed_at', v.printed_at,
      'on_router', v.on_router,
      'sold_at', coalesce(sa.sold_at, v.sold_at),
      'sold_by', sp.full_name,
      'payment_method', sa.payment_method,
      'amount_ssp', sa.amount_ssp,
      'voided', sa.voided_at is not null,
      'first_used_at', v.first_used_at,
      'expires_at', v.expires_at,
      'uptime_used', v.uptime_used_seconds,
      'bytes_used', v.bytes_used,
      'online', (select jsonb_build_object('mac', a.mac_address, 'ip', a.ip_address, 'uptime', a.uptime_seconds, 'since', a.updated_at)
                 from public.active_sessions a where a.router_id = v.router_id and a.code = v.code
                 order by a.updated_at desc limit 1)
    ) as m, v.router_id
    from public.vouchers v
    join public.routers r on r.id = v.router_id
    join public.sites s on s.id = v.site_id
    join public.plans p on p.id = v.plan_id
    left join lateral (
      select x.sold_at, x.payment_method, x.amount_ssp, x.voided_at, x.seller_id
      from public.sales x where x.voucher_id = v.id order by x.sold_at desc limit 1
    ) sa on true
    left join public.profiles sp on sp.id = sa.seller_id
    where v.tenant_id = v_tenant and v.code = v_code and public.can_access_site(v.site_id)
      -- A card never printed and never sold is not in anyone's hands: sellers do not see it.
      and (v_role <> 'seller' or v.status <> 'unused' or v.printed_at is not null)
    limit 10
  ), rl as (
    select jsonb_build_object(
      'source', 'router',
      'code', l.username,
      'status', case when l.used then 'used' else 'unused' end,
      'router', r.name,
      'site', s.name,
      'checked_at', r.last_usage_at,
      'router_status', r.status,
      'plan', coalesce(p.name, l.profile),
      'plan_color', p.color,
      'price_ssp', coalesce(l.price_ssp, p.price_ssp),
      'profile', l.profile,
      'first_used_at', l.first_login_at,
      'first_login_known', l.first_login_known,
      'first_seen_at', l.first_seen_at,
      'last_seen_at', l.last_seen_at,
      'online', (select jsonb_build_object('mac', a.mac_address, 'ip', a.ip_address, 'uptime', a.uptime_seconds, 'since', a.updated_at)
                 from public.active_sessions a where a.router_id = l.router_id and a.code = l.username
                 order by a.updated_at desc limit 1)
    ) as m
    from public.router_logins l
    join public.routers r on r.id = l.router_id
    join public.sites s on s.id = l.site_id
    left join public.plans p on p.id = l.plan_id
    where l.tenant_id = v_tenant and l.username = v_code and public.can_access_site(l.site_id)
      -- A Hotzonex voucher is shown once, from its own record.
      and not exists (select 1 from hz where hz.router_id = l.router_id)
    limit 10
  )
  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_matches
  from (select m from hz union all select m from rl) all_matches;

  return jsonb_build_object('code', v_code, 'checked_now', now(), 'matches', v_matches);
end;
$$;

revoke all on function public.check_voucher(text) from public, anon;
grant execute on function public.check_voucher(text) to authenticated;

revoke update on public.tenants from authenticated;
revoke update (name, timezone, logo_url) on public.tenants from authenticated;
revoke update on public.profiles from authenticated;
revoke update (commission_pct, created_at, credit_limit_ssp, full_name, id, is_active, role, site_id, tenant_id) on public.profiles from authenticated;

alter policy cash_handovers_read on public.cash_handovers
  using ((select public.is_admin())
         or ((select public.app_role()) = 'manager' and site_id = (select public.app_site_id()))
         or seller_id = (select auth.uid()));

alter policy router_jobs_admin_insert on public.router_jobs
  with check ((select public.is_admin())
              and type in ('test_connection', 'sync_profiles', 'disconnect_user', 'install_portal', 'restore_portal')
              and status = 'queued' and attempts = 0 and result is null
              and started_at is null and finished_at is null
              and created_by = (select auth.uid())
              and (payload->>'plan_id' is null
                   or exists (select 1 from public.plans p where p.id::text = payload->>'plan_id' and p.tenant_id = (select public.app_tenant_id()))));
