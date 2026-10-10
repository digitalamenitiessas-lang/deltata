"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { notifyOutboxChanged, useSyncStore } from "@/lib/sync/engine";
import { useUI } from "@/stores/ui";
import { Button } from "@/components/ui/Button";
import type { OpRechazada, SyncOpKind } from "@/types";

const QUE_ERA: Partial<Record<SyncOpKind, string>> = {
  sale: "Venta",
  expense: "Gasto",
  open_cash: "Apertura de caja",
  close_cash: "Cierre de caja",
  force_close_cash: "Cierre sin arqueo",
  stock_count: "Conteo",
  stock_move: "Movimiento de stock",
  transfer_stock: "Traslado",
  customer_payment: "Cobro de cuenta corriente",
  upsert_customer: "Cliente",
  upsert_pedido: "Pedido",
  upsert_product: "Producto",
  delete_product: "Baja de producto",
  upsert_canal: "Canal",
  upsert_canal_precio: "Precio por canal",
  upsert_promo: "Promo",
  delete_promo: "Baja de promo",
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Estado de la sincronización y lo que el servidor no aceptó. Lo rechazado
 * ya no traba la cola: queda acá y en la Auditoría del dueño, con el motivo.
 */
export function PanelSync({ admin }: { admin: boolean }) {
  const { pending, lastError, lastSyncAt } = useSyncStore();
  const showToast = useUI((s) => s.showToast);
  const rechazadas = useLiveQuery(
    () => db.rechazadas.orderBy("rechazada_en").reverse().toArray(),
    []
  );

  const reintentar = async (r: OpRechazada) => {
    await db.transaction("rw", db.outbox, db.rechazadas, async () => {
      await db.outbox.add({
        kind: r.kind,
        entity_id: r.entity_id,
        payload: r.payload,
        created_at: r.created_at,
        tries: 0,
        last_error: null,
        autor: r.autor,
      });
      await db.rechazadas.delete(r.id!);
    });
    notifyOutboxChanged();
    showToast("Se vuelve a enviar");
  };

  const descartar = async (r: OpRechazada) => {
    const que = QUE_ERA[r.kind] ?? r.kind;
    if (
      !window.confirm(
        `¿Descartar este ${que.toLowerCase()}? Ya quedó registrado en la Auditoría con todos sus datos; acá deja de figurar.`
      )
    )
      return;
    await db.rechazadas.delete(r.id!);
    notifyOutboxChanged();
  };

  return (
    <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
      <h2 className="text-sm font-bold text-ink-950">Sincronización</h2>
      <p className="mt-1 text-xs text-ink-700">
        {pending > 0
          ? `${pending} ${pending === 1 ? "operación espera" : "operaciones esperan"} para enviarse.`
          : "Todo lo de este equipo está en el servidor."}
        {lastSyncAt ? ` Última vez: ${fecha(lastSyncAt)}.` : ""}
      </p>
      {lastError && pending > 0 ? (
        <p className="mt-2 rounded-xl bg-[#f8e5e4] px-3 py-2 text-xs font-bold text-danger-600">
          {lastError}
        </p>
      ) : null}

      {(rechazadas ?? []).length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="flex items-center gap-1 text-xs font-bold text-danger-600">
            <AlertTriangle size={14} aria-hidden />
            El servidor no aceptó {rechazadas!.length}{" "}
            {rechazadas!.length === 1 ? "operación" : "operaciones"}
          </p>
          <ul className="flex flex-col gap-2">
            {rechazadas!.map((r) => (
              <li key={r.id} className="rounded-2xl border border-danger-600/30 bg-[#fbf1f0] p-3">
                <p className="text-sm font-bold text-ink-950">
                  {QUE_ERA[r.kind] ?? r.kind}
                  <span className="font-normal text-ink-700">
                    {" "}
                    · {fecha(r.created_at)}
                    {r.autor ? ` · ${r.autor}` : ""}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink-700">{r.motivo}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void reintentar(r)}>
                    Reintentar
                  </Button>
                  {admin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger-600"
                      onClick={() => void descartar(r)}
                    >
                      Descartar
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {!admin ? (
            <p className="text-xs text-ink-500">Avisale al dueño: lo ve en la Auditoría.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
