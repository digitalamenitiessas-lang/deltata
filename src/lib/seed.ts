import { db, getMeta, setMeta } from "./db";
import type { Product } from "@/types";

// UUIDs fijos compartidos con supabase/migrations/0002_seed.sql.
// Si el primer arranque es offline, el catálogo local coincide igual con el servidor.
const P = (n: number) =>
  `de17a7a0-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

const EMPANADAS = [
  "Carne suave",
  "Carne picante",
  "Capresse",
  "Ternera y queso",
  "Cebolla y queso",
  "Jamón y queso",
  "Sfijas",
  "Pollo",
  "Verdura",
  "Atún",
  "Humita",
  "Mondongo",
];

function catalogSeed(): Product[] {
  const now = new Date().toISOString();
  const empanadas: Product[] = EMPANADAS.map((name, i) => ({
    id: P(i + 1),
    name,
    kind: "empanada",
    unit_price: 2500,
    half_dozen_price: 12000,
    dozen_price: 24000,
    frozen_dozen_price: null,
    cost_per_unit: null,
    current_qty: 0,
    min_qty: null,
    sort_order: i + 1,
    is_active: true,
    updated_at: now,
  }));
  const bebidas: Product[] = [
    {
      id: P(21),
      name: "Gaseosa 500 ml",
      kind: "bebida",
      unit_price: 2500,
      half_dozen_price: null,
      dozen_price: null,
      frozen_dozen_price: null,
      cost_per_unit: null,
      current_qty: 0,
      min_qty: null,
      sort_order: 21,
      is_active: true,
      updated_at: now,
    },
    {
      id: P(22),
      name: "Agua 500 ml",
      kind: "bebida",
      unit_price: 2000,
      half_dozen_price: null,
      dozen_price: null,
      frozen_dozen_price: null,
      cost_per_unit: null,
      current_qty: 0,
      min_qty: null,
      sort_order: 22,
      is_active: true,
      updated_at: now,
    },
  ];
  return [...empanadas, ...bebidas];
}

/** Siembra el catálogo local sólo la primera vez (luego manda el pull del servidor). */
export async function ensureSeeded(): Promise<void> {
  const seeded = await getMeta("seeded");
  if (seeded) return;
  const count = await db.products.count();
  if (count === 0) {
    await db.products.bulkAdd(catalogSeed());
  }
  // Canal por defecto: sin esto el POS no sabría con qué lista cobrar offline
  if ((await db.canales.count()) === 0) {
    await db.canales.bulkAdd([
      {
        id: "ca17a7a0-0000-4000-8000-000000000001",
        nombre: "Foodtruck",
        recargo_pct: 0,
        es_default: true,
        activo: true,
        sort_order: 1,
      },
      {
        id: "ca17a7a0-0000-4000-8000-000000000002",
        nombre: "PedidosYa",
        recargo_pct: 0,
        es_default: false,
        activo: true,
        sort_order: 2,
      },
    ]);
  }
  await setMeta("seeded", "1");
}
