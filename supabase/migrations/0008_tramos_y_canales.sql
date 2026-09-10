-- Del Tata — Precios por tramo y canales de venta (2026-08-04)
--
-- 1) La media docena existía en el mostrador pero no en el sistema: se cobraba
--    unidad hasta la 12ª. Ahora hay tres tramos: unidad, media docena y docena.
-- 2) PedidosYa cobra distinto que el foodtruck. Cada canal puede tener su
--    recargo o su propia lista de precios, y cada venta guarda por dónde entró.

-- ── TRAMO DE MEDIA DOCENA ───────────────────────────────────────────────────
alter table products
  add column if not exists half_dozen_price numeric;

comment on column products.half_dozen_price is
  'Precio de la media docena (6). NULL = no hay tramo de media docena.';

-- Precios reales del pizarrón (los del seed eran de referencia)
update products
set unit_price = 2500, half_dozen_price = 12000, dozen_price = 24000
where kind = 'empanada';

-- ── CANALES DE VENTA ────────────────────────────────────────────────────────
create table if not exists canales (
  id uuid primary key,
  nombre text not null,
  /** recargo sobre el precio base; 0 = mismo precio que el foodtruck */
  recargo_pct numeric not null default 0,
  /** el canal por defecto del punto de venta */
  es_default boolean not null default false,
  activo boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table canales enable row level security;

-- Precios propios por canal. Cada campo NULL = usar el precio base con recargo.
create table if not exists canal_precios (
  canal_id uuid not null references canales(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  unit_price numeric,
  half_dozen_price numeric,
  dozen_price numeric,
  frozen_dozen_price numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (canal_id, product_id)
);

alter table canal_precios enable row level security;

-- Cada venta recuerda por dónde entró: sin esto no se puede comparar después
alter table sales
  add column if not exists canal_id uuid references canales(id);

create index if not exists idx_sales_canal on sales(canal_id, sold_at);

-- ── CANALES INICIALES ───────────────────────────────────────────────────────
-- El recargo de PedidosYa queda en 0 a propósito: lo define el dueño, el
-- sistema no inventa un número que después se cobra de verdad.
insert into canales (id, nombre, recargo_pct, es_default, sort_order) values
  ('ca17a7a0-0000-4000-8000-000000000001', 'Foodtruck',  0, true,  1),
  ('ca17a7a0-0000-4000-8000-000000000002', 'PedidosYa',  0, false, 2)
on conflict (id) do nothing;

-- ── AUDITORÍA DE PRECIOS POR CANAL ──────────────────────────────────────────
create or replace function audit_canal_precio() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text; v_canal text; v_prod text;
begin
  select email into v_email from profiles where id = new.updated_by;
  select nombre into v_canal from canales where id = new.canal_id;
  select name into v_prod from products where id = new.product_id;

  perform log_audit(new.updated_by, v_email, 'cambio_precio_canal', 'canal_precios',
    new.canal_id::text || ':' || new.product_id::text,
    format('%s en %s: unidad %s, media %s, docena %s',
           v_prod, v_canal,
           coalesce(new.unit_price::text, 'base'),
           coalesce(new.half_dozen_price::text, 'base'),
           coalesce(new.dozen_price::text, 'base')),
    now(), new.unit_price, null, to_jsonb(new), null);
  return new;
end $$;

drop trigger if exists trg_audit_canal_precio on canal_precios;
create trigger trg_audit_canal_precio after insert or update on canal_precios
for each row execute function audit_canal_precio();

create or replace function audit_canal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and new.recargo_pct is distinct from old.recargo_pct then
    perform log_audit(null, null, 'cambio_recargo_canal', 'canales', new.id::text,
      format('%s: recargo %s%% → %s%%', new.nombre, old.recargo_pct, new.recargo_pct),
      now(), new.recargo_pct, null, null, null);
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_canal on canales;
create trigger trg_audit_canal after update on canales
for each row execute function audit_canal();
