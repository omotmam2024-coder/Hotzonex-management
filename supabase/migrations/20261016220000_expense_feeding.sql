-- Expense category "feeding" (owner's request, 16 October 2026): meals for staff.
-- Widens the allowed categories on the table and in save_expense; nothing else changes.

alter table public.expenses drop constraint expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category in ('internet', 'power', 'rent', 'salaries', 'feeding', 'equipment', 'repairs', 'printing', 'transport', 'other'));

do $$
declare
  v_def text := pg_get_functiondef('public.save_expense(uuid, date, text, integer, text, uuid)'::regprocedure);
  v_old text := '''salaries'', ''equipment''';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'save_expense does not have the expected category list';
  end if;
  execute replace(v_def, v_old, '''salaries'', ''feeding'', ''equipment''');
end $$;
