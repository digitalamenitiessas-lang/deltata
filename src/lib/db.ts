import Dexie, { type Table } from "dexie";
import type {
  Product,
  Sale,
  CashSession,
  Expense,
  StockMovement,
  StockCount,
  Customer,
  AccountMovement,
  OutboxOp,
  OpRechazada,
  Pedido,
  StockUbic,
  Ubicacion,
} from "@/types";

interface MetaRow {
  key: string;
  value: string;
}

// La venta se escribe PRIMERO acá (IndexedDB) y después se sincroniza.
// Nunca se bloquea una operación esperando al servidor.
class DelTataDB extends Dexie {
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  cash_sessions!: Table<CashSession, string>;
  expenses!: Table<Expense, string>;
  stock_movements!: Table<StockMovement, string>;
  stock_counts!: Table<StockCount, string>;
  customers!: Table<Customer, string>;
  canales!: Table<import("@/types").Canal, string>;
  canal_precios!: Table<import("@/types").CanalPrecio, [string, string]>;
  promos!: Table<import("@/types").Promo, string>;
  cliente_gustos!: Table<import("@/types").ClienteGusto, [string, string]>;
  empleados!: Table<import("@/types").Empleado, string>;
  account_movements!: Table<AccountMovement, string>;
  ubicaciones!: Table<Ubicacion, string>;
  stock_ubic!: Table<StockUbic, [string, string]>;
  pedidos!: Table<Pedido, string>;
  outbox!: Table<OutboxOp, number>;
  rechazadas!: Table<OpRechazada, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("del-tata");
    // Nota: IndexedDB no indexa booleanos — is_active se filtra en memoria.
    this.version(1).stores({
      products: "id, sort_order, kind",
      sales: "id, sold_at, cash_session_id, payment_method, customer_id",
      cash_sessions: "id, opened_at, status",
      expenses: "id, spent_at, cash_session_id, category",
      stock_movements: "id, product_id, moved_at, type, [product_id+moved_at]",
      stock_counts: "id, product_id, counted_at",
      customers: "id, name",
      account_movements: "id, customer_id, moved_at, [customer_id+moved_at]",
      outbox: "++id, entity_id, created_at",
      meta: "key",
    });
    // v2: pagos de cuenta corriente en efectivo se atan a la caja (arqueo)
    this.version(2).stores({
      account_movements:
        "id, customer_id, moved_at, cash_session_id, [customer_id+moved_at]",
    });
    // v3: canales de venta con su propia lista de precios
    this.version(3).stores({
      canales: "id, sort_order",
      canal_precios: "[canal_id+product_id], canal_id, product_id",
    });
    // v4: promociones (combos y descuentos) que se aplican solas
    this.version(4).stores({
      promos: "id, sort_order, tipo",
    });
    // v5: una caja por canal, qué suele llevar cada cliente, y quién trabaja acá
    this.version(5).stores({
      cash_sessions: "id, opened_at, status, canal_id, [canal_id+status]",
      cliente_gustos: "[customer_id+product_id], customer_id",
      empleados: "id, nombre",
    });
    // v6: el local físico. Stock por lugar, pedidos para llevar, y las
    // operaciones que el servidor rechazó salen de la cola en vez de trabarla.
    this.version(6).stores({
      ubicaciones: "id, sort_order",
      stock_ubic: "[product_id+ubicacion_id], product_id, ubicacion_id",
      pedidos: "id, estado, para_cuando, creado_en",
      rechazadas: "++id, entity_id, rechazada_en",
      stock_movements:
        "id, product_id, moved_at, type, ubicacion_id, [product_id+moved_at]",
      stock_counts: "id, product_id, counted_at, ubicacion_id",
    });
  }
}

export const db = new DelTataDB();

export async function getMeta(key: string): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
