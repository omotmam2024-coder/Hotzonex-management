-- Check a voucher code when a customer complains or hands one back: has it been used or not?
-- Looks in the Hotzonex vouchers and in the hotspot users the routers report every minute
-- (MikroTicket and other codes), only on the sites the staff member may see. Every role may use it
-- (cashiers handle the complaints). Exact code only.

create or replace function public.check_voucher(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
  v_tenant uuid := public.app_tenant_id();
  v_matches jsonb;
begin
  if public.app_role() is null or v_tenant is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 64 then
    raise exception 'Type the voucher code.' using errcode = '22023';
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
