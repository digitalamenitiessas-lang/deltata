"use client";

import { create } from "zustand";
import { db } from "@/lib/db";
import type {
  Canal,
  CanalPrecio,
  ClienteGusto,
  Customer,
  Empleado,
  PaymentMethod,
  Product,
  Promo,
} from "@/types";

// El trabajo que no se sincroniza, no existe: la cola es visible siempre.
// Orden FIFO estricto (abrir caja viaja antes que sus ventas). Si una operación
// falla, la cola se detiene, se muestra el error y se reintenta — nunca se
// descarta ni se reordena.

interface SyncState {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
}

export const useSyncStore = create<SyncState>(() => ({
  online: true,
  pending: 0,
  syncing: false,
  lastError: null,
  lastSyncAt: null,
}));

let flushing = false;
let started = false;

async function refreshPending() {
  const pending = await db.outbox.count();
  useSyncStore.setState({ pending });
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
      if (!res.ok) throw new Error(`Sync HTTP ${res.status}`);
      const data: { results: { id: number; ok: boolean; error?: string }[] } =
        await res.json();

      const okIds: number[] = [];
      let failed: { id: number; error?: string } | null = null;
      for (const r of data.results) {
        if (r.ok) okIds.push(r.id);
        else {
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
              current_qty: Number(p.current_qty),
            });
          }
        }

        for (const c of data.customers) {
          const local = await db.customers.get(c.id);
          if (!local) await db.customers.put(c);
        }

        // Canales y sus precios: los define el dueño, el servidor es la verdad
        if (data.canales) {
          await db.canales.bulkPut(
            data.canales.map((c) => ({ ...c, recargo_pct: Number(c.recargo_pct) }))
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

/** Arranca listeners de conectividad + reintento periódico. Idempotente. */
export function startSyncEngine(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  useSyncStore.setState({ online: navigator.onLine });
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
