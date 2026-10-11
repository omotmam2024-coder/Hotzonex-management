-- ---------------------------------------------------------------------------
-- 7. Voucher, sale and report functions: always inside the caller's business
-- ---------------------------------------------------------------------------
create or replace function public.generate_vouchers(p_router_id uuid, p_plan_id uuid, p_quantity integer, p_code_length integer default 8)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text := public.app_role();
  v_router public.routers%rowtype;
  v_plan public.plans%rowtype;
  v_batch_id uuid;
  v_inserted integer := 0;
  v_rows integer;
  v_rounds integer := 0;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can generate vouchers.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity not between 1 and 1000 then
    raise exception 'Quantity must be between 1 and 1000.' using errcode = '22023';
  end if;
  if p_code_length is null or p_code_length not between 6 and 10 then
    raise exception 'Code length must be between 6 and 10 digits.' using errcode = '22023';
  end if;

  select * into v_router from public.routers where id = p_router_id;
  if not found or not public.can_access_site(v_router.site_id) then
    raise exception 'Router not found.' using errcode = 'P0002';
  end if;
  if v_router.status = 'pending' then
    raise exception 'Router % has not passed its connection test yet.', v_router.name using errcode = '55000';
  end if;
  if not exists (select 1 from public.sites s where s.id = v_router.site_id and s.is_active) then
    raise exception 'The site for router % is switched off.', v_router.name using errcode = '55000';
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if not found or not v_plan.is_active or v_plan.tenant_id <> v_router.tenant_id then
    raise exception 'This plan does not exist or is switched off.' using errcode = 'P0002';
  end if;

  insert into public.voucher_batches (site_id, router_id, plan_id, quantity, code_length, created_by)
  values (v_router.site_id, v_router.id, v_plan.id, p_quantity, p_code_length, auth.uid())
  returning id into v_batch_id;

  -- Random codes; codes already on this router (ours, or MikroTicket's users) are
  -- skipped and topped up on the next round.
  loop
    insert into public.vouchers (batch_id, router_id, site_id, plan_id, code)
    select v_batch_id, v_router.id, v_router.site_id, v_plan.id, g.code
    from (select public.random_numeric_code(p_code_length) as code from generate_series(1, p_quantity - v_inserted)) g
    where not exists (select 1 from public.router_logins l where l.router_id = v_router.id and l.username = g.code)
    on conflict on constraint vouchers_code_per_router do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
    exit when v_inserted >= p_quantity;
    v_rounds := v_rounds + 1;
    if v_rounds >= 25 then
      raise exception 'Could not find enough unused % digit codes on router %. Use a longer code length.',
        p_code_length, v_router.name using errcode = '54000';
    end if;
  end loop;

  insert into public.router_jobs (router_id, type, payload, created_by)
  values (v_router.id, 'push_vouchers', jsonb_build_object('batch_id', v_batch_id), auth.uid());

  return v_batch_id;
end;
$$;

create or replace function public.sell_voucher(p_router_id uuid, p_plan_id uuid)
returns table(sale_id uuid, voucher_id uuid, code text, amount_ssp integer, sold_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text := public.app_role();
  v_router public.routers%rowtype;
  v_plan public.plans%rowtype;
  v_voucher public.vouchers%rowtype;
  v_now timestamptz := now();
  v_sale_id uuid;
begin
  if v_role is null then
    raise exception 'Your staff account is not active.' using errcode = '42501';
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

  update public.vouchers v set status = 'sold', sold_at = v_now where v.id = v_voucher.id;

  insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at)
  values (v_voucher.id, v_router.site_id, v_router.id, v_plan.id, auth.uid(), v_plan.price_ssp, 'cash', v_now)
  returning id into v_sale_id;

  return query select v_sale_id, v_voucher.id, v_voucher.code, v_plan.price_ssp, v_now;
end;
$$;

create or replace function public.mark_vouchers_sold(p_voucher_ids uuid[], p_seller_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
  v_seller public.profiles%rowtype;
  v_voucher record;
  v_now timestamptz := now();
  v_sold integer := 0;
  v_total bigint := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_reason text;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can mark cards as sold.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_voucher_ids, 1), 0) = 0 then
    raise exception 'Choose at least one card.' using errcode = '22023';
  end if;
  if array_length(p_voucher_ids, 1) > 1000 then
    raise exception 'Mark at most 1000 cards at a time.' using errcode = '22023';
  end if;

  select * into v_seller from public.profiles where id = p_seller_id;
  if not found or not v_seller.is_active or v_seller.tenant_id is distinct from public.app_tenant_id() then
    raise exception 'Choose an active seller.' using errcode = '22023';
  end if;

  for v_voucher in
    select v.id, v.code, v.site_id, v.router_id, v.plan_id, v.status, v.on_router, v.printed_at, p.price_ssp,
           exists (select 1 from public.sales s where s.voucher_id = v.id) as has_sale
    from public.vouchers v
    join public.plans p on p.id = v.plan_id
    where v.id = any (p_voucher_ids)
    order by v.code
    for update of v
  loop
    v_reason := case
      when not public.can_access_site(v_voucher.site_id) then 'not your site'
      when v_voucher.has_sale then 'already sold'
      when v_voucher.status = 'disabled' then 'disabled'
      when not v_voucher.on_router then 'not on the router'
      when v_voucher.printed_at is null then 'not printed — sell it on the Sell screen'
      when v_seller.role <> 'admin' and v_seller.site_id is distinct from v_voucher.site_id then 'seller works at another site'
      else null
    end;

    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_object('code', v_voucher.code, 'reason', v_reason);
      continue;
    end if;

    update public.vouchers
    set status = case when status = 'unused' then 'sold' else status end,
        sold_at = v_now
    where id = v_voucher.id;

    insert into public.sales (voucher_id, site_id, router_id, plan_id, seller_id, amount_ssp, payment_method, sold_at)
    values (v_voucher.id, v_voucher.site_id, v_voucher.router_id, v_voucher.plan_id, v_seller.id, v_voucher.price_ssp, 'cash', v_now);

    v_sold := v_sold + 1;
    v_total := v_total + v_voucher.price_ssp;
  end loop;

  return jsonb_build_object('sold', v_sold, 'total_ssp', v_total, 'skipped', v_skipped);
end;
$$;

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can void a sale.' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Write a reason for the void.' using errcode = '22023';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and tenant_id = public.app_tenant_id() for update;
  if not found then
    raise exception 'Sale not found.' using errcode = 'P0002';
  end if;
  if v_sale.voided_at is not null then
    raise exception 'This sale was already voided.' using errcode = '55000';
  end if;
  if v_sale.sold_at < now() - interval '24 hours' then
    raise exception 'Sales can only be voided within 24 hours.' using errcode = '55000';
  end if;

  update public.sales
  set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = p_sale_id;

  update public.vouchers set status = 'disabled' where id = v_sale.voucher_id
  returning code into v_code;

  insert into public.router_jobs (router_id, type, payload, created_by)
  values (v_sale.router_id, 'disable_voucher', jsonb_build_object('voucher_id', v_sale.voucher_id, 'code', v_code), auth.uid());

  perform public.write_audit('sale.voided', jsonb_build_object(
    'sale_id', p_sale_id, 'voucher_id', v_sale.voucher_id, 'code', v_code,
    'amount_ssp', v_sale.amount_ssp, 'reason', trim(p_reason)));
end;
$$;

create or replace function public.report_site_scope(p_site_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Only admins and managers can open reports.' using errcode = '42501';
  end if;
  if v_role = 'manager' then
    if p_site_id is not null and p_site_id is distinct from public.app_site_id() then
      raise exception 'You can only see reports for your own site.' using errcode = '42501';
    end if;
    return public.app_site_id();
  end if;
  if p_site_id is not null and not public.can_access_site(p_site_id) then
    raise exception 'Site not found.' using errcode = 'P0002';
  end if;
  return p_site_id;
end;
$$;

-- A plan change only goes to the routers of its own business.
create or replace function public.plans_queue_profile_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.rate_limit is not distinct from old.rate_limit
     and new.shared_users = old.shared_users
     and new.router_profile_name = old.router_profile_name then
    return new;
  end if;

  insert into public.router_jobs (router_id, type, payload, created_by)
  select r.id, 'sync_profiles', jsonb_build_object('plan_id', new.id), auth.uid()
  from public.routers r
  where r.tenant_id = new.tenant_id
    and r.status <> 'pending'
    and not exists (
      select 1 from public.router_jobs j
      where j.router_id = r.id
        and j.type = 'sync_profiles'
        and j.status = 'queued'
        and (j.payload->>'plan_id' = new.id::text or not (j.payload ? 'plan_id'))
    );
  return new;
end;
$$;
