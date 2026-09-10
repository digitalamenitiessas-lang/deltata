"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCircle } from "lucide-react";
import { db } from "@/lib/db";
import { formatARS, formatUnits } from "@/lib/money";
import { PageHeader } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ReciboSheet } from "@/components/sale/ReciboSheet";
import { PAYMENT_LABELS, type Sale } from "@/types";

interface Event {
  id: string;
  at: string;
  kind: string;
  tone: BadgeTone;
  text: string;
  who: string;
  /** la venta original, para poder reenviar el recibo si el cliente lo pide */
  sale?: Sale;
}

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// Auditoría de sólo lectura: qué pasó, quién, cuándo. Nada se edita desde acá.
export default function HistorialPage() {
  const [recibo, setRecibo] = useState<Sale | null>(null);
  const sales = useLiveQuery(
    () => db.sales.orderBy("sold_at").reverse().limit(60).toArray(),
    []
  );
  const sessions = useLiveQuery(
    () => db.cash_sessions.orderBy("opened_at").reverse().limit(20).toArray(),
    []
  );
  const expenses = useLiveQuery(
    () => db.expenses.orderBy("spent_at").reverse().limit(40).toArray(),
    []
  );
  const counts = useLiveQuery(
    () => db.stock_counts.orderBy("counted_at").reverse().limit(40).toArray(),
    []
  );
  const movements = useLiveQuery(
    () => db.stock_movements.orderBy("moved_at").reverse().limit(60).toArray(),
    []
  );
  const products = useLiveQuery(() => db.products.toArray(), []);

  const events = useMemo(() => {
    const nameById = new Map((products ?? []).map((p) => [p.id, p.name]));
    const all: Event[] = [];

    for (const s of sales ?? []) {
      all.push({
        id: `sale-${s.id}`,
        at: s.sold_at,
        kind: "Venta",
        tone: "brand",
        text: `${formatARS(s.total)} · ${PAYMENT_LABELS[s.payment_method]}`,
        who: s.sold_by,
        sale: s,
      });
    }
    for (const c of sessions ?? []) {
      all.push({
        id: `open-${c.id}`,
        at: c.opened_at,
        kind: "Apertura de caja",
        tone: "info",
        text: `Fondo inicial ${formatARS(c.opening_float)}`,
        who: c.opened_by,
      });
      if (c.closed_at) {
        all.push({
          id: `close-${c.id}`,
          at: c.closed_at,
          kind: "Cierre de caja",
          tone: c.difference === 0 ? "ok" : "warn",
          text:
            c.difference != null
              ? `Diferencia ${formatARS(c.difference)}`
              : "Cerrada",
          who: c.closed_by ?? c.opened_by,
        });
      }
    }
    for (const e of expenses ?? []) {
      all.push({
        id: `exp-${e.id}`,
        at: e.spent_at,
        kind: "Gasto",
        tone: "muted",
        text: `${e.description} · −${formatARS(e.amount)}`,
        who: e.created_by,
      });
    }
    for (const c of counts ?? []) {
      all.push({
        id: `count-${c.id}`,
        at: c.counted_at,
        kind: "Conteo físico",
        tone: c.diff === 0 ? "ok" : "danger",
        text: `${nameById.get(c.product_id) ?? "Producto"}: contado ${formatUnits(c.counted_qty)}, diferencia ${c.diff > 0 ? "+" : ""}${formatUnits(c.diff)}`,
        who: c.counted_by,
      });
    }
    for (const m of movements ?? []) {
      if (m.type === "venta" || m.type === "conteo") continue; // ya cubiertos
      all.push({
        id: `mov-${m.id}`,
        at: m.moved_at,
        kind: m.type === "merma" ? "Merma" : m.type === "compra" ? "Entrada" : "Ajuste",
        tone: m.type === "merma" ? "danger" : "muted",
        text: `${nameById.get(m.product_id) ?? "Producto"}: ${m.qty > 0 ? "+" : ""}${formatUnits(m.qty)}${m.reason ? ` · ${m.reason}` : ""}`,
        who: m.created_by,
      });
    }

    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 120);
  }, [sales, sessions, expenses, counts, movements, products]);

  return (
    <>
      <PageHeader title="Historial" subtitle="Auditoría de eventos" />
      <div className="flex flex-col gap-2 p-4">
        {events.length === 0 ? (
          <EmptyState
            title="Todavía no hay eventos"
            description="Cada venta, cierre, conteo, merma y gasto queda registrado acá con su responsable y su hora real."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={e.tone}>{e.kind}</Badge>
                    <span className="text-xs text-ink-500">
                      {dateFmt.format(new Date(e.at))}
                      {e.who ? ` · ${e.who}` : ""}
                    </span>
                  </div>
                  <p className="tnum mt-1 truncate text-sm font-bold text-ink-950">
                    {e.text}
                  </p>
                </div>
                {e.sale ? (
                  <button
                    type="button"
                    aria-label={`Mandar el recibo de la venta de ${formatARS(e.sale.total)}`}
                    onClick={() => setRecibo(e.sale ?? null)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border-soft)] text-brand-900 active:bg-cream-100"
                  >
                    <MessageCircle size={18} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ReciboSheet sale={recibo} onClose={() => setRecibo(null)} />
    </>
  );
}
