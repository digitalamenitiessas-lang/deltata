-- Del Tata — Seed del catálogo. UUIDs fijos compartidos con el seed local (Dexie).
-- ATENCIÓN: precios de referencia, ajustar en Configuración. Costos y mínimos
-- quedan NULL a propósito: "no cargado" es distinto de 0.

insert into products (id, name, kind, unit_price, dozen_price, sort_order) values
  ('de17a7a0-0000-4000-8000-000000000001', 'Carne suave',     'empanada', 2500, 27000, 1),
  ('de17a7a0-0000-4000-8000-000000000002', 'Carne picante',   'empanada', 2500, 27000, 2),
  ('de17a7a0-0000-4000-8000-000000000003', 'Capresse',        'empanada', 2500, 27000, 3),
  ('de17a7a0-0000-4000-8000-000000000004', 'Ternera y queso', 'empanada', 2500, 27000, 4),
  ('de17a7a0-0000-4000-8000-000000000005', 'Cebolla y queso', 'empanada', 2500, 27000, 5),
  ('de17a7a0-0000-4000-8000-000000000006', 'Jamón y queso',   'empanada', 2500, 27000, 6),
  ('de17a7a0-0000-4000-8000-000000000007', 'Sfijas',          'empanada', 2500, 27000, 7),
  ('de17a7a0-0000-4000-8000-000000000008', 'Pollo',           'empanada', 2500, 27000, 8),
  ('de17a7a0-0000-4000-8000-000000000009', 'Verdura',         'empanada', 2500, 27000, 9),
  ('de17a7a0-0000-4000-8000-000000000010', 'Atún',            'empanada', 2500, 27000, 10),
  ('de17a7a0-0000-4000-8000-000000000011', 'Humita',          'empanada', 2500, 27000, 11),
  ('de17a7a0-0000-4000-8000-000000000012', 'Mondongo',        'empanada', 2500, 27000, 12),
  ('de17a7a0-0000-4000-8000-000000000021', 'Gaseosa 500 ml',  'bebida',   2500, null,  21),
  ('de17a7a0-0000-4000-8000-000000000022', 'Agua 500 ml',     'bebida',   2000, null,  22)
on conflict (id) do nothing;
