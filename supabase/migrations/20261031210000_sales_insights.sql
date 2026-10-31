-- Insights for owners and managers: when and what sells, a simple forecast, and a few flags for
-- unusual activity. Read-only; nothing existing changes.
--
--   sales_insights(p_days, p_site_id) → jsonb
--     by_hour / by_weekday / by_plan / daily   sales and revenue in the last p_days days (7 to 90)
--     forecast                                 next 7 days = the average of the same weekday in the window
--                                              (only with 14+ days of history); a guide, not a promise
--     flags                                    revenue_drop (last 7 days 30%+ below the 7 before),
--                                              void_rate (a seller voided 20%+ of their sales, 3+ voids),
--                                              discount_heavy (a seller gave a promo discount on 50%+ of 5+ sales)
--   The same sales as the Reports page: cashier sales, router-activated vouchers and cards used without a
--   sale; voided sales are left out of revenue. Managers see their own site only; sellers are refused.
-- Undo: drop function public.sales_insights(integer, uuid);

create or replace function public.sales_insights(p_days integer default 28, p_site_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_role text := public.app_role();
  v_tenant uuid := public.app_tenant_id();
  v_tz text := public.app_timezone();
  v_days integer := least(greatest(coalesce(p_days, 28), 7), 90);
  v_site uuid := p_site_id;
  v_today date := (now() at time zone v_tz)::date;
  v_from date;
  v_out jsonb;
begin
  if v_role is null or v_role = 'seller' then
    raise exception 'Only owners and managers can see insights.' using errcode = '42501';
  end if;
  if v_role = 'manager' then
    if v_site is not null and v_site is distinct from public.app_site_id() then
      raise exception 'You can only see insights for your own site.' using errcode = '42501';
    end if;
    v_site := public.app_site_id();
  end if;
  v_from := v_today - (v_days - 1);

  with rows_all as (
    select s.sold_at as ts, s.plan_id, s.amount_ssp as amount, s.seller_id, (s.voided_at is not null) as voided, (s.discount_ssp > 0) as discounted, true as from_sales
    from public.sales s
    where s.tenant_id = v_tenant
      and s.sold_at >= (v_from::timestamp at time zone v_tz) and s.sold_at < ((v_today + 1)::timestamp at time zone v_tz)
      and (v_site is null or s.site_id = v_site)
    union all
    select l.first_login_at, l.plan_id, l.price_ssp, null::uuid, false, false, false
    from public.router_logins l
    where l.tenant_id = v_tenant and l.used and l.first_login_known and l.price_ssp > 0
      and l.first_login_at >= (v_from::timestamp at time zone v_tz) and l.first_login_at < ((v_today + 1)::timestamp at time zone v_tz)
      and (v_site is null or l.site_id = v_site)
    union all
    select v.first_used_at, v.plan_id, p.price_ssp, null::uuid, false, false, false
    from public.vouchers v join public.plans p on p.id = v.plan_id
    where v.tenant_id = v_tenant and v.first_used_at is not null and p.price_ssp > 0
      and not exists (select 1 from public.sales s where s.voucher_id = v.id)
      and v.first_used_at >= (v_from::timestamp at time zone v_tz) and v.first_used_at < ((v_today + 1)::timestamp at time zone v_tz)
      and (v_site is null or v.site_id = v_site)
  ),
  live as (select r.*, (r.ts at time zone v_tz)::date as day from rows_all r where not r.voided),
  days as (select d::date as day from generate_series(v_from, v_today, interval '1 day') d),
  daily as (
    select d.day, count(l.*)::int as sold, coalesce(sum(l.amount), 0)::bigint as ssp
    from days d left join live l on l.day = d.day group by d.day
  ),
  hours as (
    select h, count(l.*)::int as sold, coalesce(sum(l.amount), 0)::bigint as ssp
    from generate_series(0, 23) h left join live l on extract(hour from l.ts at time zone v_tz)::int = h group by h
  ),
  weekdays as (
    select w, count(l.*)::int as sold, coalesce(sum(l.amount), 0)::bigint as ssp
    from generate_series(0, 6) w left join live l on extract(dow from l.ts at time zone v_tz)::int = w group by w
  ),
  by_plan as (
    select l.plan_id, coalesce(p.name, '?') as name, coalesce(p.color, '#64748b') as color, count(*)::int as sold, sum(l.amount)::bigint as ssp
    from live l left join public.plans p on p.id = l.plan_id group by l.plan_id, p.name, p.color
  ),
  weekday_avg as (
    select extract(dow from d.day)::int as w, avg(d.ssp) as avg_ssp from daily d group by 1
  ),
  forecast as (
    select (v_today + g)::date as day, round(coalesce(wa.avg_ssp, 0))::bigint as expected
    from generate_series(1, 7) g left join weekday_avg wa on wa.w = extract(dow from (v_today + g))::int
  ),
  last7 as (select coalesce(sum(ssp), 0)::bigint as v from daily where day > v_today - 7),
  prev7 as (select coalesce(sum(ssp), 0)::bigint as v from daily where day <= v_today - 7 and day > v_today - 14),
  seller_stats as (
    select s.seller_id, count(*)::int as total, count(*) filter (where s.voided)::int as voids, count(*) filter (where s.discounted and not s.voided)::int as discounted
    from rows_all s where s.from_sales and s.seller_id is not null group by s.seller_id
  ),
  flags as (
    select jsonb_build_object('kind', 'revenue_drop', 'last7', l.v, 'prev7', p.v, 'drop_pct', round(100 - 100.0 * l.v / p.v)::int) as f
    from last7 l, prev7 p where v_days >= 14 and p.v >= 5000 and l.v < p.v * 0.7
    union all
    select jsonb_build_object('kind', 'void_rate', 'seller', coalesce(pr.full_name, '?'), 'voids', ss.voids, 'total', ss.total)
    from seller_stats ss left join public.profiles pr on pr.id = ss.seller_id where ss.voids >= 3 and ss.voids >= 0.2 * ss.total
    union all
    select jsonb_build_object('kind', 'discount_heavy', 'seller', coalesce(pr.full_name, '?'), 'discounted', ss.discounted, 'total', ss.total)
    from seller_stats ss left join public.profiles pr on pr.id = ss.seller_id where ss.discounted >= 5 and ss.discounted >= 0.5 * ss.total
  )
  select jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'to', v_today,
    'total_ssp', (select coalesce(sum(ssp), 0) from daily),
    'total_sold', (select coalesce(sum(sold), 0) from daily),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'sold', sold, 'ssp', ssp) order by day), '[]') from daily),
    'by_hour', (select jsonb_agg(jsonb_build_object('hour', h, 'sold', sold, 'ssp', ssp) order by h) from hours),
    'by_weekday', (select jsonb_agg(jsonb_build_object('weekday', w, 'sold', sold, 'ssp', ssp) order by w) from weekdays),
    'by_plan', (select coalesce(jsonb_agg(jsonb_build_object('plan_id', plan_id, 'name', name, 'color', color, 'sold', sold, 'ssp', ssp) order by ssp desc), '[]') from by_plan),
    'forecast', case when v_days >= 14 then
      (select jsonb_build_object('days', jsonb_agg(jsonb_build_object('day', day, 'expected_ssp', expected) order by day), 'expected_total_ssp', sum(expected)) from forecast)
      else null end,
    'flags', (select coalesce(jsonb_agg(f), '[]') from (select f from flags limit 10) x)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.sales_insights(integer, uuid) from public, anon;
grant execute on function public.sales_insights(integer, uuid) to authenticated;
