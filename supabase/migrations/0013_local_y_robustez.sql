-- Del Tata — El local físico y una cola que no se traba (2026-10-10)
--
-- Abrió el local y el foodtruck sigue saliendo: dos lugares vendiendo a la vez,
-- cada uno con su congelador. Esta migración:
--
-- 1) UBICACIONES. El stock deja de ser un número único. Cada movimiento ocurre
--    en un lugar (Local o Foodtruck) y cada lugar tiene su saldo. Si se cuenta
--    el congelador del local, no se "pierden" las empanadas que están en el
--    foodtruck. products.current_qty sigue existiendo como total.
--
-- 2) CONTEOS QUE NO SE PISAN. Un conteo vale para el momento en que se hizo,
--    no para cuando llega al servidor. Si una venta hecha sin señal ANTES del
--    conteo llega DESPUÉS, el conteo ya la midió: no se descuenta dos veces.
--    Se la "absorbe" corrigiendo el ajuste de ese conteo.
--
-- 3) PEDIDOS para llevar y delivery, con estado.
--
-- 4) CAJAS: cierre sin arqueo desde cualquier equipo (para las que quedaron
--    abiertas), conciliación de QR y posnet, y el esperado recalculado acá.
--
-- 5) Saldo de cuenta corriente como suma (no "el último saldo"), con lock.
--
-- 6) Productos: dar de baja nunca borra (una venta sin señal podía apuntar a
--    un producto borrado y trabar la cola).
--
-- 7) actualizado_en en las tablas operativas, para que cada equipo pueda
--    traer lo que hicieron los otros.

-- ── 1. UBICACIONES ──────────────────────────────────────────────────────────
create table if not exists ubicaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table ubicaciones enable row level security;

insert into ubicaciones (id, nombre, sort_order) values
  ('0b1c0000-0000-4000-8000-000000000001', 'Foodtruck', 1),
  ('0b1c0000-0000-4000-8000-000000000002', 'Local', 2)
on conflict (id) do nothing;

-- El lugar de lo que no dice dónde ocurrió: todo lo anterior a hoy era del
-- foodtruck, que era el único lugar.
create or replace function ubicacion_por_defecto() returns uuid
language sql stable as $$
  select '0b1c0000-0000-4000-8000-000000000001'::uuid
$$;

alter table canales
  add column if not exists ubicacion_id uuid references ubicaciones(id);

update canales set ubicacion_id = '0b1c0000-0000-4000-8000-000000000001'
where nombre = 'Foodtruck' and ubicacion_id is null;
update canales set ubicacion_id = '0b1c0000-0000-4000-8000-000000000002'
where ubicacion_id is null;

-- El mostrador del local es un canal más, con su propia caja
insert into canales (id, nombre, recargo_pct, es_default, activo, sort_order, ubicacion_id)
values ('ca17a7a0-0000-4000-8000-000000000003', 'Local', 0, false, true, 0,
        '0b1c0000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

alter table stock_movements
  add column if not exists ubicacion_id uuid references ubicaciones(id),
  add column if not exists absorbido boolean not null default false;
update stock_movements set ubicacion_id = ubicacion_por_defecto() where ubicacion_id is null;

alter table stock_counts
  add column if not exists ubicacion_id uuid references ubicaciones(id);
update stock_counts set ubicacion_id = ubicacion_por_defecto() where ubicacion_id is null;

-- Traslado: mover mercadería de un lugar al otro (sale de uno, entra al otro)
alter table stock_movements drop constraint if exists stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check
  check (type in ('compra','venta','merma','ajuste','produccion','conteo','traslado'));

create table if not exists stock_ubicacion (
  product_id uuid not null references products(id),
  ubicacion_id uuid not null references ubicaciones(id),
  qty numeric not null default 0,
  primary key (product_id, ubicacion_id)
);
alter table stock_ubicacion enable row level security;

-- Saldo inicial: la suma del ledger (que es lo que da current_qty hoy)
insert into stock_ubicacion (product_id, ubicacion_id, qty)
select product_id, ubicacion_id, sum(qty)
from stock_movements group by product_id, ubicacion_id
on conflict (product_id, ubicacion_id) do update set qty = excluded.qty;

create index if not exists idx_stock_mov_conteos
  on stock_movements(product_id, ubicacion_id, moved_at) where type = 'conteo';
create index if not exists idx_stock_mov_lugar
  on stock_movements(product_id, ubicacion_id, moved_at);

-- ── 2. EL TRIGGER DEL LEDGER ────────────────────────────────────────────────
-- Invariante: el saldo de un lugar es la suma de TODOS sus movimientos
-- (incluidos los absorbidos). Un movimiento que llega después de un conteo
-- posterior no cambia el saldo: corrige el ajuste de ese conteo, que ya lo
-- había medido en lo físico.
create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
declare
  v_ubic uuid; v_conteo_id uuid; v_count_id uuid; v_qty numeric;
begin
  v_ubic := coalesce(new.ubicacion_id, ubicacion_por_defecto());
  new.ubicacion_id := v_ubic;

  -- Un producto en un lugar, de a una operación por vez: si un conteo y una
  -- venta tardía se sincronizan en paralelo, ninguno vería al otro.
  perform pg_advisory_xact_lock(hashtext('stock:' || new.product_id::text || ':' || v_ubic::text));

  select sm.id, sm.ref_id into v_conteo_id, v_count_id
  from stock_movements sm
  where sm.product_id = new.product_id and sm.ubicacion_id = v_ubic
    and sm.type = 'conteo' and sm.moved_at > new.moved_at
  order by sm.moved_at asc
  limit 1;

  if v_conteo_id is not null then
    update stock_movements set qty = qty - new.qty where id = v_conteo_id;
    update stock_counts set diff = diff - new.qty, system_qty = system_qty + new.qty
    where id = v_count_id;
    new.absorbido := true;
    select qty into v_qty from stock_ubicacion
    where product_id = new.product_id and ubicacion_id = v_ubic;
    new.balance_after := coalesce(v_qty, 0);
    return new;
  end if;

  insert into stock_ubicacion (product_id, ubicacion_id, qty)
  values (new.product_id, v_ubic, new.qty)
  on conflict (product_id, ubicacion_id)
  do update set qty = stock_ubicacion.qty + excluded.qty
  returning qty into v_qty;

  update products set current_qty = current_qty + new.qty, updated_at = now()
  where id = new.product_id;

  new.balance_after := v_qty;
  return new;
end $$;

-- ── 3. PEDIDOS ──────────────────────────────────────────────────────────────
create table if not exists pedidos (
  id uuid primary key,
  creado_en timestamptz not null,
  creado_por text,
  user_id uuid references auth.users(id),
  canal_id uuid references canales(id),
  cliente_nombre text not null,
  telefono text,
  tipo text not null check (tipo in ('retira', 'delivery')),
  direccion text,
  para_cuando timestamptz,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'preparando', 'listo', 'entregado', 'cancelado')),
  -- lo que se pidió: { "productId:presentacion": unidades }
  cantidades jsonb not null default '{}'::jsonb,
  -- foto de las líneas al momento de tomarlo, para mostrar sin recalcular
  lineas jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  nota text,
  sale_id uuid references sales(id),
  pagado boolean not null default false,
  -- reloj del dispositivo que hizo el último cambio: gana el más nuevo
  cambiado_en timestamptz not null,
  actualizado_en timestamptz not null default now()
);
alter table pedidos enable row level security;
create index if not exists idx_pedidos_estado on pedidos(estado, para_cuando);
create index if not exists idx_pedidos_actualizado on pedidos(actualizado_en);

-- ── 4. CAJAS ────────────────────────────────────────────────────────────────
alter table cash_sessions
  add column if not exists conciliacion jsonb,
  add column if not exists sin_arqueo boolean not null default false,
  add column if not exists esperado_servidor numeric;

comment on column cash_sessions.conciliacion is
  'QR y posnet: lo que dice el sistema contra lo que informa Mercado Pago / el posnet.';
comment on column cash_sessions.sin_arqueo is
  'Cerrada por el dueño desde otro equipo, sin contar el efectivo (cajas olvidadas).';

-- ── 6. PRODUCTOS ────────────────────────────────────────────────────────────
alter table products add column if not exists archivado boolean not null default false;

-- ── 7. actualizado_en ───────────────────────────────────────────────────────
create or replace function marcar_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sales','cash_sessions','expenses','stock_movements','stock_counts','pedidos'] loop
    execute format('alter table %I add column if not exists actualizado_en timestamptz not null default now()', t);
  end loop;
end $$;

-- Lo que ya existía no "cambió hoy": lleva su propia fecha. Si no, todo
-- empataría en el mismo instante y el historial incremental (por fecha)
-- salteaba filas, y las ventanas de 7/45 días no recortaban nada.
update sales set actualizado_en = sold_at;
update cash_sessions set actualizado_en = coalesce(closed_at, opened_at);
update expenses set actualizado_en = spent_at;
update stock_movements set actualizado_en = moved_at;
update stock_counts set actualizado_en = counted_at;

do $$
declare t text;
begin
  foreach t in array array['sales','cash_sessions','expenses','stock_movements','stock_counts','pedidos'] loop
    execute format('create index if not exists %I on %I(actualizado_en)', 'idx_' || t || '_actualizado', t);
    execute format('drop trigger if exists %I on %I', 'trg_' || t || '_actualizado', t);
    execute format('create trigger %I before update on %I for each row execute function marcar_actualizado()',
                   'trg_' || t || '_actualizado', t);
  end loop;
end $$;

-- ── VISTA EXPUESTA ──────────────────────────────────────────────────────────
-- Sin security_invoker la vista corre con los permisos de su dueño y salta la
-- RLS: cualquiera con la clave pública podía leer qué compra cada cliente.
alter view cliente_gustos set (security_invoker = true);
revoke all on cliente_gustos from anon, authenticated;

-- ── OPERACIONES ─────────────────────────────────────────────────────────────
create or replace function sync_op(p_kind text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session uuid; v_item jsonb; v_balance numeric; v_exists boolean;
  v_current numeric; v_qty numeric; v_uid uuid; v_prod uuid; v_ubic uuid;
  v_admin boolean; v_esperado numeric; v_float numeric; v_desde uuid; v_hacia uuid;
begin
  v_uid := nullif(p->>'user_id','')::uuid;
  -- lo pone el servidor (route), no el dispositivo
  v_admin := coalesce((p->>'es_admin')::boolean, false);

  if p_kind = 'open_cash' then
    insert into cash_sessions (id, local_uuid, opened_at, opened_by, opened_by_id,
                               opening_float, note, status, canal_id)
    values ((p->>'id')::uuid, p->>'id', (p->>'opened_at')::timestamptz,
            coalesce(p->>'opened_by',''), v_uid,
            coalesce(nullif(p->>'opening_float','')::numeric,0), p->>'note', 'abierta',
            nullif(p->>'canal_id','')::uuid)
    on conflict (local_uuid) do nothing;

  elsif p_kind = 'close_cash' then
    select id, opening_float into v_session, v_float
    from cash_sessions where local_uuid = p->>'id';
    -- El esperado se recalcula con lo que llegó al servidor. Si no coincide
    -- con el del dispositivo, el cierre entra igual y queda para revisar.
    if v_session is not null then
      v_esperado := coalesce(v_float, 0)
        + coalesce((select sum(total) from sales
                    where cash_session_id = v_session and payment_method = 'efectivo'), 0)
        + coalesce((select sum(-amount) from account_movements
                    where cash_session_id = v_session and payment_method = 'efectivo'
                      and type = 'pago'), 0)
        - coalesce((select sum(amount) from expenses
                    where cash_session_id = v_session and payment_method = 'efectivo'), 0);
    end if;
    update cash_sessions set
      closed_at = (p->>'closed_at')::timestamptz, closed_by = p->>'closed_by',
      closed_by_id = v_uid,
      counted_cash = nullif(p->>'counted_cash','')::numeric,
      expected_cash = nullif(p->>'expected_cash','')::numeric,
      difference = nullif(p->>'difference','')::numeric,
      conciliacion = case when jsonb_typeof(p->'conciliacion') = 'object'
                          then p->'conciliacion' else conciliacion end,
      esperado_servidor = v_esperado, sin_arqueo = false,
      note = coalesce(p->>'note', note), status = 'cerrada'
    -- Si el dueño la había cerrado sin arqueo y después llega el cierre con
    -- la plata contada (el equipo estaba sin señal), gana el arqueo real.
    where local_uuid = p->>'id' and (status = 'abierta' or sin_arqueo);
    return jsonb_build_object('ok', true, 'esperado_servidor', v_esperado);

  elsif p_kind = 'force_close_cash' then
    -- Cajas olvidadas: el dueño las cierra desde cualquier equipo, sin inventar
    -- cuánta plata había. Queda marcada como cerrada sin arqueo.
    update cash_sessions set
      closed_at = (p->>'closed_at')::timestamptz, closed_by = p->>'closed_by',
      closed_by_id = v_uid, counted_cash = null, expected_cash = null,
      difference = null, sin_arqueo = true,
      note = coalesce(nullif(p->>'note',''), 'Cerrada sin arqueo'), status = 'cerrada'
    where local_uuid = p->>'id' and status = 'abierta';

  elsif p_kind = 'sale' then
    select exists(select 1 from sales where local_uuid = p->>'id') into v_exists;
    if not v_exists then
      select id into v_session from cash_sessions where local_uuid = p->>'cash_session_id';
      v_ubic := coalesce(
        nullif(p->>'ubicacion_id','')::uuid,
        (select ubicacion_id from canales where id = nullif(p->>'canal_id','')::uuid),
        ubicacion_por_defecto());
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
        insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id,
                                     moved_at, created_by, user_id, ubicacion_id)
        values (gen_random_uuid(), (p->>'id') || ':' || v_prod::text, v_prod, 'venta', -v_qty,
                'Venta', (p->>'id')::uuid, (p->>'sold_at')::timestamptz, p->>'sold_by', v_uid, v_ubic)
        on conflict (local_uuid) do nothing;
      end loop;

      if p->>'payment_method' = 'cuenta_corriente' and nullif(p->>'customer_id','') is not null then
        perform pg_advisory_xact_lock(hashtext('cc:' || (p->>'customer_id')));
        select coalesce(sum(amount), 0) into v_balance
        from account_movements where customer_id = (p->>'customer_id')::uuid;
        insert into account_movements (id, local_uuid, customer_id, type, amount, balance_after, sale_id, moved_at, created_by, user_id)
        values (gen_random_uuid(), 'cc:' || (p->>'id'), (p->>'customer_id')::uuid, 'venta',
                (p->>'total')::numeric, v_balance + (p->>'total')::numeric,
                (p->>'id')::uuid, (p->>'sold_at')::timestamptz, p->>'sold_by', v_uid)
        on conflict (local_uuid) do nothing;
      end if;
    end if;

  elsif p_kind = 'expense' then
    -- El trigger del ledger corre ANTES de ver el conflicto: un reintento con
    -- "on conflict do nothing" igual sumaba stock. Por eso se mira primero.
    select exists(select 1 from expenses where local_uuid = p->>'id') into v_exists;
    if v_exists then
      return jsonb_build_object('ok', true, 'repetida', true);
    end if;
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
      insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id,
                                   moved_at, created_by, user_id, ubicacion_id)
      values (gen_random_uuid(), 'exp:' || (p->>'id'), (p->>'product_id')::uuid, 'compra',
              nullif(p->>'qty_purchased','')::numeric, coalesce(p->>'description','Compra'),
              (p->>'id')::uuid, (p->>'spent_at')::timestamptz, p->>'created_by', v_uid,
              coalesce(nullif(p->>'ubicacion_id','')::uuid, ubicacion_por_defecto()))
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
      v_ubic := coalesce(nullif(p->>'ubicacion_id','')::uuid, ubicacion_por_defecto());
      perform pg_advisory_xact_lock(
        hashtext('stock:' || (p->>'product_id') || ':' || v_ubic::text));
      -- Lo que había según el sistema EN EL MOMENTO del conteo, en ese lugar.
      -- No "ahora": lo vendido después del conteo no lo vio quien contó.
      select coalesce(sum(qty), 0) into v_current
      from stock_movements
      where product_id = (p->>'product_id')::uuid and ubicacion_id = v_ubic
        and moved_at <= (p->>'counted_at')::timestamptz;
      v_qty := (p->>'counted_qty')::numeric - v_current;
      insert into stock_counts (id, local_uuid, counted_at, product_id, system_qty, counted_qty,
                                diff, note, counted_by, user_id, ubicacion_id)
      values ((p->>'id')::uuid, p->>'id', (p->>'counted_at')::timestamptz, (p->>'product_id')::uuid,
              v_current, (p->>'counted_qty')::numeric, v_qty,
              p->>'note', p->>'counted_by', v_uid, v_ubic);
      insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id,
                                   moved_at, created_by, user_id, ubicacion_id)
      values (gen_random_uuid(), 'count:' || (p->>'id'), (p->>'product_id')::uuid, 'conteo',
              v_qty, 'Conteo físico', (p->>'id')::uuid, (p->>'counted_at')::timestamptz,
              p->>'counted_by', v_uid, v_ubic)
      on conflict (local_uuid) do nothing;
      return jsonb_build_object('ok', true, 'system_qty', v_current, 'diff', v_qty);
    end if;

  elsif p_kind = 'stock_move' then
    if exists(select 1 from stock_movements where local_uuid = p->>'id') then
      return jsonb_build_object('ok', true, 'repetida', true);
    end if;
    insert into stock_movements (id, local_uuid, product_id, type, qty, reason, moved_at,
                                 created_by, user_id, ubicacion_id)
    values ((p->>'id')::uuid, p->>'id', (p->>'product_id')::uuid, p->>'type',
            (p->>'qty')::numeric, p->>'reason', (p->>'moved_at')::timestamptz, p->>'created_by', v_uid,
            coalesce(nullif(p->>'ubicacion_id','')::uuid, ubicacion_por_defecto()))
    on conflict (local_uuid) do nothing;

  elsif p_kind = 'transfer_stock' then
    -- Sale de un lugar y entra al otro: dos movimientos con el mismo origen
    if exists(select 1 from stock_movements where local_uuid = (p->>'id') || ':sale') then
      return jsonb_build_object('ok', true, 'repetida', true);
    end if;
    v_desde := (p->>'desde_id')::uuid;
    v_hacia := (p->>'hacia_id')::uuid;
    v_qty := abs((p->>'qty')::numeric);
    insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at,
                                 created_by, user_id, ubicacion_id)
    values (gen_random_uuid(), (p->>'id') || ':sale', (p->>'product_id')::uuid, 'traslado', -v_qty,
            p->>'reason', (p->>'id')::uuid, (p->>'moved_at')::timestamptz, p->>'created_by', v_uid, v_desde)
    on conflict (local_uuid) do nothing;
    insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at,
                                 created_by, user_id, ubicacion_id)
    values (gen_random_uuid(), (p->>'id') || ':entra', (p->>'product_id')::uuid, 'traslado', v_qty,
            p->>'reason', (p->>'id')::uuid, (p->>'moved_at')::timestamptz, p->>'created_by', v_uid, v_hacia)
    on conflict (local_uuid) do nothing;

  elsif p_kind = 'upsert_customer' then
    if v_admin then
      insert into customers (id, name, phone, note, credit_limit, is_active)
      values ((p->>'id')::uuid, p->>'name', p->>'phone', p->>'note',
              nullif(p->>'credit_limit','')::numeric, coalesce((p->>'is_active')::boolean, true))
      on conflict (id) do update set name = excluded.name, phone = excluded.phone,
        note = excluded.note, credit_limit = excluded.credit_limit, is_active = excluded.is_active;
    else
      -- Quien atiende da de alta y corrige datos de contacto; el límite de
      -- crédito y la baja de un cliente existente son del dueño.
      insert into customers (id, name, phone, note, credit_limit, is_active)
      values ((p->>'id')::uuid, p->>'name', p->>'phone', p->>'note',
              nullif(p->>'credit_limit','')::numeric, true)
      on conflict (id) do update set name = excluded.name, phone = excluded.phone,
        note = excluded.note;
    end if;

  elsif p_kind = 'customer_payment' then
    select exists(select 1 from account_movements where local_uuid = p->>'id') into v_exists;
    if not v_exists then
      select id into v_session from cash_sessions where local_uuid = nullif(p->>'cash_session_id','');
      perform pg_advisory_xact_lock(hashtext('cc:' || (p->>'customer_id')));
      select coalesce(sum(amount), 0) into v_balance
      from account_movements where customer_id = (p->>'customer_id')::uuid;
      insert into account_movements (id, local_uuid, customer_id, type, amount, balance_after,
                                     payment_method, cash_session_id, note, moved_at, created_by, user_id)
      values ((p->>'id')::uuid, p->>'id', (p->>'customer_id')::uuid, p->>'type',
              (p->>'amount')::numeric, v_balance + (p->>'amount')::numeric,
              p->>'payment_method', v_session, p->>'note', (p->>'moved_at')::timestamptz,
              p->>'created_by', v_uid);
    end if;

  elsif p_kind = 'upsert_pedido' then
    insert into pedidos (id, creado_en, creado_por, user_id, canal_id, cliente_nombre, telefono,
                         tipo, direccion, para_cuando, estado, cantidades, lineas, total, nota,
                         sale_id, pagado, cambiado_en)
    values ((p->>'id')::uuid, (p->>'creado_en')::timestamptz, p->>'creado_por', v_uid,
            nullif(p->>'canal_id','')::uuid, p->>'cliente_nombre', nullif(p->>'telefono',''),
            p->>'tipo', nullif(p->>'direccion',''), nullif(p->>'para_cuando','')::timestamptz,
            p->>'estado', coalesce(p->'cantidades','{}'::jsonb), coalesce(p->'lineas','[]'::jsonb),
            coalesce(nullif(p->>'total','')::numeric, 0), nullif(p->>'nota',''),
            (select id from sales where local_uuid = nullif(p->>'sale_id','')),
            coalesce((p->>'pagado')::boolean, false), (p->>'cambiado_en')::timestamptz)
    -- Dos equipos tocando el mismo pedido: en los datos y el estado gana el
    -- cambio más nuevo. Pero el COBRO nunca se pierde: si un equipo lo cobró
    -- sin señal y otro lo movió después, sigue pagado y con su venta.
    on conflict (id) do update set
      canal_id = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.canal_id else pedidos.canal_id end,
      cliente_nombre = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.cliente_nombre else pedidos.cliente_nombre end,
      telefono = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.telefono else pedidos.telefono end,
      tipo = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.tipo else pedidos.tipo end,
      direccion = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.direccion else pedidos.direccion end,
      para_cuando = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.para_cuando else pedidos.para_cuando end,
      estado = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.estado else pedidos.estado end,
      cantidades = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.cantidades else pedidos.cantidades end,
      lineas = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.lineas else pedidos.lineas end,
      total = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.total else pedidos.total end,
      nota = case when pedidos.cambiado_en <= excluded.cambiado_en then excluded.nota else pedidos.nota end,
      sale_id = coalesce(pedidos.sale_id, excluded.sale_id),
      pagado = pedidos.pagado or excluded.pagado,
      cambiado_en = greatest(pedidos.cambiado_en, excluded.cambiado_en);

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
    -- Nunca se borra: otro equipo pudo venderlo sin señal y su venta, al
    -- llegar, apuntaría a un producto que no existe. Se archiva.
    update products set is_active = false, archivado = true, updated_at = now(), updated_by = v_uid
    where id = (p->>'id')::uuid;
    delete from promos where (product_id = (p->>'id')::uuid or bebida_product_id = (p->>'id')::uuid)
      and not exists (select 1 from sale_promos sp where sp.promo_id = promos.id);
    update promos set activo = false
    where product_id = (p->>'id')::uuid or bebida_product_id = (p->>'id')::uuid;
    return jsonb_build_object('ok', true, 'desactivado', true);

  elsif p_kind = 'upsert_canal' then
    insert into canales (id, nombre, recargo_pct, es_default, activo, sort_order, ubicacion_id)
    values ((p->>'id')::uuid, p->>'nombre', coalesce(nullif(p->>'recargo_pct','')::numeric,0),
            coalesce((p->>'es_default')::boolean,false),
            coalesce((p->>'activo')::boolean,true), coalesce((p->>'sort_order')::int,0),
            coalesce(nullif(p->>'ubicacion_id','')::uuid, ubicacion_por_defecto()))
    on conflict (id) do update set nombre = excluded.nombre,
      recargo_pct = excluded.recargo_pct, activo = excluded.activo,
      sort_order = excluded.sort_order,
      ubicacion_id = coalesce(nullif(p->>'ubicacion_id','')::uuid, canales.ubicacion_id);

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
    select exists(select 1 from sale_promos where promo_id = (p->>'id')::uuid) into v_exists;
    if v_exists then
      update promos set activo = false, updated_at = now(), updated_by = v_uid
      where id = (p->>'id')::uuid;
    else
      delete from promos where id = (p->>'id')::uuid;
    end if;
    return jsonb_build_object('ok', true, 'desactivado', v_exists);

  else
    raise exception 'sync_op: tipo de operación desconocido: %', p_kind;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function sync_op(text, jsonb) from public, anon, authenticated;
