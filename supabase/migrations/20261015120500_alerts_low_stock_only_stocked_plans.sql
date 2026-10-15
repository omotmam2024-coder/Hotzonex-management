-- Low stock only for plans a site really stocks: at least the threshold made in the last 30 days.
do $$
declare
  v_def text := pg_get_functiondef('public.alerts_scan'::regproc);
  v_old text := '    where st.is_active
    group by 1, 2, 3, 4, 5, 6
  loop';
  v_new text := '    where st.is_active
    group by 1, 2, 3, 4, 5, 6
    having count(v.id) filter (where v.created_at > now() - interval ''30 days'') >= coalesce(s.low_stock_threshold, 10)
  loop';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'alerts_scan: low-stock block not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
update public.alerts set resolved_at = now() where kind = 'low_stock' and resolved_at is null;
