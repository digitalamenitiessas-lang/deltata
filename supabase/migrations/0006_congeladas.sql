-- Del Tata — Venta de empanadas congeladas por docena (2026-08-04)
--
-- Son las MISMAS empanadas: se hacen, se congelan, y algunas se cocinan para
-- vender calientes y otras se venden congeladas por docena. Por eso comparten
-- el mismo stock y no se duplica el catálogo: cambia el precio y la
-- presentación, no el producto.

alter table products
  add column if not exists frozen_dozen_price numeric;

comment on column products.frozen_dozen_price is
  'Precio de la docena congelada. NULL = ese gusto no se vende congelado.';

-- Cada línea de venta sabe cómo se llevó el producto
alter table sale_items
  add column if not exists presentacion text not null default 'cocida'
  check (presentacion in ('cocida', 'congelada'));

comment on column sale_items.presentacion is
  'cocida = suelta del horno; congelada = por docena. La cantidad va en unidades igual.';

create index if not exists idx_sale_items_presentacion
  on sale_items(presentacion);
