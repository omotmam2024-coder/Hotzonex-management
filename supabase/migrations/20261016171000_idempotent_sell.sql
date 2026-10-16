-- Selling a card can be retried safely (AUDIT.md §2, High).
--
-- A double tap was already blocked on the phone, but when the network dropped after the server had
-- sold the card, a second tap sold a second card. The Sell page now sends a request id (one per
-- sale attempt, reused on every retry). The server remembers it: the same request id returns the
-- same sale and code instead of selling again.
--
-- Backward compatible: p_request_id is optional, so older open copies of the app keep working.
-- The old two-argument function is replaced (a second overload would make calls ambiguous).

alter table public.sales add column if not exists request_id uuid;

create unique index if not exists sales_request_once on public.sales (tenant_id, request_id) where request_id is not null;

drop function if exists public.sell_voucher(uuid, uuid);

create or replace function public.sell_voucher(p_router_id uuid, p_plan_id uuid, p_request_id uuid default null)
returns table(sale_id uuid, voucher_id uuid, code text, amount_ssp integer, sold_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_role text := public.app_role();
  v_tenant uuid := public.app_tenant_id();
  v_router public.routers%rowtype;
  v_plan public.plans%rowtype;
  v_voucher public.vouchers%rowtype;
  v_now timestamptz := now();
  v_sale_id uuid;
begin
  if v_role is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;

  -- The same sale attempt sent again (the reply was lost): give back that sale, sell nothing new.
  if p_request_id is not null then
    return query
      select s.id, s.voucher_id, v.code, s.amount_ssp, s.sold_at
      from public.sales s join public.vouchers v on v.id = s.voucher_id
      where s.tenant_id = v_tenant and s.request_id = p_request_id and s.seller_id = auth.uid();
    if found then
      return;
    end if;
  end if;

  select * into v_router from public.routers where id = p_router_id;
  if not found or not public.can_access_site(v_router.site_id) then
    raise exception 'Router not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.sites s where s.id = v_router.site_id and s.is_active) then
    raise exception 'The site for router % is switched off.', v_router.name using errcode = '55000';
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if not found or not v_plan.is_active or v_plan.tenant_id <> v_router.tenant_id then
    raise exception 'This plan does not exist or is switched off.' using errcode = 'P0002';
  end if;

  -- Pre-printed cards (printed_at set) may already be in a customer's hand, so the
  -- cashier never sells them; they are recorded through "Mark as sold" instead.
  select * into v_voucher
  from public.vouchers v
  where v.router_id = v_router.id
    and v.plan_id = v_plan.id
    and v.status = 'unused'
    and v.on_router
    and v.printed_at is null
  order by v.created_at, v.id
  limit 1
  for update skip locked;

  if not found then
    raise exception 'Out of stock: no % vouchers left on %. Generate more vouchers.', v_plan.name, v_router.name
      using errcode = 'P0001';
  end if;

  begin
    update public.vouchers v set status = 'sold', sold_at = v_now where v.id = v_voucher.id;

    insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at, request_id)
    values (v_voucher.id, v_router.site_id, v_router.id, v_plan.id, auth.uid(), v_plan.price_ssp, 'cash', v_now, p_request_id)
    returning id into v_sale_id;
  exception when unique_violation then
    -- The same request arrived twice at the same moment: the other one sold the card.
    if p_request_id is null then
      raise;
    end if;
    return query
      select s.id, s.voucher_id, v.code, s.amount_ssp, s.sold_at
      from public.sales s join public.vouchers v on v.id = s.voucher_id
      where s.tenant_id = v_tenant and s.request_id = p_request_id;
    return;
  end;

  return query select v_sale_id, v_voucher.id, v_voucher.code, v_plan.price_ssp, v_now;
end;
$function$;

revoke all on function public.sell_voucher(uuid, uuid, uuid) from public, anon;
grant execute on function public.sell_voucher(uuid, uuid, uuid) to authenticated;
