-- Guarda la autoría (user_id) que ahora manda el servidor en cada operación.
create or replace function sync_op(p_kind text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session uuid; v_item jsonb; v_balance numeric; v_exists boolean;
  v_current numeric; v_qty numeric; v_uid uuid;
begin
  v_uid := nullif(p->>'user_id','')::uuid;

  if p_kind = 'open_cash' then
    insert into cash_sessions (id, local_uuid, opened_at, opened_by, opened_by_id, opening_float, note, status)
    values ((p->>'id')::uuid, p->>'id', (p->>'opened_at')::timestamptz,
            coalesce(p->>'opened_by',''), v_uid,
            coalesce(nullif(p->>'opening_float','')::numeric,0), p->>'note', 'abierta')
    on conflict (local_uuid) do nothing;

  elsif p_kind = 'close_cash' then
    update cash_sessions set
      closed_at = (p->>'closed_at')::timestamptz, closed_by = p->>'closed_by',
      closed_by_id = v_uid,
      counted_cash = nullif(p->>'counted_cash','')::numeric,
      expected_cash = nullif(p->>'expected_cash','')::numeric,
      difference = nullif(p->>'difference','')::numeric,
      note = coalesce(p->>'note', note), status = 'cerrada'
    where local_uuid = p->>'id' and status = 'abierta';

  elsif p_kind = 'sale' then
    select exists(select 1 from sales where local_uuid = p->>'id') into v_exists;
    if not v_exists then
      select id into v_session from cash_sessions where local_uuid = p->>'cash_session_id';
      insert into sales (id, local_uuid, sold_at, cash_session_id, payment_method, customer_id,
                         subtotal, discount, total, cash_received, sold_by, user_id, note)
      values ((p->>'id')::uuid, p->>'id', (p->>'sold_at')::timestamptz, v_session, p->>'payment_method',
              nullif(p->>'customer_id','')::uuid, (p->>'subtotal')::numeric,
              coalesce(nullif(p->>'discount','')::numeric,0), (p->>'total')::numeric,
              nullif(p->>'cash_received','')::numeric, p->>'sold_by', v_uid, p->>'note');
      for v_item in select * from jsonb_array_elements(p->'items') loop
        insert into sale_items (sale_id, product_id, qty, unit_price, line_total)
        values ((p->>'id')::uuid, (v_item->>'product_id')::uuid, (v_item->>'qty')::numeric,
                (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric);
        insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at, created_by, user_id)
        values (gen_random_uuid(), (p->>'id') || ':' || (v_item->>'product_id'),
                (v_item->>'product_id')::uuid, 'venta', -((v_item->>'qty')::numeric),
                'Venta', (p->>'id')::uuid, (p->>'sold_at')::timestamptz, p->>'sold_by', v_uid)
        on conflict (local_uuid) do nothing;
      end loop;
      if p->>'payment_method' = 'cuenta_corriente' and nullif(p->>'customer_id','') is not null then
        select coalesce((select balance_after from account_movements
                         where customer_id = (p->>'customer_id')::uuid order by seq desc limit 1), 0) into v_balance;
        insert into account_movements (id, local_uuid, customer_id, type, amount, balance_after, sale_id, moved_at, created_by, user_id)
        values (gen_random_uuid(), 'cc:' || (p->>'id'), (p->>'customer_id')::uuid, 'venta',
                (p->>'total')::numeric, v_balance + (p->>'total')::numeric,
                (p->>'id')::uuid, (p->>'sold_at')::timestamptz, p->>'sold_by', v_uid)
        on conflict (local_uuid) do nothing;
      end if;
    end if;

  elsif p_kind = 'expense' then
    select id into v_session from cash_sessions where local_uuid = nullif(p->>'cash_session_id','');
    insert into expenses (id, local_uuid, spent_at, category, description, amount, payment_method,
                          cash_session_id, product_id, qty_purchased, supplier, created_by, user_id)
    values ((p->>'id')::uuid, p->>'id', (p->>'spent_at')::timestamptz, p->>'category', p->>'description',
            (p->>'amount')::numeric, p->>'payment_method', v_session,
            nullif(p->>'product_id','')::uuid, nullif(p->>'qty_purchased','')::numeric,
            p->>'supplier', p->>'created_by', v_uid)
    on conflict (local_uuid) do nothing;
    if nullif(p->>'product_id','') is not null
       and coalesce(nullif(p->>'qty_purchased','')::numeric, 0) > 0 then
      insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at, created_by, user_id)
      values (gen_random_uuid(), 'exp:' || (p->>'id'), (p->>'product_id')::uuid, 'compra',
              nullif(p->>'qty_purchased','')::numeric, coalesce(p->>'description','Compra'),
              (p->>'id')::uuid, (p->>'spent_at')::timestamptz, p->>'created_by', v_uid)
      on conflict (local_uuid) do nothing;
      if nullif(p->>'new_cost','') is not null then
        update products set cost_per_unit = nullif(p->>'new_cost','')::numeric,
               updated_at = now(), updated_by = v_uid
        where id = (p->>'product_id')::uuid;
      end if;
    end if;

  elsif p_kind = 'stock_count' then
    select exists(select 1 from stock_counts where local_uuid = p->>'id') into v_exists;
    if not v_exists then
      insert into stock_counts (id, local_uuid, counted_at, product_id, system_qty, counted_qty, diff, note, counted_by, user_id)
      values ((p->>'id')::uuid, p->>'id', (p->>'counted_at')::timestamptz, (p->>'product_id')::uuid,
              (p->>'system_qty')::numeric, (p->>'counted_qty')::numeric, (p->>'diff')::numeric,
              p->>'note', p->>'counted_by', v_uid);
      select current_qty into v_current from products where id = (p->>'product_id')::uuid;
      v_qty := (p->>'counted_qty')::numeric - coalesce(v_current, 0);
      insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at, created_by, user_id)
      values (gen_random_uuid(), 'count:' || (p->>'id'), (p->>'product_id')::uuid, 'conteo',
              v_qty, 'Conteo físico', (p->>'id')::uuid, (p->>'counted_at')::timestamptz, p->>'counted_by', v_uid)
      on conflict (local_uuid) do nothing;
    end if;

  elsif p_kind = 'stock_move' then
    insert into stock_movements (id, local_uuid, product_id, type, qty, reason, moved_at, created_by, user_id)
    values ((p->>'id')::uuid, p->>'id', (p->>'product_id')::uuid, p->>'type',
            (p->>'qty')::numeric, p->>'reason', (p->>'moved_at')::timestamptz, p->>'created_by', v_uid)
    on conflict (local_uuid) do nothing;

  elsif p_kind = 'upsert_customer' then
    insert into customers (id, name, phone, note, credit_limit, is_active)
    values ((p->>'id')::uuid, p->>'name', p->>'phone', p->>'note',
            nullif(p->>'credit_limit','')::numeric, coalesce((p->>'is_active')::boolean, true))
    on conflict (id) do update set name = excluded.name, phone = excluded.phone,
      note = excluded.note, credit_limit = excluded.credit_limit, is_active = excluded.is_active;

  elsif p_kind = 'customer_payment' then
    select exists(select 1 from account_movements where local_uuid = p->>'id') into v_exists;
    if not v_exists then
      select id into v_session from cash_sessions where local_uuid = nullif(p->>'cash_session_id','');
      select coalesce((select balance_after from account_movements
                       where customer_id = (p->>'customer_id')::uuid order by seq desc limit 1), 0) into v_balance;
      insert into account_movements (id, local_uuid, customer_id, type, amount, balance_after,
                                     payment_method, cash_session_id, note, moved_at, created_by, user_id)
      values ((p->>'id')::uuid, p->>'id', (p->>'customer_id')::uuid, p->>'type',
              (p->>'amount')::numeric, v_balance + (p->>'amount')::numeric,
              p->>'payment_method', v_session, p->>'note', (p->>'moved_at')::timestamptz,
              p->>'created_by', v_uid);
    end if;

  elsif p_kind = 'upsert_product' then
    insert into products (id, name, kind, unit_price, dozen_price, cost_per_unit, min_qty, sort_order, is_active, updated_by)
    values ((p->>'id')::uuid, p->>'name', p->>'kind', (p->>'unit_price')::numeric,
            nullif(p->>'dozen_price','')::numeric, nullif(p->>'cost_per_unit','')::numeric,
            nullif(p->>'min_qty','')::numeric, coalesce((p->>'sort_order')::int, 0),
            coalesce((p->>'is_active')::boolean, true), v_uid)
    on conflict (id) do update set
      name = excluded.name, kind = excluded.kind, unit_price = excluded.unit_price,
      dozen_price = excluded.dozen_price, cost_per_unit = excluded.cost_per_unit,
      min_qty = excluded.min_qty, sort_order = excluded.sort_order,
      is_active = excluded.is_active, updated_at = now(), updated_by = v_uid;

  else
    raise exception 'sync_op: tipo de operación desconocido: %', p_kind;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function sync_op(text, jsonb) from public, anon, authenticated;
revoke execute on function log_audit(uuid,text,text,text,text,text,timestamptz,numeric,numeric,jsonb,text) from public, anon, authenticated;
