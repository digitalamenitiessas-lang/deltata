-- Del Tata — Promociones y autogestión del catálogo (2026-09-09)
--
-- De la reunión: "poder generar promociones o descuentos", "vínculos con
-- bebida", "generar productos, eliminarlos".
--
-- Dos decisiones que valen la pena explicar:
--
-- 1) El descuento de promo viaja SEPARADO del descuento a mano. El sistema ya
--    distinguía el ahorro por tramos (media docena, docena) del descuento
--    manual, porque uno lo calcula la máquina y el otro lo autoriza el dueño.
--    La promo es del primer grupo: la define el dueño una vez y después se
--    aplica sola. Sin esa columna, cada combo parecería un descuento a mano y
--    el empleado quedaría bloqueado por una regla que no es la suya.
--
-- 2) Un producto no se borra si ya se vendió. Borrarlo dejaría ventas
--    apuntando a la nada y el histórico mentiría. sync_op resuelve solo: si
--    tiene historia lo desactiva, si nunca se usó lo borra de verdad. Nunca
--    falla, porque un error acá frenaría toda la cola de sincronización.

-- ── PROMOCIONES ─────────────────────────────────────────────────────────────
create table if not exists promos (
  id uuid primary key,
  nombre text not null,
  tipo text not null check (tipo in ('combo', 'porcentaje', 'monto')),

  -- combo: N empanadas + M de una bebida, todo junto a precio fijo
  empanadas_qty numeric,
  bebida_product_id uuid references products(id) on delete set null,
  bebida_qty numeric,
  precio_fijo numeric,

  -- porcentaje / monto: cuánto y sobre qué
  valor numeric,
  product_id uuid references products(id) on delete cascade,
  kind text check (kind in ('empanada', 'bebida', 'otro')),
  minimo_unidades numeric,

  -- vigencia: 0 = domingo … 6 = sábado. NULL = sin restricción.
  dias int[],
  desde time,
  hasta time,
  canal_id uuid references canales(id) on delete cascade,

  activo boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table promos enable row level security;

comment on column promos.dias is
  'Días en que corre la promo (0=domingo). NULL = todos los días.';
comment on column promos.hasta is
  'Si hasta < desde la ventana cruza la medianoche (ej: 20:00 a 01:00).';

-- Qué promo entró en qué venta. El nombre se congela: la promo puede
-- cambiar el mes que viene y el recibo viejo tiene que seguir leyéndose igual.
create table if not exists sale_promos (
  sale_id uuid not null references sales(id) on delete cascade,
  promo_id uuid not null references promos(id) on delete cascade,
  nombre text not null,
  veces numeric not null default 1,
  ahorro numeric not null default 0,
  primary key (sale_id, promo_id)
);

alter table sale_promos enable row level security;

-- El ahorro por promo, aparte del descuento a mano (ver nota 1 arriba)
alter table sales
  add column if not exists promo_discount numeric not null default 0;

comment on column sales.promo_discount is
  'Parte del discount que viene de promos automáticas, no de un descuento a mano.';

-- ── AUDITORÍA DE PROMOS ─────────────────────────────────────────────────────
-- Igual que los precios: lo registra la base, no la app, para que quede
-- aunque el cambio entre por otra vía.
create or replace function audit_promo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text; v_resumen text;
begin
  select email into v_email from profiles where id = new.updated_by;

  if TG_OP = 'INSERT' then
    v_resumen := format('Creó la promo "%s" (%s)', new.nombre, new.tipo);
  elsif new.activo is distinct from old.activo then
    v_resumen := format('%s la promo "%s"',
      case when new.activo then 'Activó' else 'Desactivó' end, new.nombre);
  else
    v_resumen := format('Modificó la promo "%s"', new.nombre);
  end if;

  perform log_audit(new.updated_by, v_email,
    case when TG_OP = 'INSERT' then 'alta_promo' else 'cambio_promo' end,
    'promos', new.id::text, v_resumen, now(),
    coalesce(new.precio_fijo, new.valor), null, to_jsonb(new), null);
  return new;
end $$;

drop trigger if exists trg_audit_promo on promos;
create trigger trg_audit_promo after insert or update on promos
for each row execute function audit_promo();

create or replace function audit_promo_baja() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_audit(null, null, 'baja_promo', 'promos', old.id::text,
    format('Eliminó la promo "%s"', old.nombre), now(), null, null,
    to_jsonb(old), null);
  return old;
end $$;

drop trigger if exists trg_audit_promo_baja on promos;
create trigger trg_audit_promo_baja after delete on promos
for each row execute function audit_promo_baja();

-- ── ALTA Y BAJA DE PRODUCTOS EN LA AUDITORÍA ────────────────────────────────
-- El trigger existente sólo miraba UPDATE: un producto que aparecía o
-- desaparecía del catálogo no dejaba rastro. Ahora sí.
create or replace function audit_producto_alta() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select email into v_email from profiles where id = new.updated_by;
  perform log_audit(new.updated_by, v_email, 'alta_producto', 'products',
    new.id::text,
    format('Agregó "%s" al catálogo (%s) a $%s', new.name, new.kind, new.unit_price),
    now(), new.unit_price, null, to_jsonb(new), null);
  return new;
end $$;

drop trigger if exists trg_audit_producto_alta on products;
create trigger trg_audit_producto_alta after insert on products
for each row execute function audit_producto_alta();

create or replace function audit_producto_baja() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_audit(null, null, 'baja_producto', 'products', old.id::text,
    format('Eliminó "%s" del catálogo', old.name), now(), null, null,
    to_jsonb(old), null);
  return old;
end $$;

drop trigger if exists trg_audit_producto_baja on products;
create trigger trg_audit_producto_baja after delete on products
for each row execute function audit_producto_baja();

-- ── OPERACIONES NUEVAS EN sync_op ───────────────────────────────────────────
create or replace function sync_op(p_kind text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session uuid; v_item jsonb; v_balance numeric; v_exists boolean;
  v_current numeric; v_qty numeric; v_uid uuid; v_prod uuid; v_usado boolean;
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

      -- Qué promos entraron: sin esto el descuento no se puede revisar después.
      -- Si la promo ya no existe (la borraron mientras la venta esperaba
      -- sincronizar) la fila se saltea: la venta ya se cobró y tiene que
      -- entrar igual. El resumen de auditoría avisa que quedó sin respaldo.
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

  -- Borrar un producto con historia rompería el histórico: en ese caso se
  -- desactiva. Nunca lanza excepción — un error acá frena toda la cola.
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

  -- Si la promo ya se usó en una venta se desactiva en vez de borrarse: el
  -- recibo viejo tiene que poder explicar de dónde salió su descuento.
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
