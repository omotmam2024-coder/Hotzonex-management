-- Reports count every card the router has activated, like MikroTicket's own report:
--
-- 1. A card Hotzonex printed whose voucher was later deleted in Hotzonex (or whose router was
--    removed and added again) is still a hotspot user on the router. It now counts as a router
--    login like any MikroTicket card, instead of being skipped for its "hzc:" comment.
-- 2. A Hotzonex voucher used on the router without a recorded sale (not sold on the Sell screen,
--    not marked as sold, "Sell on first login" off) counts at its first login, at its plan's price.
--    Once it is sold or marked as sold, the sale counts instead; a voided sale counts nothing.

do $$
declare
  v_def text := pg_get_functiondef('public.record_router_logins'::regproc);
  v_old text := 'where u.comment !~ ''^hzc:''  -- Hotzonex vouchers are counted by their own sales
      and not exists (select 1 from public.vouchers v where v.router_id = p_router_id and v.code = u.name)';
  v_new text := '-- Hotzonex vouchers are counted by their own sales; a deleted one''s card counts like any other.
    where not exists (select 1 from public.vouchers v where v.router_id = p_router_id and v.code = u.name)';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'record_router_logins: expected voucher filter not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;

create or replace view public.report_sales as
  select s.id, s.sold_at, s.amount_ssp, s.site_id, s.plan_id, s.seller_id, 'sale'::text as source, s.tenant_id
  from public.sales s
  where s.voided_at is null
  union all
  select l.id, l.first_login_at, l.price_ssp, l.site_id, l.plan_id, null::uuid, 'router'::text, l.tenant_id
  from public.router_logins l
  where l.used and l.first_login_known and l.price_ssp > 0
  union all
  select v.id, v.first_used_at, p.price_ssp, v.site_id, v.plan_id, null::uuid, 'used'::text, v.tenant_id
  from public.vouchers v
  join public.plans p on p.id = v.plan_id
  where v.first_used_at is not null and p.price_ssp > 0
    and not exists (select 1 from public.sales s where s.voucher_id = v.id);

create index if not exists vouchers_first_used on public.vouchers (tenant_id, first_used_at) where first_used_at is not null;

-- The Sales page lists the same rows as the reports.
do $$
declare
  v_def text := pg_get_functiondef('public.list_sales(date, date, uuid, uuid, uuid, integer, integer)'::regprocedure);
  v_old text := '  ),
  totals as (';
  v_new text := '    union all
    select v.id, v.first_used_at, null::uuid, v.code, v.plan_id, p.name, p.color, p.price_ssp,
           null::uuid, ''Used without a sale (first login)'', v.site_id, v.router_id,
           null::timestamptz, null::text, null::text
    from public.vouchers v
    join public.plans p on p.id = v.plan_id
    where v.tenant_id = v_tenant
      and v.first_used_at is not null and p.price_ssp > 0
      and not exists (select 1 from public.sales s where s.voucher_id = v.id)
      and v.first_used_at >= (v_from::timestamp at time zone v_tz)
      and v.first_used_at < ((v_to + 1)::timestamp at time zone v_tz)
      and (v_site is null or v.site_id = v_site)
      and (p_plan_id is null or v.plan_id = p_plan_id)
      and v_seller is null
  ),
  totals as (';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'list_sales: expected totals block not found once';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
