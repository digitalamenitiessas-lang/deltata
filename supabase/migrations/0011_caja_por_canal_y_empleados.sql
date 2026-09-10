-- Del Tata — Caja por lugar y pago de empleados (2026-09-09)
--
-- De la reunión: "Casa, foodtruck y local PedidosYa / Caja distinta" y
-- "Control de pago de empleados".
--
-- 1) CAJA POR CANAL. Hasta acá había UNA caja para todo. Si el Tano vende al
--    mediodía en el local y a la noche sale el foodtruck, las dos ventas caían
--    en el mismo arqueo y el descuadre de una tapaba el de la otra. Ahora cada
--    canal tiene su propia caja, que se abre y se cierra por separado.
--
--    A propósito NO hay índice único de "una sola caja abierta por canal": la
--    app funciona sin señal y dos dispositivos podrían abrir la misma caja
--    offline. Si eso fuera un error de base, la operación quedaría trabada en
--    la cola para siempre. Se controla en el dispositivo, que es donde se puede
--    avisar a tiempo, y el arqueo de cada sesión sigue cerrando por separado.
--
-- 2) PAGO DE EMPLEADOS. No se inventa un ledger nuevo: un sueldo YA es un
--    gasto, y como gasto en efectivo con la caja abierta descuenta del arqueo
--    solo. Lo único que faltaba era saber A QUIÉN se le pagó. Con eso, la
--    pantalla de empleados sale de datos que ya cuadran con la caja, en vez de
--    ser un segundo número que puede diferir del primero.

-- ── CAJA POR CANAL ──────────────────────────────────────────────────────────
alter table cash_sessions
  add column if not exists canal_id uuid references canales(id);

comment on column cash_sessions.canal_id is
  'Por qué lugar se abrió esta caja. NULL = cajas viejas, de cuando había una sola.';

-- Las cajas que ya existen eran del foodtruck: es el canal por defecto y el
-- único que se estaba usando. Dejarlas en NULL las volvería invisibles.
update cash_sessions
set canal_id = (select id from canales where es_default limit 1)
where canal_id is null;

create index if not exists idx_cash_sessions_canal
  on cash_sessions(canal_id, status, opened_at desc);

-- ── PAGO DE EMPLEADOS ───────────────────────────────────────────────────────
alter table expenses
  add column if not exists empleado_id uuid references profiles(id);

comment on column expenses.empleado_id is
  'A quién se le pagó, cuando el gasto es un sueldo o adelanto.';

create index if not exists idx_expenses_empleado
  on expenses(empleado_id, spent_at desc);

-- ── OPERACIONES ─────────────────────────────────────────────────────────────
create or replace function sync_op(p_kind text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session uuid; v_item jsonb; v_balance numeric; v_exists boolean;
  v_current numeric; v_qty numeric; v_uid uuid; v_prod uuid; v_usado boolean;
begin
  v_uid := nullif(p->>'user_id','')::uuid;

  if p_kind = 'open_cash' then
    insert into cash_sessions (id, local_uuid, opened_at, opened_by, opened_by_id,
                               opening_float, note, status, canal_id)
    values ((p->>'id')::uuid, p->>'id', (p->>'opened_at')::timestamptz,
            coalesce(p->>'opened_by',''), v_uid,
            coalesce(nullif(p->>'opening_float','')::numeric,0), p->>'note', 'abierta',
            nullif(p->>'canal_id','')::uuid)
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
      insert into sales (id, local_uuid, sold_at, cash_session_id, canal_id, payment_method, customer_id,
                         subtotal, discount, promo_discount, total, cash_received, sold_by, user_id, note)
      values ((p->>'id')::uuid, p->>'id', (p->>'sold_at')::timestamptz, v_session,
              nullif(p->>'canal_id','')::uuid, p->>'payment_method',
              nullif(p->>'customer_id','')::uuid, (p->>'subtotal')::numeric,
              coalesce(nullif(p->>'discount','')::numeric,0),
              coalesce(nullif(p->>'ahorro_promos','')::numeric,0), (p->>'total')::numeric,
              nullif(p->>'cash_received','')::numeric, p->>'sold_by', v_uid, p->>'note');

      for v_item in select * from jsonb_array_elements(p->'items') loop
        insert into sale_items (sale_id, product_id, qty, unit_price, line_total, presentacion)
        values ((p->>'id')::uuid, (v_item->>'product_id')::uuid, (v_item->>'qty')::numeric,
                (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric,
                coalesce(v_item->>'presentacion','cocida'));
      end loop;

      for v_item in select * from jsonb_array_elements(coalesce(p->'promos','[]'::jsonb)) loop
        insert into sale_promos (sale_id, promo_id, nombre, veces, ahorro)
        select (p->>'id')::uuid, (v_item->>'promo_id')::uuid,
               coalesce(v_item->>'nombre',''), coalesce((v_item->>'veces')::numeric,1),
               coalesce((v_item->>'ahorro')::numeric,0)
        where exists (select 1 from promos where id = (v_item->>'promo_id')::uuid)
        on conflict (sale_id, promo_id) do nothing;
      end loop;

      for v_prod, v_qty in
        select (i->>'product_id')::uuid, sum((i->>'qty')::numeric)
        from jsonb_array_elements(p->'items') i group by 1
      loop
        insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at, created_by, user_id)
        values (gen_random_uuid(), (p->>'id') || ':' || v_prod::text, v_prod, 'venta', -v_qty,
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
                          cash_session_id, product_id, qty_purchased, supplier, created_by, user_id,
                          empleado_id)
    values ((p->>'id')::uuid, p->>'id', (p->>'spent_at')::timestamptz, p->>'category', p->>'description',
            (p->>'amount')::numeric, p->>'payment_method', v_session,
            nullif(p->>'product_id','')::uuid, nullif(p->>'qty_purchased','')::numeric,
            p->>'supplier', p->>'created_by', v_uid, nullif(p->>'empleado_id','')::uuid)
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
    insert into products (id, name, kind, unit_price, half_dozen_price, dozen_price, frozen_dozen_price,
                          cost_per_unit, min_qty, sort_order, is_active, updated_by)
    values ((p->>'id')::uuid, p->>'name', p->>'kind', (p->>'unit_price')::numeric,
            nullif(p->>'half_dozen_price','')::numeric,
            nullif(p->>'dozen_price','')::numeric, nullif(p->>'frozen_dozen_price','')::numeric,
            nullif(p->>'cost_per_unit','')::numeric,
            nullif(p->>'min_qty','')::numeric, coalesce((p->>'sort_order')::int, 0),
            coalesce((p->>'is_active')::boolean, true), v_uid)
    on conflict (id) do update set
      name = excluded.name, kind = excluded.kind, unit_price = excluded.unit_price,
      half_dozen_price = excluded.half_dozen_price,
      dozen_price = excluded.dozen_price, frozen_dozen_price = excluded.frozen_dozen_price,
      cost_per_unit = excluded.cost_per_unit,
      min_qty = excluded.min_qty, sort_order = excluded.sort_order,
      is_active = excluded.is_active, updated_at = now(), updated_by = v_uid;

  elsif p_kind = 'delete_product' then
    v_prod := (p->>'id')::uuid;
    select exists(select 1 from sale_items where product_id = v_prod)
        or exists(select 1 from stock_movements where product_id = v_prod)
        or exists(select 1 from stock_counts where product_id = v_prod)
      into v_usado;
    if v_usado then
      update products set is_active = false, updated_at = now(), updated_by = v_uid
      where id = v_prod;
    else
      delete from canal_precios where product_id = v_prod;
      delete from promos where product_id = v_prod or bebida_product_id = v_prod;
      delete from products where id = v_prod;
    end if;
    return jsonb_build_object('ok', true, 'desactivado', v_usado);

  elsif p_kind = 'upsert_canal' then
    insert into canales (id, nombre, recargo_pct, es_default, activo, sort_order)
    values ((p->>'id')::uuid, p->>'nombre', coalesce(nullif(p->>'recargo_pct','')::numeric,0),
            coalesce((p->>'es_default')::boolean,false),
            coalesce((p->>'activo')::boolean,true), coalesce((p->>'sort_order')::int,0))
    on conflict (id) do update set nombre = excluded.nombre,
      recargo_pct = excluded.recargo_pct, activo = excluded.activo,
      sort_order = excluded.sort_order;

  elsif p_kind = 'upsert_canal_precio' then
    if coalesce((p->>'borrar')::boolean, false) then
      delete from canal_precios
      where canal_id = (p->>'canal_id')::uuid and product_id = (p->>'product_id')::uuid;
    else
      insert into canal_precios (canal_id, product_id, unit_price, half_dozen_price,
                                 dozen_price, frozen_dozen_price, updated_by)
      values ((p->>'canal_id')::uuid, (p->>'product_id')::uuid,
              nullif(p->>'unit_price','')::numeric, nullif(p->>'half_dozen_price','')::numeric,
              nullif(p->>'dozen_price','')::numeric, nullif(p->>'frozen_dozen_price','')::numeric,
              v_uid)
      on conflict (canal_id, product_id) do update set
        unit_price = excluded.unit_price, half_dozen_price = excluded.half_dozen_price,
        dozen_price = excluded.dozen_price, frozen_dozen_price = excluded.frozen_dozen_price,
        updated_at = now(), updated_by = v_uid;
    end if;

  elsif p_kind = 'upsert_promo' then
    insert into promos (id, nombre, tipo, empanadas_qty, bebida_product_id, bebida_qty,
                        precio_fijo, valor, product_id, kind, minimo_unidades,
                        dias, desde, hasta, canal_id, activo, sort_order, updated_by)
    values ((p->>'id')::uuid, p->>'nombre', p->>'tipo',
            nullif(p->>'empanadas_qty','')::numeric,
            nullif(p->>'bebida_product_id','')::uuid,
            nullif(p->>'bebida_qty','')::numeric,
            nullif(p->>'precio_fijo','')::numeric,
            nullif(p->>'valor','')::numeric,
            nullif(p->>'product_id','')::uuid,
            nullif(p->>'kind',''),
            nullif(p->>'minimo_unidades','')::numeric,
            case when p->'dias' is null or jsonb_typeof(p->'dias') <> 'array' then null
                 else (select array_agg(value::int) from jsonb_array_elements_text(p->'dias')) end,
            nullif(p->>'desde','')::time,
            nullif(p->>'hasta','')::time,
            nullif(p->>'canal_id','')::uuid,
            coalesce((p->>'activo')::boolean, true),
            coalesce((p->>'sort_order')::int, 0), v_uid)
    on conflict (id) do update set
      nombre = excluded.nombre, tipo = excluded.tipo,
      empanadas_qty = excluded.empanadas_qty,
      bebida_product_id = excluded.bebida_product_id, bebida_qty = excluded.bebida_qty,
      precio_fijo = excluded.precio_fijo, valor = excluded.valor,
      product_id = excluded.product_id, kind = excluded.kind,
      minimo_unidades = excluded.minimo_unidades, dias = excluded.dias,
      desde = excluded.desde, hasta = excluded.hasta, canal_id = excluded.canal_id,
      activo = excluded.activo, sort_order = excluded.sort_order,
      updated_at = now(), updated_by = v_uid;

  elsif p_kind = 'delete_promo' then
    select exists(select 1 from sale_promos where promo_id = (p->>'id')::uuid) into v_usado;
    if v_usado then
      update promos set activo = false, updated_at = now(), updated_by = v_uid
      where id = (p->>'id')::uuid;
    else
      delete from promos where id = (p->>'id')::uuid;
    end if;
    return jsonb_build_object('ok', true, 'desactivado', v_usado);

  else
    raise exception 'sync_op: tipo de operación desconocido: %', p_kind;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function sync_op(text, jsonb) from public, anon, authenticated;

-- ── LO QUE SUELE LLEVAR CADA CLIENTE ────────────────────────────────────────
-- Para poder recomendar ("¿le pongo las de carne como siempre?") hace falta
-- mirar el histórico completo, no sólo lo que vendió este celular. Se resuelve
-- con una vista: el cálculo queda en la base y la app sólo lo lee.
create or replace view cliente_gustos as
select
  s.customer_id,
  si.product_id,
  pr.name as product_name,
  sum(si.qty) as unidades,
  count(distinct s.id) as veces,
  max(s.sold_at) as ultima_vez
from sales s
join sale_items si on si.sale_id = s.id
join products pr on pr.id = si.product_id
where s.customer_id is not null
group by s.customer_id, si.product_id, pr.name;

comment on view cliente_gustos is
  'Qué se lleva cada cliente, para poder recomendarle. Se lee desde /api/bootstrap.';
