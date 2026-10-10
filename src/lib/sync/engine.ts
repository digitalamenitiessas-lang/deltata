"use client";

import { create } from "zustand";
import { db } from "@/lib/db";
import type {
  Canal,
  CanalPrecio,
  CashSession,
  ClienteGusto,
  Customer,
  Empleado,
  Expense,
  PaymentMethod,
  Pedido,
  Presentacion,
  Product,
  Promo,
  Sale,
  StockCount,
  StockMovement,
  StockMovementType,
  StockUbic,
  Ubicacion,
} from "@/types";

// El trabajo que no se sincroniza, no existe: la cola es visible siempre.
// Orden FIFO estricto (abrir caja viaja antes que sus ventas).
//
// Dos tipos de falla:
// - Transitoria (sin señal, servidor ocupado): la cola se detiene y se
//   reintenta, sin reordenar.
// - Definitiva (el servidor dice que esa operación no es válida): sale de la
//   cola a "rechazadas", queda en la auditoría del servidor, y la cola SIGUE.
//   Antes una sola rechazada trababa todo lo que venía atrás, para siempre.

interface SyncState {
  online: boolean;
  pending: number;
  /** operaciones que el servidor no aceptó: se revisan en Más → Sincronización */
  rechazadas: number;
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
}

export const useSyncStore = create<SyncState>(() => ({
  online: true,
  pending: 0,
  rechazadas: 0,
  syncing: false,
  lastError: null,
  lastSyncAt: null,
}));

let flushing = false;
let started = false;

async function refreshPending() {
  const [pending, rechazadas] = await Promise.all([
    db.outbox.count(),
    db.rechazadas.count(),
  ]);
  useSyncStore.setState({ pending, rechazadas });
}

export async function flushOutbox(): Promise<void> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return;
  flushing = true;
  useSyncStore.setState({ syncing: true });
  try {
    // FIFO: nunca reordenar; el orden garantiza consistencia (caja → ventas → cierre)
    for (;;) {
      const batch = await db.outbox.orderBy("id").limit(20).toArray();
      if (batch.length === 0) break;

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ops: batch.map((o) => ({ id: o.id, kind: o.kind, payload: o.payload })),
        }),
      });
      if (res.status === 401) {
        throw new Error("La sesión venció: volvé a entrar para enviar lo pendiente.");
      }
      if (!res.ok) throw new Error(`Sync HTTP ${res.status}`);
      const data: {
        results: { id: number; ok: boolean; error?: string; definitivo?: boolean }[];
      } = await res.json();

      const okIds: number[] = [];
      let failed: { id: number; error?: string } | null = null;
      for (const r of data.results) {
        if (r.ok) okIds.push(r.id);
        else if (r.definitivo) {
          const rechazada = batch.find((b) => b.id === r.id);
          if (rechazada?.id != null) {
            await db.transaction("rw", db.outbox, db.rechazadas, async () => {
              await db.rechazadas.add({
                kind: rechazada.kind,
                entity_id: rechazada.entity_id,
                payload: rechazada.payload,
                created_at: rechazada.created_at,
                rechazada_en: new Date().toISOString(),
                motivo: r.error ?? "El servidor no la aceptó",
                autor: rechazada.autor,
              });
              await db.outbox.delete(rechazada.id!);
            });
          }
        } else {
          failed = r;
          break;
        }
      }
      if (okIds.length > 0) await db.outbox.bulkDelete(okIds);
      if (failed) {
        const failedOp = batch.find((b) => b.id === failed!.id);
        if (failedOp?.id != null) {
          await db.outbox.update(failedOp.id, {
            tries: (failedOp.tries ?? 0) + 1,
            last_error: failed.error ?? "Error desconocido",
          });
        }
        throw new Error(failed.error ?? "Error de sincronización");
      }
      if (data.results.length < batch.length) break;
    }
    useSyncStore.setState({
      lastError: null,
      lastSyncAt: new Date().toISOString(),
    });
    await pullCatalog();
    await pullHistorial();
  } catch (err) {
    useSyncStore.setState({
      lastError: err instanceof Error ? err.message : String(err),
    });
  } finally {
    flushing = false;
    useSyncStore.setState({ syncing: false });
    await refreshPending();
  }
}

interface ServerAccountMovement {
  local_uuid: string;
  customer_id: string;
  type: "venta" | "pago" | "ajuste";
  amount: number | string;
  balance_after: number | string | null;
  sale_id: string | null;
  payment_method: string | null;
  cash_session_id: string | null;
  note: string | null;
  moved_at: string;
  created_by: string | null;
}

/**
 * Cabecera de una caja abierta en cualquier dispositivo. Sin totales a
 * propósito: acá no están las ventas del otro equipo, y un total incompleto
 * engañaría más de lo que ayuda.
 */
export interface CajaAbiertaRemota {
  local_uuid: string;
  canal_id: string | null;
  opened_at: string;
  opened_by: string | null;
}

export const CLAVE_CAJAS_REMOTAS = "cajas_abiertas_servidor";

/** Postgres devuelve numeric como string y time como "HH:MM:SS". */
const num = (v: number | null | undefined): number | null =>
  v == null || v === ("" as unknown) ? null : Number(v);
const hhmm = (v: string | null | undefined): string | null =>
  v == null || v === "" ? null : v.slice(0, 5);

/**
 * Trae catálogo, promos, clientes y ledger de cuenta corriente del servidor.
 * Regla: con la cola vacía, el servidor es canónico y pisa lo local; con
 * operaciones pendientes, lo local (que ya las refleja) es más verdadero y
 * el pull sólo agrega lo que falta. El conteo de pendientes se hace DENTRO
 * de la transacción (que incluye outbox) para que no haya carrera con una
 * venta que se registra en el medio.
 */
export async function pullCatalog(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) return;
  try {
    const res = await fetch("/api/bootstrap");
    if (!res.ok) return;
    const data: {
      products: Product[];
      customers: Customer[];
      account_movements?: ServerAccountMovement[];
      canales?: Canal[];
      canal_precios?: CanalPrecio[];
      promos?: Promo[];
      cliente_gustos?: ClienteGusto[];
      empleados?: Empleado[];
      cajas_abiertas?: CajaAbiertaRemota[];
      ubicaciones?: Ubicacion[];
      stock_ubicacion?: StockUbic[];
      pedidos?: Pedido[];
    } = await res.json();

    await db.transaction(
      "rw",
      [
        db.products,
        db.customers,
        db.account_movements,
        db.canales,
        db.canal_precios,
        db.promos,
        db.cliente_gustos,
        db.empleados,
        db.meta,
        db.outbox,
        db.ubicaciones,
        db.stock_ubic,
        db.pedidos,
      ],
      async () => {
        const pendingOps = await db.outbox.count();

        // Un producto borrado en otro dispositivo tiene que desaparecer acá:
        // si no, el que atiende lo sigue viendo en el POS.
        if (pendingOps === 0) {
          const enServidor = new Set(data.products.map((p) => p.id));
          const sobrantes = (await db.products.toArray())
            .filter((p) => !enServidor.has(p.id))
            .map((p) => p.id);
          if (sobrantes.length > 0) await db.products.bulkDelete(sobrantes);
        }

        for (const p of data.products) {
          const local = await db.products.get(p.id);
          if (!local) {
            await db.products.put(p);
          } else if (pendingOps === 0) {
            await db.products.update(p.id, {
              name: p.name,
              kind: p.kind,
              unit_price: Number(p.unit_price),
              half_dozen_price:
                p.half_dozen_price == null ? null : Number(p.half_dozen_price),
              dozen_price: p.dozen_price == null ? null : Number(p.dozen_price),
              frozen_dozen_price:
                p.frozen_dozen_price == null ? null : Number(p.frozen_dozen_price),
              cost_per_unit:
                p.cost_per_unit == null ? null : Number(p.cost_per_unit),
              min_qty: p.min_qty == null ? null : Number(p.min_qty),
              sort_order: p.sort_order,
              is_active: p.is_active,
              archivado: p.archivado ?? false,
              current_qty: Number(p.current_qty),
            });
          }
        }

        // Clientes: con la cola vacía manda el servidor (un límite cambiado
        // desde otro equipo tiene que llegar acá)
        for (const c of data.customers) {
          const local = await db.customers.get(c.id);
          if (!local || pendingOps === 0) {
            await db.customers.put({
              ...c,
              credit_limit: c.credit_limit == null ? null : Number(c.credit_limit),
            });
          }
        }

        if (data.ubicaciones) {
          await db.ubicaciones.clear();
          await db.ubicaciones.bulkPut(data.ubicaciones);
        }

        // Cuánto hay en cada lugar: con la cola vacía, el servidor es la verdad
        if (data.stock_ubicacion) {
          if (pendingOps === 0) {
            await db.stock_ubic.clear();
            await db.stock_ubic.bulkPut(
              data.stock_ubicacion.map((r) => ({ ...r, qty: Number(r.qty) }))
            );
          } else {
            for (const r of data.stock_ubicacion) {
              const local = await db.stock_ubic.get([r.product_id, r.ubicacion_id]);
              if (!local) await db.stock_ubic.put({ ...r, qty: Number(r.qty) });
            }
          }
        }

        // Pedidos: los toma un equipo y los prepara o entrega otro. Con la
        // cola vacía se reemplazan enteros (uno entregado en otro equipo
        // tiene que dejar de figurar pendiente acá).
        if (data.pedidos) {
          const remotos = data.pedidos.map((p) => ({
            ...p,
            total: Number(p.total),
            cantidades: p.cantidades ?? {},
            lineas: p.lineas ?? [],
          }));
          if (pendingOps === 0) {
            await db.pedidos.clear();
            await db.pedidos.bulkPut(remotos);
          } else {
            for (const p of remotos) {
              const local = await db.pedidos.get(p.id);
              if (!local || local.cambiado_en < p.cambiado_en) await db.pedidos.put(p);
            }
          }
        }

        // Canales y sus precios: los define el dueño, el servidor es la verdad
        if (data.canales) {
          await db.canales.bulkPut(
            data.canales.map((c) => ({
              ...c,
              recargo_pct: Number(c.recargo_pct),
              ubicacion_id: c.ubicacion_id ?? null,
            }))
          );
        }
        if (pendingOps === 0 && data.canal_precios) {
          await db.canal_precios.clear();
          await db.canal_precios.bulkPut(
            data.canal_precios.map((c) => ({
              ...c,
              unit_price: c.unit_price == null ? null : Number(c.unit_price),
              half_dozen_price:
                c.half_dozen_price == null ? null : Number(c.half_dozen_price),
              dozen_price: c.dozen_price == null ? null : Number(c.dozen_price),
              frozen_dozen_price:
                c.frozen_dozen_price == null ? null : Number(c.frozen_dozen_price),
            }))
          );
        }

        // Promos: las define el dueño, el servidor manda. Se reemplazan
        // enteras porque una promo que se borró tiene que dejar de aplicarse.
        if (pendingOps === 0 && data.promos) {
          await db.promos.clear();
          await db.promos.bulkPut(
            data.promos.map((p) => ({
              ...p,
              empanadas_qty: num(p.empanadas_qty),
              bebida_qty: num(p.bebida_qty),
              precio_fijo: num(p.precio_fijo),
              valor: num(p.valor),
              minimo_unidades: num(p.minimo_unidades),
              dias: p.dias == null ? null : p.dias.map(Number),
              // Postgres devuelve "20:00:00"; la app trabaja con "20:00"
              desde: hhmm(p.desde),
              hasta: hhmm(p.hasta),
              sort_order: Number(p.sort_order ?? 0),
            }))
          );
        }

        // Lo que suele llevar cada cliente: lo calcula el servidor sobre todo
        // el histórico, así que se reemplaza entero.
        if (data.cliente_gustos) {
          await db.cliente_gustos.clear();
          await db.cliente_gustos.bulkPut(
            data.cliente_gustos.map((g) => ({
              ...g,
              unidades: Number(g.unidades),
              veces: Number(g.veces),
            }))
          );
        }

        // Quién trabaja acá: se guarda para poder atribuir un sueldo sin señal
        if (data.empleados) {
          await db.empleados.clear();
          await db.empleados.bulkPut(data.empleados);
        }

        // Cajas abiertas en otros dispositivos: si alguien dejó la del local
        // abierta, tiene que verse desde acá aunque las ventas no estén.
        if (data.cajas_abiertas) {
          await db.meta.put({
            key: CLAVE_CAJAS_REMOTAS,
            value: JSON.stringify(data.cajas_abiertas),
          });
        }

        // Ledger de cuenta corriente: el servidor recalcula balance_after por
        // orden global (seq); con la cola vacía es la verdad y reemplaza todo.
        if (pendingOps === 0 && data.account_movements) {
          await db.account_movements.clear();
          await db.account_movements.bulkPut(
            data.account_movements.map((m) => ({
              id: m.local_uuid,
              customer_id: m.customer_id,
              type: m.type,
              amount: Number(m.amount),
              balance_after: Number(m.balance_after ?? 0),
              sale_id: m.sale_id,
              payment_method: (m.payment_method as PaymentMethod | null) ?? null,
              cash_session_id: m.cash_session_id,
              note: m.note,
              moved_at: m.moved_at,
              created_by: m.created_by ?? "",
            }))
          );
        }
      }
    );
  } catch {
    // el pull es best-effort; la operación local nunca depende de él
  }
}

// ── HISTORIAL DE TODOS LOS EQUIPOS ───────────────────────────────────────────

const CLAVE_HISTORIAL = "historial_hasta";

const n = (v: unknown): number => Number(v ?? 0);
const nOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

interface ServerSale {
  id: string;
  sold_at: string;
  cash_session_id: string | null;
  canal_id: string | null;
  payment_method: PaymentMethod;
  customer_id: string | null;
  subtotal: number;
  discount: number;
  promo_discount: number | null;
  total: number;
  cash_received: number | null;
  sold_by: string | null;
  note: string | null;
  sale_items?: {
    product_id: string;
    qty: number;
    unit_price: number;
    line_total: number;
    presentacion: Presentacion | null;
    products?: { name: string } | null;
  }[];
  sale_promos?: { promo_id: string; nombre: string; veces: number; ahorro: number }[];
}

/**
 * Trae lo que se vendió, cobró, gastó y movió en TODOS los equipos (no sólo
 * en éste), para que el Control del dueño, el Historial y las cajas muestren
 * todo. Incremental: pide lo que cambió desde la última vez.
 *
 * Sólo escribe con la cola vacía: así nunca pisa algo de este equipo que
 * todavía no llegó al servidor. (El motor no sincroniza mientras trae, y una
 * operación nueva en el medio deja la cola con algo y se reintenta después.)
 *
 * La primera vez no se borra nada (en una caja abierta faltaría lo que todavía
 * no llegó): sólo se sacan los movimientos de stock que la versión anterior
 * guardaba con un id al azar, porque el servidor los manda con otro y
 * quedarían repetidos.
 */
export async function pullHistorial(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) return;
  try {
    if ((await db.outbox.count()) > 0) return;
    const desde = (await db.meta.get(CLAVE_HISTORIAL))?.value ?? null;
    const res = await fetch(
      `/api/historial${desde ? `?desde=${encodeURIComponent(desde)}` : ""}`
    );
    if (!res.ok) return;
    const data: {
      hasta: string;
      sales: ServerSale[];
      cash_sessions: (CashSession & { actualizado_en?: string })[];
      expenses: (Expense & { actualizado_en?: string })[];
      stock_movements: {
        local_uuid: string;
        product_id: string;
        type: StockMovementType;
        qty: number;
        reason: string | null;
        ref_id: string | null;
        balance_after: number | null;
        moved_at: string;
        created_by: string | null;
        ubicacion_id: string | null;
        absorbido: boolean | null;
      }[];
      stock_counts: StockCount[];
    } = await res.json();

    const ventas: Sale[] = data.sales.map((v) => ({
      id: v.id,
      sold_at: v.sold_at,
      cash_session_id: v.cash_session_id ?? "",
      canal_id: v.canal_id,
      payment_method: v.payment_method,
      customer_id: v.customer_id,
      subtotal: n(v.subtotal),
      discount: n(v.discount),
      promo_discount: n(v.promo_discount),
      promos: (v.sale_promos ?? []).map((p) => ({
        promo_id: p.promo_id,
        nombre: p.nombre,
        veces: n(p.veces),
        ahorro: n(p.ahorro),
      })),
      total: n(v.total),
      cash_received: nOrNull(v.cash_received),
      sold_by: v.sold_by ?? "",
      note: v.note,
      items: (v.sale_items ?? []).map((i) => ({
        product_id: i.product_id,
        product_name: i.products?.name ?? "",
        qty: n(i.qty),
        unit_price: n(i.unit_price),
        line_total: n(i.line_total),
        presentacion: i.presentacion ?? "cocida",
      })),
    }));
    const cajas: CashSession[] = data.cash_sessions.map((c) => ({
      id: c.id,
      canal_id: c.canal_id,
      opened_at: c.opened_at,
      opened_by: c.opened_by ?? "",
      opening_float: n(c.opening_float),
      closed_at: c.closed_at,
      closed_by: c.closed_by,
      counted_cash: nOrNull(c.counted_cash),
      expected_cash: nOrNull(c.expected_cash),
      difference: nOrNull(c.difference),
      note: c.note,
      status: c.status,
      conciliacion: c.conciliacion ?? null,
      sin_arqueo: c.sin_arqueo ?? false,
    }));
    const gastos: Expense[] = data.expenses.map((e) => ({
      id: e.id,
      spent_at: e.spent_at,
      category: e.category,
      description: e.description,
      amount: n(e.amount),
      payment_method: e.payment_method,
      cash_session_id: e.cash_session_id,
      product_id: e.product_id,
      qty_purchased: nOrNull(e.qty_purchased),
      new_cost: null,
      supplier: e.supplier,
      empleado_id: e.empleado_id ?? null,
      created_by: e.created_by ?? "",
    }));
    const movimientos: StockMovement[] = data.stock_movements.map((m) => ({
      id: m.local_uuid,
      product_id: m.product_id,
      type: m.type,
      qty: n(m.qty),
      reason: m.reason,
      ref_id: m.ref_id,
      balance_after: n(m.balance_after),
      moved_at: m.moved_at,
      created_by: m.created_by ?? "",
      ubicacion_id: m.ubicacion_id,
      absorbido: m.absorbido ?? false,
    }));
    const conteos: StockCount[] = data.stock_counts.map((c) => ({
      id: c.id,
      counted_at: c.counted_at,
      product_id: c.product_id,
      system_qty: n(c.system_qty),
      counted_qty: n(c.counted_qty),
      diff: n(c.diff),
      note: c.note,
      counted_by: c.counted_by ?? "",
      ubicacion_id: c.ubicacion_id ?? null,
    }));

    await db.transaction(
      "rw",
      [
        db.outbox,
        db.meta,
        db.sales,
        db.cash_sessions,
        db.expenses,
        db.stock_movements,
        db.stock_counts,
      ],
      async () => {
        if ((await db.outbox.count()) > 0) return;
        if (desde == null) {
          // Los derivados (de una venta, un gasto o un conteo) tienen ref_id;
          // los viejos, además, un id sin ":" — los nuevos usan el del servidor
          await db.stock_movements
            .filter((m) => m.ref_id != null && !m.id.includes(":"))
            .delete();
        }
        await db.sales.bulkPut(ventas);
        await db.cash_sessions.bulkPut(cajas);
        await db.expenses.bulkPut(gastos);
        await db.stock_movements.bulkPut(movimientos);
        await db.stock_counts.bulkPut(conteos);
        await db.meta.put({ key: CLAVE_HISTORIAL, value: data.hasta });
      }
    );
  } catch {
    // best-effort, igual que el catálogo
  }
}

/** Arranca listeners de conectividad + reintento periódico. Idempotente. */
export function startSyncEngine(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  useSyncStore.setState({ online: navigator.onLine });
  // Que el navegador no borre los datos locales por falta de espacio: ahí
  // vive lo que todavía no se mandó. (Safari, sobre todo, limpia sin avisar.)
  void navigator.storage?.persist?.().catch(() => undefined);
  window.addEventListener("online", () => {
    useSyncStore.setState({ online: true });
    void flushOutbox();
  });
  window.addEventListener("offline", () => {
    useSyncStore.setState({ online: false });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushOutbox();
  });
  setInterval(() => void flushOutbox(), 30_000);

  void refreshPending();
  void flushOutbox();
}

/** Notifica al motor que hay trabajo nuevo (llamar tras cada operación). */
export function notifyOutboxChanged(): void {
  void refreshPending();
  void flushOutbox();
}
