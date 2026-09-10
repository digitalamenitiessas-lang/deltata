-- Del Tata — Esquema v1 (ventas, caja, stock, gastos, cuentas corrientes)
-- Basado en EMPANADAS-base-tecnica.md §3. qty SIEMPRE en unidades.

create extension if not exists pgcrypto;

-- ── CATÁLOGO ────────────────────────────────────────────────────────────────
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('empanada','bebida','otro')),
  unit_price numeric not null default 0,
  dozen_price numeric,
  cost_per_unit numeric,          -- null = costo no cargado (distinto de 0)
  current_qty numeric not null default 0,
  min_qty numeric,                -- null = sin mínimo definido (distinto de 0)
  shelf_life_days int,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── CLIENTES / CUENTAS CORRIENTES ───────────────────────────────────────────
create table if not exists customers (
  id uuid primary key,
  name text not null,
  phone text,
  note text,
  credit_limit numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── CAJA ────────────────────────────────────────────────────────────────────
create table if not exists cash_sessions (
  id uuid primary key,
  local_uuid text unique not null,
  opened_at timestamptz not null,
  opened_by text not null default '',
  opening_float numeric not null default 0,
  closed_at timestamptz,
  closed_by text,
  counted_cash numeric,
  expected_cash numeric,
  difference numeric,
  note text,
  status text not null default 'abierta' check (status in ('abierta','cerrada')),
  synced_at timestamptz not null default now()
);

-- ── VENTAS ──────────────────────────────────────────────────────────────────
create table if not exists sales (
  id uuid primary key,
  local_uuid text unique not null,
  sold_at timestamptz not null,
  cash_session_id uuid references cash_sessions(id),
  payment_method text not null check (payment_method in ('efectivo','transferencia','qr','tarjeta','cuenta_corriente')),
  customer_id uuid references customers(id),
  subtotal numeric not null,
  discount numeric not null default 0,
  total numeric not null,
  cash_received numeric,
  sold_by text,
  note text,
  synced_at timestamptz not null default now()
);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  qty numeric not null,
  unit_price numeric not null,
  line_total numeric not null
);

-- ── GASTOS ──────────────────────────────────────────────────────────────────
create table if not exists expenses (
  id uuid primary key,
  local_uuid text unique not null,
  spent_at timestamptz not null,
  category text not null,
  description text not null,
  amount numeric not null,
  payment_method text not null,
  cash_session_id uuid references cash_sessions(id),
  product_id uuid references products(id),
  qty_purchased numeric,
  supplier text,
  receipt_url text,
  created_by text,
  synced_at timestamptz not null default now()
);

-- ── CUENTA CORRIENTE: MOVIMIENTOS ───────────────────────────────────────────
create table if not exists account_movements (
  id uuid primary key,
  seq bigint generated always as identity,
  local_uuid text unique not null,
  customer_id uuid not null references customers(id),
  type text not null check (type in ('venta','pago','ajuste')),
  amount numeric not null,                -- + suma deuda, − la baja
  balance_after numeric,
  sale_id uuid references sales(id),
  payment_method text,
  note text,
  moved_at timestamptz not null default now(),
  created_by text
);

-- ── STOCK ───────────────────────────────────────────────────────────────────
create table if not exists stock_movements (
  id uuid primary key,
  seq bigint generated always as identity,
  local_uuid text unique not null,
  product_id uuid not null references products(id),
  type text not null check (type in ('compra','venta','merma','ajuste','produccion','conteo')),
  qty numeric not null,                   -- + entra, − sale
  reason text,
  ref_id uuid,
  balance_after numeric,
  moved_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists stock_counts (
  id uuid primary key,
  local_uuid text unique not null,
  counted_at timestamptz not null,
  product_id uuid not null references products(id),
  system_qty numeric not null,
  counted_qty numeric not null,
  diff numeric not null,
  note text,
  counted_by text
);

create table if not exists stock_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  qty_initial numeric,
  qty_remaining numeric,
  produced_at date,
  expires_at date,
  lot_code text,
  status text not null default 'active' check (status in ('active','depleted','expired','discarded'))
);

-- ── ANOMALÍAS ───────────────────────────────────────────────────────────────
create table if not exists anomalies (
  id uuid primary key default gen_random_uuid(),
  detected_at timestamptz not null default now(),
  day date not null,
  kind text not null,
  severity text not null check (severity in ('alta','media','baja')),
  product_id uuid references products(id),
  cash_session_id uuid references cash_sessions(id),
  expected numeric,
  actual numeric,
  diff numeric,
  diff_pct numeric,
  explanation text,
  status text not null default 'abierta' check (status in ('abierta','explicada','ignorada','resuelta'))
);

-- ── ÍNDICES ─────────────────────────────────────────────────────────────────
create index if not exists idx_sales_sold_at on sales(sold_at);
create index if not exists idx_sales_session on sales(cash_session_id);
create index if not exists idx_sale_items_sale on sale_items(sale_id);
create index if not exists idx_sale_items_product on sale_items(product_id);
create index if not exists idx_stock_mov_product on stock_movements(product_id, moved_at);
create index if not exists idx_acc_mov_customer on account_movements(customer_id, seq);
create index if not exists idx_expenses_session on expenses(cash_session_id);
create index if not exists idx_counts_product on stock_counts(product_id, counted_at);

-- ── TRIGGER: cada movimiento actualiza el stock y guarda el saldo ──────────
create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
declare v_qty numeric;
begin
  update products set current_qty = current_qty + new.qty, updated_at = now()
  where id = new.product_id
  returning current_qty into v_qty;
  new.balance_after := v_qty;
  return new;
end $$;

drop trigger if exists trg_stock_movement on stock_movements;
create trigger trg_stock_movement before insert on stock_movements
for each row execute function apply_stock_movement();

-- ── RLS: habilitada sin políticas → acceso solo vía service_role (API server)
alter table products enable row level security;
alter table customers enable row level security;
alter table cash_sessions enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table expenses enable row level security;
alter table account_movements enable row level security;
alter table stock_movements enable row level security;
alter table stock_counts enable row level security;
alter table stock_lots enable row level security;
alter table anomalies enable row level security;

-- ── SYNC: función idempotente que procesa operaciones del outbox ────────────
-- El cliente genera UUIDs; reintentar jamás duplica (unique local_uuid).
create or replace function sync_op(p_kind text, p jsonb) returns jsonb
language plpgsql as $$
declare
  v_session uuid;
  v_item jsonb;
  v_balance numeric;
  v_exists boolean;
  v_current numeric;
  v_qty numeric;
begin
  if p_kind = 'open_cash' then
    insert into cash_sessions (id, local_uuid, opened_at, opened_by, opening_float, note, status)
    values ((p->>'id')::uuid, p->>'id', (p->>'opened_at')::timestamptz,
            coalesce(p->>'opened_by',''), coalesce((p->>'opening_float')::numeric,0), p->>'note', 'abierta')
    on conflict (local_uuid) do nothing;

  elsif p_kind = 'close_cash' then
    update cash_sessions set
      closed_at = (p->>'closed_at')::timestamptz,
      closed_by = p->>'closed_by',
      counted_cash = (p->>'counted_cash')::numeric,
      expected_cash = (p->>'expected_cash')::numeric,
      difference = (p->>'difference')::numeric,
      note = coalesce(p->>'note', note),
      status = 'cerrada'
    where local_uuid = p->>'id' and status = 'abierta';

  elsif p_kind = 'sale' then
    select exists(select 1 from sales where local_uuid = p->>'id') into v_exists;
    if not v_exists then
      select id into v_session from cash_sessions where local_uuid = p->>'cash_session_id';
      insert into sales (id, local_uuid, sold_at, cash_session_id, payment_method, customer_id,
                         subtotal, discount, total, cash_received, sold_by, note)
      values ((p->>'id')::uuid, p->>'id', (p->>'sold_at')::timestamptz, v_session, p->>'payment_method',
              nullif(p->>'customer_id','')::uuid, (p->>'subtotal')::numeric,
              coalesce((p->>'discount')::numeric,0), (p->>'total')::numeric,
              nullif(p->>'cash_received','')::numeric, p->>'sold_by', p->>'note');
      for v_item in select * from jsonb_array_elements(p->'items') loop
        insert into sale_items (sale_id, product_id, qty, unit_price, line_total)
        values ((p->>'id')::uuid, (v_item->>'product_id')::uuid, (v_item->>'qty')::numeric,
                (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric);
        insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at, created_by)
        values (gen_random_uuid(), (p->>'id') || ':' || (v_item->>'product_id'),
                (v_item->>'product_id')::uuid, 'venta', -((v_item->>'qty')::numeric),
                'Venta', (p->>'id')::uuid, (p->>'sold_at')::timestamptz, p->>'sold_by')
        on conflict (local_uuid) do nothing;
      end loop;
      if p->>'payment_method' = 'cuenta_corriente' and nullif(p->>'customer_id','') is not null then
        select coalesce((select balance_after from account_movements
                         where customer_id = (p->>'customer_id')::uuid
                         order by seq desc limit 1), 0) into v_balance;
        insert into account_movements (id, local_uuid, customer_id, type, amount, balance_after, sale_id, moved_at, created_by)
        values (gen_random_uuid(), 'cc:' || (p->>'id'), (p->>'customer_id')::uuid, 'venta',
                (p->>'total')::numeric, v_balance + (p->>'total')::numeric,
                (p->>'id')::uuid, (p->>'sold_at')::timestamptz, p->>'sold_by')
        on conflict (local_uuid) do nothing;
      end if;
    end if;

  elsif p_kind = 'expense' then
    select id into v_session from cash_sessions where local_uuid = nullif(p->>'cash_session_id','');
    insert into expenses (id, local_uuid, spent_at, category, description, amount, payment_method,
                          cash_session_id, product_id, qty_purchased, supplier, created_by)
    values ((p->>'id')::uuid, p->>'id', (p->>'spent_at')::timestamptz, p->>'category', p->>'description',
            (p->>'amount')::numeric, p->>'payment_method', v_session,
            nullif(p->>'product_id','')::uuid, nullif(p->>'qty_purchased','')::numeric,
            p->>'supplier', p->>'created_by')
    on conflict (local_uuid) do nothing;
    -- compra de mercadería: entra stock y opcionalmente actualiza costo (confirmado por el usuario)
    if nullif(p->>'product_id','') is not null and coalesce((p->>'qty_purchased')::numeric, 0) > 0 then
      insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at, created_by)
      values (gen_random_uuid(), 'exp:' || (p->>'id'), (p->>'product_id')::uuid, 'compra',
              (p->>'qty_purchased')::numeric, coalesce(p->>'description','Compra'),
              (p->>'id')::uuid, (p->>'spent_at')::timestamptz, p->>'created_by')
      on conflict (local_uuid) do nothing;
      if nullif(p->>'new_cost','') is not null then
        update products set cost_per_unit = (p->>'new_cost')::numeric, updated_at = now()
        where id = (p->>'product_id')::uuid;
      end if;
    end if;

  elsif p_kind = 'stock_count' then
    select exists(select 1 from stock_counts where local_uuid = p->>'id') into v_exists;
    if not v_exists then
      insert into stock_counts (id, local_uuid, counted_at, product_id, system_qty, counted_qty, diff, note, counted_by)
      values ((p->>'id')::uuid, p->>'id', (p->>'counted_at')::timestamptz, (p->>'product_id')::uuid,
              (p->>'system_qty')::numeric, (p->>'counted_qty')::numeric, (p->>'diff')::numeric,
              p->>'note', p->>'counted_by');
      -- el movimiento ajusta el stock del servidor al valor contado (diff contra el saldo del servidor)
      select current_qty into v_current from products where id = (p->>'product_id')::uuid;
      v_qty := (p->>'counted_qty')::numeric - coalesce(v_current, 0);
      insert into stock_movements (id, local_uuid, product_id, type, qty, reason, ref_id, moved_at, created_by)
      values (gen_random_uuid(), 'count:' || (p->>'id'), (p->>'product_id')::uuid, 'conteo',
              v_qty, 'Conteo físico', (p->>'id')::uuid, (p->>'counted_at')::timestamptz, p->>'counted_by')
      on conflict (local_uuid) do nothing;
    end if;

  elsif p_kind = 'stock_move' then
    -- merma / ajuste / compra directa / produccion
    insert into stock_movements (id, local_uuid, product_id, type, qty, reason, moved_at, created_by)
    values ((p->>'id')::uuid, p->>'id', (p->>'product_id')::uuid, p->>'type',
            (p->>'qty')::numeric, p->>'reason', (p->>'moved_at')::timestamptz, p->>'created_by')
    on conflict (local_uuid) do nothing;

  elsif p_kind = 'upsert_customer' then
    insert into customers (id, name, phone, note, credit_limit, is_active)
    values ((p->>'id')::uuid, p->>'name', p->>'phone', p->>'note',
            nullif(p->>'credit_limit','')::numeric, coalesce((p->>'is_active')::boolean, true))
    on conflict (id) do update set
      name = excluded.name, phone = excluded.phone, note = excluded.note,
      credit_limit = excluded.credit_limit, is_active = excluded.is_active;

  elsif p_kind = 'customer_payment' then
    select exists(select 1 from account_movements where local_uuid = p->>'id') into v_exists;
    if not v_exists then
      select coalesce((select balance_after from account_movements
                       where customer_id = (p->>'customer_id')::uuid
                       order by seq desc limit 1), 0) into v_balance;
      insert into account_movements (id, local_uuid, customer_id, type, amount, balance_after, payment_method, note, moved_at, created_by)
      values ((p->>'id')::uuid, p->>'id', (p->>'customer_id')::uuid, p->>'type',
              (p->>'amount')::numeric, v_balance + (p->>'amount')::numeric,
              p->>'payment_method', p->>'note', (p->>'moved_at')::timestamptz, p->>'created_by');
    end if;

  elsif p_kind = 'upsert_product' then
    insert into products (id, name, kind, unit_price, dozen_price, cost_per_unit, min_qty, sort_order, is_active)
    values ((p->>'id')::uuid, p->>'name', p->>'kind', (p->>'unit_price')::numeric,
            nullif(p->>'dozen_price','')::numeric, nullif(p->>'cost_per_unit','')::numeric,
            nullif(p->>'min_qty','')::numeric, coalesce((p->>'sort_order')::int, 0),
            coalesce((p->>'is_active')::boolean, true))
    on conflict (id) do update set
      name = excluded.name, kind = excluded.kind, unit_price = excluded.unit_price,
      dozen_price = excluded.dozen_price, cost_per_unit = excluded.cost_per_unit,
      min_qty = excluded.min_qty, sort_order = excluded.sort_order,
      is_active = excluded.is_active, updated_at = now();

  else
    raise exception 'sync_op: tipo de operación desconocido: %', p_kind;
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- Defensa en profundidad: sync_op solo ejecutable por service_role (el server)
revoke execute on function sync_op(text, jsonb) from public, anon, authenticated;
