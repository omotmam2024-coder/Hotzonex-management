-- Phase 5: record when voucher cards are printed. Printing never changes the
-- voucher status and is not a sale; printed cards are left out of the cashier's
-- stock (see sell_voucher) because they may already be in a customer's hand.

-- Marks pushed, non-disabled vouchers as printed. Vouchers printed before keep
-- their first printed time. Returns the ids that were newly marked, so the
-- browser can undo exactly those if the print was cancelled.
create or replace function public.mark_vouchers_printed(p_voucher_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
  v_ids uuid[];
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can print voucher cards.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_voucher_ids, 1), 0) > 1000 then
    raise exception 'Print at most 1000 cards at a time.' using errcode = '22023';
  end if;

  with marked as (
    update public.vouchers v
    set printed_at = now()
    where v.id = any (p_voucher_ids)
      and v.on_router
      and v.status <> 'disabled'
      and v.printed_at is null
      and public.can_access_site(v.site_id)
    returning v.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from marked;
  return v_ids;
end;
$$;

-- Undo for a cancelled print: clears printed_at again, but only for cards that
-- are still unused and were marked within the last hour.
create or replace function public.unmark_vouchers_printed(p_voucher_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
  v_count integer;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can print voucher cards.' using errcode = '42501';
  end if;

  update public.vouchers v
  set printed_at = null
  where v.id = any (p_voucher_ids)
    and v.status = 'unused'
    and v.printed_at > now() - interval '1 hour'
    and public.can_access_site(v.site_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_vouchers_printed(uuid[]) from public;
revoke all on function public.unmark_vouchers_printed(uuid[]) from public;
grant execute on function public.mark_vouchers_printed(uuid[]) to authenticated;
grant execute on function public.unmark_vouchers_printed(uuid[]) to authenticated;
