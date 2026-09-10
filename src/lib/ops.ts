import { db } from "./db";
import { computeCart } from "./pricing";
import type {
  Canal,
  CanalPrecio,
  CashSession,
  Customer,
  Expense,
  OutboxOp,
  PaymentMethod,
  Product,
  Promo,
  Sale,
  StockMovementType,
  SyncOpKind,
} from "@/types";

// Única vía de mutación del dominio. Cada operación escribe las filas locales
// y encola la operación de sincronización EN LA MISMA transacción: o queda
// todo, o no queda nada. El servidor deduplica por UUID: reintentar no duplica.

const uuid = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} inválida.`);
}

/** Umbral de diferencia de caja que exige nota: 1% del esperado, mínimo $1.000 */
export function cashNoteThreshold(expected: number): number {
  return Math.max(1000, Math.round(Math.abs(expected) * 0.01));
}

function op(
  kind: SyncOpKind,
  entityId: string,
  payload: Record<string, unknown>
): OutboxOp {
  return {
    kind,
    entity_id: entityId,
    payload,
    created_at: nowISO(),
    tries: 0,
    last_error: null,
  };
}

/**
 * La caja abierta de un lugar. Cada canal lleva la suya: la casa y el foodtruck
 * no comparten cajón, y si compartieran arqueo el descuadre de uno taparía el
 * del otro.
 *
 * Sin canal devuelve cualquier caja abierta — sirve para las cajas viejas, de
 * cuando había una sola. Ante varias abiertas devuelve **la más reciente**, no
 * una al azar: con un criterio fijo, dos pantallas muestran lo mismo.
 */
export async function getOpenSession(
  canalId?: string | null
): Promise<CashSession | undefined> {
  const abiertas = await db.cash_sessions.where("status").equals("abierta").toArray();
  const propias =
    canalId == null
      ? abiertas
      : abiertas.filter((s) => s.canal_id === canalId || s.canal_id == null);
  return propias.sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0];
}

/** Todas las cajas abiertas, para mostrar una tarjeta por lugar. */
export async function getOpenSessions(): Promise<CashSession[]> {
  const abiertas = await db.cash_sessions.where("status").equals("abierta").toArray();
  return abiertas.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}

// ── CAJA ─────────────────────────────────────────────────────────────────────

export async function openCash(input: {
  opening_float: number;
  opened_by: string;
  canal_id: string | null;
  note?: string;
}): Promise<CashSession> {
  const existing = await getOpenSession(input.canal_id);
  if (existing) {
    const canal = input.canal_id ? await db.canales.get(input.canal_id) : null;
    throw new Error(
      canal
        ? `Ya hay una caja abierta en ${canal.nombre}. Cerrala antes de abrir otra.`
        : "Ya hay una caja abierta."
    );
  }
  const session: CashSession = {
    id: uuid(),
    canal_id: input.canal_id,
    opened_at: nowISO(),
    opened_by: input.opened_by,
    opening_float: input.opening_float,
    closed_at: null,
    closed_by: null,
    counted_cash: null,
    expected_cash: null,
    difference: null,
    note: input.note ?? null,
    status: "abierta",
  };
  await db.transaction("rw", db.cash_sessions, db.outbox, async () => {
    await db.cash_sessions.add(session);
    await db.outbox.add(
      op("open_cash", session.id, {
        id: session.id,
        canal_id: session.canal_id ?? "",
        opened_at: session.opened_at,
        opened_by: session.opened_by,
        opening_float: session.opening_float,
        note: session.note,
      })
    );
  });
  return session;
}

export interface CashSummary {
  session: CashSession;
  salesTotal: number;
  salesCount: number;
  byMethod: Record<PaymentMethod, number>;
  cashExpenses: number;
  /** cobros de cuenta corriente en efectivo durante el turno: entran al cajón */
  cashCustomerPayments: number;
  expectedCash: number;
  averageTicket: number;
}

export async function summarizeSession(session: CashSession): Promise<CashSummary> {
  const sales = await db.sales
    .where("cash_session_id")
    .equals(session.id)
    .toArray();
  const expenses = await db.expenses
    .where("cash_session_id")
    .equals(session.id)
    .toArray();
  const accountPayments = await db.account_movements
    .where("cash_session_id")
    .equals(session.id)
    .toArray();

  const byMethod: Record<PaymentMethod, number> = {
    efectivo: 0,
    transferencia: 0,
    qr: 0,
    tarjeta: 0,
    cuenta_corriente: 0,
  };
  for (const sale of sales) byMethod[sale.payment_method] += sale.total;

  const cashExpenses = expenses
    .filter((e) => e.payment_method === "efectivo")
    .reduce((acc, e) => acc + e.amount, 0);

  const cashCustomerPayments = accountPayments
    .filter((m) => m.payment_method === "efectivo")
    .reduce((acc, m) => acc + Math.abs(m.amount), 0);

  const salesTotal = sales.reduce((acc, s) => acc + s.total, 0);
  const expectedCash =
    session.opening_float +
    byMethod.efectivo +
    cashCustomerPayments -
    cashExpenses;

  return {
    session,
    salesTotal,
    salesCount: sales.length,
    byMethod,
    cashExpenses,
    cashCustomerPayments,
    expectedCash,
    averageTicket: sales.length > 0 ? salesTotal / sales.length : 0,
  };
}

export async function closeCash(input: {
  counted_cash: number;
  closed_by: string;
  /** qué caja se cierra; sin esto, con varias abiertas se cerraría la que no es */
  session_id?: string;
  note?: string;
  /** efectivo esperado que la UI mostró: si cambió (venta/gasto en el medio), se aborta */
  expected_snapshot?: number;
}): Promise<CashSession> {
  const session = input.session_id
    ? await db.cash_sessions.get(input.session_id)
    : await getOpenSession();
  if (!session || session.status !== "abierta") {
    throw new Error("No hay caja abierta.");
  }
  assertFinite(input.counted_cash, "Cifra contada");
  const summary = await summarizeSession(session);
  if (
    input.expected_snapshot != null &&
    summary.expectedCash !== input.expected_snapshot
  ) {
    throw new Error(
      "El efectivo esperado cambió desde el conteo: hubo movimientos nuevos. Revisá el resumen actualizado."
    );
  }
  const difference = input.counted_cash - summary.expectedCash;
  if (
    Math.abs(difference) >= cashNoteThreshold(summary.expectedCash) &&
    !input.note?.trim()
  ) {
    throw new Error(
      "La diferencia supera el umbral: agregá una nota explicando qué pasó."
    );
  }
  const closed: CashSession = {
    ...session,
    closed_at: nowISO(),
    closed_by: input.closed_by,
    counted_cash: input.counted_cash,
    expected_cash: summary.expectedCash,
    difference,
    note: input.note ?? session.note,
    status: "cerrada",
  };
  await db.transaction("rw", db.cash_sessions, db.outbox, async () => {
    await db.cash_sessions.put(closed);
    await db.outbox.add(
      op("close_cash", session.id, {
        id: session.id,
        closed_at: closed.closed_at,
        closed_by: closed.closed_by,
        counted_cash: closed.counted_cash,
        expected_cash: closed.expected_cash,
        difference: closed.difference,
        note: input.note ?? null,
      })
    );
  });
  return closed;
}

// ── VENTA ────────────────────────────────────────────────────────────────────

export async function recordSale(input: {
  quantities: Record<string, number>;
  payment_method: PaymentMethod;
  customer_id?: string;
  manualDiscount?: number;
  cash_received?: number;
  sold_by: string;
  note?: string;
  canal_id?: string | null;
}): Promise<Sale> {
  // Mismo conjunto que muestra el POS: solo productos activos.
  const products = (await db.products.toArray()).filter((p) => p.is_active);
  // El precio se recalcula con el canal de la venta: el cliente no decide
  // cuánto sale, sólo qué canal.
  const canal = input.canal_id
    ? ((await db.canales.get(input.canal_id)) ?? null)
    : ((await db.canales.toArray()).find((c) => c.es_default) ?? null);

  // La venta entra en la caja de SU lugar. Si el foodtruck vende con la caja
  // de la casa abierta, el arqueo de la casa cerraría con plata que no está.
  const session = await getOpenSession(canal?.id ?? null);
  if (!session) {
    throw new Error(
      canal ? `No hay caja abierta en ${canal.nombre}.` : "No hay caja abierta."
    );
  }
  const precios = canal
    ? await db.canal_precios.where("canal_id").equals(canal.id).toArray()
    : [];
  // Las promos se recalculan acá, no se toman de la pantalla: si una venció
  // entre que se armó el pedido y se cobró, el precio tiene que reflejarlo.
  const promos = await db.promos.toArray();
  const cart = computeCart(
    products,
    input.quantities,
    input.manualDiscount ?? 0,
    canal,
    precios,
    promos
  );
  if (cart.lines.length === 0) throw new Error("El pedido está vacío.");
  if (input.payment_method === "cuenta_corriente" && !input.customer_id) {
    throw new Error("La venta a cuenta corriente necesita un cliente.");
  }

  const sale: Sale = {
    id: uuid(),
    sold_at: nowISO(),
    cash_session_id: session.id,
    canal_id: canal?.id ?? null,
    payment_method: input.payment_method,
    customer_id: input.customer_id ?? null,
    subtotal: cart.sinTramos,
    discount: cart.ahorroTramos + cart.ahorroPromos + cart.manualDiscount,
    promo_discount: cart.ahorroPromos,
    promos: cart.promos,
    total: cart.total,
    cash_received: input.cash_received ?? null,
    sold_by: input.sold_by,
    note: input.note ?? null,
    items: cart.lines.map(
      ({ kind: _k, desglose: _de, sugerencia: _su, ...item }) => item
    ),
  };

  await db.transaction(
    "rw",
    [db.sales, db.products, db.stock_movements, db.account_movements, db.outbox],
    async () => {
      await db.sales.add(sale);

      // Cocidas y congeladas salen del mismo pozo: se agrupan por producto
      // para no generar dos movimientos del mismo gusto en una misma venta.
      const porProducto = new Map<string, number>();
      for (const item of sale.items) {
        porProducto.set(
          item.product_id,
          (porProducto.get(item.product_id) ?? 0) + item.qty
        );
      }

      for (const [productId, unidades] of porProducto) {
        const product = await db.products.get(productId);
        if (!product) continue;
        const balance = product.current_qty - unidades;
        await db.products.update(productId, {
          current_qty: balance,
          updated_at: sale.sold_at,
        });
        await db.stock_movements.add({
          id: uuid(),
          product_id: productId,
          type: "venta",
          qty: -unidades,
          reason: "Venta",
          ref_id: sale.id,
          balance_after: balance,
          moved_at: sale.sold_at,
          created_by: input.sold_by,
        });
      }

      if (sale.payment_method === "cuenta_corriente" && sale.customer_id) {
        const last = await db.account_movements
          .where("customer_id")
          .equals(sale.customer_id)
          .sortBy("moved_at");
        const balance = (last.at(-1)?.balance_after ?? 0) + sale.total;
        await db.account_movements.add({
          id: uuid(),
          customer_id: sale.customer_id,
          type: "venta",
          amount: sale.total,
          balance_after: balance,
          sale_id: sale.id,
          payment_method: null,
          cash_session_id: null,
          note: null,
          moved_at: sale.sold_at,
          created_by: input.sold_by,
        });
      }

      await db.outbox.add(
        op("sale", sale.id, {
          id: sale.id,
          sold_at: sale.sold_at,
          cash_session_id: sale.cash_session_id,
          canal_id: sale.canal_id ?? "",
          payment_method: sale.payment_method,
          customer_id: sale.customer_id ?? "",
          subtotal: sale.subtotal,
          discount: sale.discount,
          // el servidor separa los ahorros automáticos del descuento a mano
          ahorro_tramos: cart.ahorroTramos,
          ahorro_promos: cart.ahorroPromos,
          promos: cart.promos,
          total: sale.total,
          cash_received: sale.cash_received ?? "",
          sold_by: sale.sold_by,
          note: sale.note,
          items: sale.items.map((i) => ({
            product_id: i.product_id,
            qty: i.qty,
            unit_price: i.unit_price,
            line_total: i.line_total,
            presentacion: i.presentacion,
          })),
        })
      );
    }
  );
  return sale;
}

// ── GASTOS ───────────────────────────────────────────────────────────────────

export async function recordExpense(input: {
  category: string;
  description: string;
  amount: number;
  payment_method: PaymentMethod;
  product_id?: string;
  qty_purchased?: number;
  new_cost?: number | null;
  supplier?: string;
  /** de qué caja sale la plata; con varias abiertas hay que elegir */
  cash_session_id?: string | null;
  /** a quién se le pagó, si es un sueldo o adelanto */
  empleado_id?: string | null;
  created_by: string;
}): Promise<Expense> {
  const session = input.cash_session_id
    ? await db.cash_sessions.get(input.cash_session_id)
    : await getOpenSession();
  const attachToSession =
    input.payment_method === "efectivo" && session?.status === "abierta"
      ? session
      : null;
  const expense: Expense = {
    id: uuid(),
    spent_at: nowISO(),
    category: input.category,
    description: input.description,
    amount: input.amount,
    payment_method: input.payment_method,
    cash_session_id: attachToSession ? attachToSession.id : null,
    product_id: input.product_id ?? null,
    qty_purchased: input.qty_purchased ?? null,
    new_cost: input.new_cost ?? null,
    supplier: input.supplier ?? null,
    empleado_id: input.empleado_id ?? null,
    created_by: input.created_by,
  };

  await db.transaction(
    "rw",
    [db.expenses, db.products, db.stock_movements, db.outbox],
    async () => {
      await db.expenses.add(expense);

      // Compra de mercadería: entra stock y, si se confirmó, actualiza costo.
      if (expense.product_id && expense.qty_purchased && expense.qty_purchased > 0) {
        const product = await db.products.get(expense.product_id);
        if (product) {
          const balance = product.current_qty + expense.qty_purchased;
          const patch: Partial<Product> = {
            current_qty: balance,
            updated_at: expense.spent_at,
          };
          if (expense.new_cost != null) patch.cost_per_unit = expense.new_cost;
          await db.products.update(expense.product_id, patch);
          await db.stock_movements.add({
            id: uuid(),
            product_id: expense.product_id,
            type: "compra",
            qty: expense.qty_purchased,
            reason: expense.description,
            ref_id: expense.id,
            balance_after: balance,
            moved_at: expense.spent_at,
            created_by: expense.created_by,
          });
        }
      }

      await db.outbox.add(
        op("expense", expense.id, {
          id: expense.id,
          spent_at: expense.spent_at,
          category: expense.category,
          description: expense.description,
          amount: expense.amount,
          payment_method: expense.payment_method,
          cash_session_id: expense.cash_session_id ?? "",
          product_id: expense.product_id ?? "",
          qty_purchased: expense.qty_purchased ?? "",
          new_cost: expense.new_cost ?? "",
          supplier: expense.supplier,
          empleado_id: expense.empleado_id ?? "",
          created_by: expense.created_by,
        })
      );
    }
  );
  return expense;
}

// ── STOCK ────────────────────────────────────────────────────────────────────

export async function recordCount(input: {
  product_id: string;
  counted_qty: number;
  note?: string;
  counted_by: string;
}) {
  assertFinite(input.counted_qty, "Cantidad contada");
  const product = await db.products.get(input.product_id);
  if (!product) throw new Error("Producto inexistente.");
  const countedAt = nowISO();
  const systemQty = product.current_qty;
  const diff = input.counted_qty - systemQty;
  const countId = uuid();

  await db.transaction(
    "rw",
    [db.stock_counts, db.stock_movements, db.products, db.outbox],
    async () => {
      await db.stock_counts.add({
        id: countId,
        counted_at: countedAt,
        product_id: input.product_id,
        system_qty: systemQty,
        counted_qty: input.counted_qty,
        diff,
        note: input.note ?? null,
        counted_by: input.counted_by,
      });
      await db.products.update(input.product_id, {
        current_qty: input.counted_qty,
        updated_at: countedAt,
      });
      await db.stock_movements.add({
        id: uuid(),
        product_id: input.product_id,
        type: "conteo",
        qty: diff,
        reason: "Conteo físico",
        ref_id: countId,
        balance_after: input.counted_qty,
        moved_at: countedAt,
        created_by: input.counted_by,
      });
      await db.outbox.add(
        op("stock_count", countId, {
          id: countId,
          counted_at: countedAt,
          product_id: input.product_id,
          system_qty: systemQty,
          counted_qty: input.counted_qty,
          diff,
          note: input.note ?? null,
          counted_by: input.counted_by,
        })
      );
    }
  );
  return { id: countId, system_qty: systemQty, diff };
}

export async function recordStockMove(input: {
  product_id: string;
  type: Exclude<StockMovementType, "venta" | "conteo">;
  /** en unidades; el signo lo define el tipo (merma resta, compra suma) */
  qty: number;
  reason: string;
  created_by: string;
}) {
  assertFinite(input.qty, "Cantidad");
  const product = await db.products.get(input.product_id);
  if (!product) throw new Error("Producto inexistente.");
  const movedAt = nowISO();
  const signedQty =
    input.type === "merma" ? -Math.abs(input.qty) : input.qty;
  const balance = product.current_qty + signedQty;
  const id = uuid();

  await db.transaction(
    "rw",
    [db.stock_movements, db.products, db.outbox],
    async () => {
      await db.products.update(input.product_id, {
        current_qty: balance,
        updated_at: movedAt,
      });
      await db.stock_movements.add({
        id,
        product_id: input.product_id,
        type: input.type,
        qty: signedQty,
        reason: input.reason,
        ref_id: null,
        balance_after: balance,
        moved_at: movedAt,
        created_by: input.created_by,
      });
      await db.outbox.add(
        op("stock_move", id, {
          id,
          product_id: input.product_id,
          type: input.type,
          qty: signedQty,
          reason: input.reason,
          moved_at: movedAt,
          created_by: input.created_by,
        })
      );
    }
  );
}

// ── CLIENTES ─────────────────────────────────────────────────────────────────

export async function upsertCustomer(input: {
  id?: string;
  name: string;
  phone?: string;
  credit_limit?: number | null;
  note?: string;
}): Promise<Customer> {
  const customer: Customer = {
    id: input.id ?? uuid(),
    name: input.name,
    phone: input.phone ?? null,
    note: input.note ?? null,
    credit_limit: input.credit_limit ?? null,
    is_active: true,
  };
  await db.transaction("rw", db.customers, db.outbox, async () => {
    await db.customers.put(customer);
    await db.outbox.add(
      op("upsert_customer", customer.id, {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        note: customer.note,
        credit_limit: customer.credit_limit ?? "",
        is_active: customer.is_active,
      })
    );
  });
  return customer;
}

export async function customerBalance(customerId: string): Promise<number> {
  const movements = await db.account_movements
    .where("customer_id")
    .equals(customerId)
    .sortBy("moved_at");
  return movements.at(-1)?.balance_after ?? 0;
}

export async function recordCustomerPayment(input: {
  customer_id: string;
  amount: number;
  payment_method: PaymentMethod;
  note?: string;
  created_by: string;
  type?: "pago" | "ajuste";
  /** en qué caja entra la plata; con varias abiertas hay que elegir */
  cash_session_id?: string | null;
}) {
  assertFinite(input.amount, "Cifra del pago");
  const movedAt = nowISO();
  const id = uuid();
  const type = input.type ?? "pago";
  const signed = type === "pago" ? -Math.abs(input.amount) : input.amount;

  // Un pago en efectivo con caja abierta entra al cajón: afecta el arqueo,
  // igual que el gasto en efectivo (misma regla, signo inverso).
  const session = input.cash_session_id
    ? await db.cash_sessions.get(input.cash_session_id)
    : await getOpenSession();
  const cashSessionId =
    type === "pago" &&
    input.payment_method === "efectivo" &&
    session?.status === "abierta"
      ? session.id
      : null;

  await db.transaction(
    "rw",
    [db.account_movements, db.cash_sessions, db.outbox],
    async () => {
      const movements = await db.account_movements
        .where("customer_id")
        .equals(input.customer_id)
        .sortBy("moved_at");
      const balance = (movements.at(-1)?.balance_after ?? 0) + signed;
      await db.account_movements.add({
        id,
        customer_id: input.customer_id,
        type,
        amount: signed,
        balance_after: balance,
        sale_id: null,
        payment_method: input.payment_method,
        cash_session_id: cashSessionId,
        note: input.note ?? null,
        moved_at: movedAt,
        created_by: input.created_by,
      });
      await db.outbox.add(
        op("customer_payment", id, {
          id,
          customer_id: input.customer_id,
          type,
          amount: signed,
          payment_method: input.payment_method,
          cash_session_id: cashSessionId ?? "",
          note: input.note ?? null,
          moved_at: movedAt,
          created_by: input.created_by,
        })
      );
    }
  );
}

// ── ALTA DE PRODUCTOS ────────────────────────────────────────────────────────

export async function createProduct(input: {
  name: string;
  kind: Product["kind"];
  unit_price: number;
  half_dozen_price?: number | null;
  dozen_price?: number | null;
  frozen_dozen_price?: number | null;
  cost_per_unit?: number | null;
  min_qty?: number | null;
}): Promise<Product> {
  const producto: Product = {
    id: uuid(),
    name: input.name.trim(),
    kind: input.kind,
    unit_price: input.unit_price,
    half_dozen_price: input.half_dozen_price ?? null,
    dozen_price: input.dozen_price ?? null,
    frozen_dozen_price: input.frozen_dozen_price ?? null,
    cost_per_unit: input.cost_per_unit ?? null,
    current_qty: 0,
    min_qty: input.min_qty ?? null,
    // al final de la lista: el orden del pizarrón lo define el dueño después
    sort_order: ((await db.products.orderBy("sort_order").last())?.sort_order ?? 0) + 1,
    is_active: true,
    updated_at: nowISO(),
  };

  await db.transaction("rw", db.products, db.outbox, async () => {
    await db.products.add(producto);
    await db.outbox.add(
      op("upsert_product", producto.id, {
        id: producto.id,
        name: producto.name,
        kind: producto.kind,
        unit_price: producto.unit_price,
        half_dozen_price: producto.half_dozen_price ?? "",
        dozen_price: producto.dozen_price ?? "",
        frozen_dozen_price: producto.frozen_dozen_price ?? "",
        cost_per_unit: producto.cost_per_unit ?? "",
        min_qty: producto.min_qty ?? "",
        sort_order: producto.sort_order,
        is_active: true,
      })
    );
  });
  return producto;
}

/**
 * ¿Este producto se puede borrar de verdad, o sólo desactivar?
 *
 * Si ya se vendió o se movió stock, borrarlo dejaría el histórico mintiendo:
 * ventas apuntando a un producto que no existe. En ese caso se desactiva.
 */
export async function productoBorrable(id: string): Promise<boolean> {
  // Alcanza con mirar el ledger: toda venta genera su movimiento de stock, así
  // que un producto sin movimientos ni conteos nunca se vendió. Recorrer las
  // ventas además sería leerlas todas para responder lo mismo.
  const [movimientos, conteos] = await Promise.all([
    db.stock_movements.where("product_id").equals(id).count(),
    db.stock_counts.where("product_id").equals(id).count(),
  ]);
  return movimientos === 0 && conteos === 0;
}

/**
 * Baja de producto. El servidor vuelve a decidir con TODO el histórico (el
 * dispositivo sólo conoce lo suyo): si el producto tiene historia lo desactiva
 * en vez de borrarlo. Devuelve qué se hizo localmente.
 */
export async function deleteProduct(
  id: string
): Promise<{ borrado: boolean }> {
  const borrable = await productoBorrable(id);

  await db.transaction(
    "rw",
    [db.products, db.canal_precios, db.promos, db.outbox],
    async () => {
      if (borrable) {
        await db.products.delete(id);
        await db.canal_precios.where("product_id").equals(id).delete();
        const promos = await db.promos.toArray();
        const afectadas = promos.filter(
          (p) => p.product_id === id || p.bebida_product_id === id
        );
        for (const p of afectadas) await db.promos.delete(p.id);
      } else {
        await db.products.update(id, { is_active: false, updated_at: nowISO() });
      }
      await db.outbox.add(op("delete_product", id, { id }));
    }
  );

  return { borrado: borrable };
}

// ── PROMOCIONES ──────────────────────────────────────────────────────────────

export async function upsertPromo(
  input: Omit<Promo, "id" | "sort_order"> & {
    id?: string;
    sort_order?: number;
  }
): Promise<Promo> {
  const existente = input.id ? await db.promos.get(input.id) : undefined;
  const promo: Promo = {
    ...input,
    id: input.id ?? uuid(),
    nombre: input.nombre.trim(),
    sort_order:
      input.sort_order ??
      existente?.sort_order ??
      ((await db.promos.orderBy("sort_order").last())?.sort_order ?? 0) + 1,
  };

  await db.transaction("rw", db.promos, db.outbox, async () => {
    await db.promos.put(promo);
    await db.outbox.add(
      op("upsert_promo", promo.id, {
        id: promo.id,
        nombre: promo.nombre,
        tipo: promo.tipo,
        empanadas_qty: promo.empanadas_qty ?? "",
        bebida_product_id: promo.bebida_product_id ?? "",
        bebida_qty: promo.bebida_qty ?? "",
        precio_fijo: promo.precio_fijo ?? "",
        valor: promo.valor ?? "",
        product_id: promo.product_id ?? "",
        kind: promo.kind ?? "",
        minimo_unidades: promo.minimo_unidades ?? "",
        dias: promo.dias,
        desde: promo.desde ?? "",
        hasta: promo.hasta ?? "",
        canal_id: promo.canal_id ?? "",
        activo: promo.activo,
        sort_order: promo.sort_order,
      })
    );
  });
  return promo;
}

/** Igual que los productos: si ya se usó en una venta, se desactiva. */
export async function deletePromo(id: string): Promise<void> {
  await db.transaction("rw", db.promos, db.outbox, async () => {
    await db.promos.delete(id);
    await db.outbox.add(op("delete_promo", id, { id }));
  });
}

// ── CANALES DE VENTA ─────────────────────────────────────────────────────────

export async function upsertCanal(input: {
  id?: string;
  nombre: string;
  recargo_pct: number;
  activo?: boolean;
}): Promise<Canal> {
  const existente = input.id ? await db.canales.get(input.id) : undefined;
  const canal: Canal = {
    id: input.id ?? uuid(),
    nombre: input.nombre.trim(),
    recargo_pct: input.recargo_pct,
    es_default: existente?.es_default ?? false,
    activo: input.activo ?? existente?.activo ?? true,
    sort_order:
      existente?.sort_order ??
      ((await db.canales.orderBy("sort_order").last())?.sort_order ?? 0) + 1,
  };
  await db.transaction("rw", db.canales, db.outbox, async () => {
    await db.canales.put(canal);
    await db.outbox.add(
      op("upsert_canal", canal.id, {
        id: canal.id,
        nombre: canal.nombre,
        recargo_pct: canal.recargo_pct,
        es_default: canal.es_default,
        activo: canal.activo,
        sort_order: canal.sort_order,
      })
    );
  });
  return canal;
}

/** Precio propio de un producto en un canal. null en un campo = usar el base. */
export async function setCanalPrecio(input: {
  canal_id: string;
  product_id: string;
  unit_price: number | null;
  half_dozen_price: number | null;
  dozen_price: number | null;
  frozen_dozen_price: number | null;
}): Promise<void> {
  const fila: CanalPrecio = { ...input };
  const vacio =
    fila.unit_price == null &&
    fila.half_dozen_price == null &&
    fila.dozen_price == null &&
    fila.frozen_dozen_price == null;

  await db.transaction("rw", db.canal_precios, db.outbox, async () => {
    if (vacio) await db.canal_precios.delete([input.canal_id, input.product_id]);
    else await db.canal_precios.put(fila);
    await db.outbox.add(
      op("upsert_canal_precio", `${input.canal_id}:${input.product_id}`, {
        canal_id: input.canal_id,
        product_id: input.product_id,
        unit_price: fila.unit_price ?? "",
        half_dozen_price: fila.half_dozen_price ?? "",
        dozen_price: fila.dozen_price ?? "",
        frozen_dozen_price: fila.frozen_dozen_price ?? "",
        borrar: vacio,
      })
    );
  });
}

// ── CONFIGURACIÓN DE PRODUCTOS ───────────────────────────────────────────────

export async function updateProduct(
  id: string,
  patch: Partial<
    Pick<
      Product,
      | "name"
      | "unit_price"
      | "half_dozen_price"
      | "dozen_price"
      | "frozen_dozen_price"
      | "cost_per_unit"
      | "min_qty"
      | "is_active"
    >
  >
) {
  await db.transaction("rw", db.products, db.outbox, async () => {
    await db.products.update(id, { ...patch, updated_at: nowISO() });
    const product = await db.products.get(id);
    if (!product) return;
    await db.outbox.add(
      op("upsert_product", id, {
        id: product.id,
        name: product.name,
        kind: product.kind,
        unit_price: product.unit_price,
        half_dozen_price: product.half_dozen_price ?? "",
        dozen_price: product.dozen_price ?? "",
        frozen_dozen_price: product.frozen_dozen_price ?? "",
        cost_per_unit: product.cost_per_unit ?? "",
        min_qty: product.min_qty ?? "",
        sort_order: product.sort_order,
        is_active: product.is_active,
      })
    );
  });
}
