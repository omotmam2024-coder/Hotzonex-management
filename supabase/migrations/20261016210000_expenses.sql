-- Expenses and profit (owner's request, 16 October 2026).
--
-- Owners and managers record what the business spends (internet, power, rent, salaries, …) and see
-- profit for a day, week or month: sales − agent commission − expenses.
--
--   expenses                 one row per expense; site_id null = for the whole business (owner only)
--   save_expense(...)        add (p_id null) or change an expense
--   remove_expense(p_id)     take an expense out
--   profit_report(...)       sales, commission, expenses and profit for a period, with the day-by-day
--                            lines, the totals per category and the expenses themselves
--
-- Additive only: a new table and new functions; nothing existing changes.
-- Undo: drop function public.profit_report(text, date, uuid); drop function public.remove_expense(uuid);
--       drop function public.save_expense(uuid, date, text, integer, text, uuid); drop table public.expenses;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,
  spent_on date not null,
  category text not null check (category in ('internet', 'power', 'rent', 'salaries', 'equipment', 'repairs', 'printing', 'transport', 'other')),
  amount_ssp integer not null check (amount_ssp > 0 and amount_ssp <= 1000000000),
  note text check (length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_tenant_day on public.expenses (tenant_id, spent_on);

alter table public.expenses enable row level security;
create policy tenant_isolation on public.expenses as restrictive for all to authenticated
  using (tenant_id = (select public.app_tenant_id())) with check (tenant_id = (select public.app_tenant_id()));
create policy expenses_read on public.expenses for select to authenticated
  using ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'manager' and site_id = (select public.app_site_id())));
revoke all on public.expenses from anon, authenticated;
grant select on public.expenses to authenticated;

/** Who may change an expense of this site: owners any (or the whole business), managers their own site. */
create or replace function public.expense_site_check(p_site_id uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.app_role();
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only owners and managers can record expenses.' using errcode = '42501';
  end if;
  if v_role = 'manager' and p_site_id is distinct from public.app_site_id() then
    raise exception 'Managers can only record expenses for their own site.' using errcode = '42501';
  end if;
  if p_site_id is not null and not exists (select 1 from public.sites where id = p_site_id and tenant_id = public.app_tenant_id()) then
    raise exception 'Site not found.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.expense_site_check(uuid) from public, anon, authenticated;

create or replace function public.save_expense(
  p_id uuid, p_spent_on date, p_category text, p_amount_ssp integer, p_note text, p_site_id uuid
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_old public.expenses;
  v_id uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform public.expense_site_check(p_site_id);
  if p_spent_on is null or p_spent_on > (now() at time zone public.app_timezone())::date + 1 then
    raise exception 'Choose the day of the expense (not in the future).' using errcode = '22023';
  end if;
  if p_amount_ssp is null or p_amount_ssp <= 0 or p_amount_ssp > 1000000000 then
    raise exception 'Type the amount in SSP.' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('internet', 'power', 'rent', 'salaries', 'equipment', 'repairs', 'printing', 'transport', 'other') then
    raise exception 'Choose a category.' using errcode = '22023';
  end if;
  if length(v_note) > 200 then
    raise exception 'The note is too long (max 200 characters).' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.expenses (tenant_id, site_id, spent_on, category, amount_ssp, note, created_by)
    values (v_tenant, p_site_id, p_spent_on, p_category, p_amount_ssp, v_note, auth.uid())
    returning id into v_id;
  else
    select * into v_old from public.expenses where id = p_id and tenant_id = v_tenant for update;
    if not found then
      raise exception 'Expense not found.' using errcode = 'P0002';
    end if;
    perform public.expense_site_check(v_old.site_id);
    update public.expenses
    set site_id = p_site_id, spent_on = p_spent_on, category = p_category, amount_ssp = p_amount_ssp,
        note = v_note, updated_at = now()
    where id = p_id
    returning id into v_id;
  end if;

  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_tenant, auth.uid(), case when p_id is null then 'expense.added' else 'expense.changed' end,
          jsonb_build_object('expense_id', v_id, 'day', p_spent_on, 'category', p_category, 'amount', p_amount_ssp,
                             'old_amount', v_old.amount_ssp, 'site_id', p_site_id, 'note', v_note));
  return v_id;
end;
$$;

create or replace function public.remove_expense(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.app_tenant_id();
  v_old public.expenses;
begin
  select * into v_old from public.expenses where id = p_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Expense not found.' using errcode = 'P0002';
  end if;
  perform public.expense_site_check(v_old.site_id);
  delete from public.expenses where id = p_id;
  insert into public.audit_log (tenant_id, user_id, action, details)
  values (v_tenant, auth.uid(), 'expense.removed',
          jsonb_build_object('expense_id', p_id, 'day', v_old.spent_on, 'category', v_old.category,
                             'amount', v_old.amount_ssp, 'site_id', v_old.site_id, 'note', v_old.note));
end;
$$;

/**
 * Profit for a day, week (Monday–Sunday) or calendar month, in business time.
 * Sales are counted the same way as report_period (voided sales left out, router cards included);
 * commission is what cash agents keep; expenses are those recorded for the days of the period.
 * With a site chosen, only that site's expenses count (whole-business expenses are left out).
 */
create or replace function public.profit_report(p_period text, p_date date, p_site_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_site uuid := public.report_site_scope(p_site_id);
  v_tenant uuid := public.app_tenant_id();
  v_tz text := public.app_timezone();
  v_start date;
  v_end date;
  v_prev_start date;
begin
  if p_period not in ('day', 'week', 'month') then
    raise exception 'Period must be day, week or month.' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Choose a date.' using errcode = '22023';
  end if;
  v_start := date_trunc(p_period, p_date::timestamp)::date;
  v_end := (v_start + ('1 ' || p_period)::interval)::date - 1;
  v_prev_start := (v_start - ('1 ' || p_period)::interval)::date;

  return (
    with days as (
      select d::date as day from generate_series(v_prev_start, v_end, interval '1 day') d
    ),
    s as (
      select (r.sold_at at time zone v_tz)::date as day, sum(r.amount_ssp)::bigint as revenue
      from public.report_sales r
      where r.tenant_id = v_tenant
        and r.sold_at >= (v_prev_start::timestamp at time zone v_tz)
        and r.sold_at < ((v_end + 1)::timestamp at time zone v_tz)
        and (v_site is null or r.site_id = v_site)
      group by 1
    ),
    c as (
      select (x.sold_at at time zone v_tz)::date as day, sum(x.commission_ssp)::bigint as commission
      from public.sales x
      where x.tenant_id = v_tenant and x.voided_at is null and x.commission_ssp > 0
        and x.sold_at >= (v_prev_start::timestamp at time zone v_tz)
        and x.sold_at < ((v_end + 1)::timestamp at time zone v_tz)
        and (v_site is null or x.site_id = v_site)
      group by 1
    ),
    e as (
      select x.spent_on as day, sum(x.amount_ssp)::bigint as expenses
      from public.expenses x
      where x.tenant_id = v_tenant and x.spent_on between v_prev_start and v_end
        and (v_site is null or x.site_id = v_site)
      group by 1
    ),
    line as (
      select d.day, coalesce(s.revenue, 0) as revenue, coalesce(c.commission, 0) as commission,
             coalesce(e.expenses, 0) as expenses,
             coalesce(s.revenue, 0) - coalesce(c.commission, 0) - coalesce(e.expenses, 0) as profit
      from days d left join s using (day) left join c using (day) left join e using (day)
    ),
    cur as (select * from line where day >= v_start),
    prev as (select * from line where day < v_start)
    select jsonb_build_object(
      'period', p_period,
      'start', v_start,
      'end', v_end,
      'site_id', v_site,
      'summary', (select jsonb_build_object(
          'revenue', coalesce(sum(revenue), 0), 'commission', coalesce(sum(commission), 0),
          'expenses', coalesce(sum(expenses), 0), 'profit', coalesce(sum(profit), 0)) from cur),
      'previous', (select jsonb_build_object(
          'revenue', coalesce(sum(revenue), 0), 'expenses', coalesce(sum(expenses), 0),
          'profit', coalesce(sum(profit), 0)) from prev),
      'days', case when p_period = 'day' then '[]'::jsonb else (
          select coalesce(jsonb_agg(jsonb_build_object('day', day, 'revenue', revenue, 'commission', commission,
                                                      'expenses', expenses, 'profit', profit) order by day), '[]'::jsonb)
          from cur) end,
      'by_category', (
          select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb)
          from (select x.category, sum(x.amount_ssp)::bigint as amount from public.expenses x
                where x.tenant_id = v_tenant and x.spent_on between v_start and v_end
                  and (v_site is null or x.site_id = v_site)
                group by x.category) k),
      'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'id', x.id, 'spent_on', x.spent_on, 'category', x.category, 'amount_ssp', x.amount_ssp,
                   'note', x.note, 'site_id', x.site_id, 'site_name', st.name, 'created_by', p.full_name)
                 order by x.spent_on desc, x.created_at desc), '[]'::jsonb)
          from public.expenses x
          left join public.sites st on st.id = x.site_id
          left join public.profiles p on p.id = x.created_by
          where x.tenant_id = v_tenant and x.spent_on between v_start and v_end
            and (v_site is null or x.site_id = v_site))
    )
  );
end;
$$;

revoke all on function public.save_expense(uuid, date, text, integer, text, uuid) from public, anon;
revoke all on function public.remove_expense(uuid) from public, anon;
revoke all on function public.profit_report(text, date, uuid) from public, anon;
grant execute on function public.save_expense(uuid, date, text, integer, text, uuid) to authenticated;
grant execute on function public.remove_expense(uuid) to authenticated;
grant execute on function public.profit_report(text, date, uuid) to authenticated;
