"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { cajaOlvidada, forceCloseCash, summarizeSession, type CashSummary } from "@/lib/ops";
import {
  CLAVE_CAJAS_REMOTAS,
  notifyOutboxChanged,
  type CajaAbiertaRemota,
} from "@/lib/sync/engine";
import { useSesion, esAdmin } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import { formatARS, formatARSSigned } from "@/lib/money";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAYMENT_LABELS, type CashSession, type PaymentMethod } from "@/types";

const timeFmt = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// "De hoy" = abierta hace menos de un turno largo. Con la fecha calendario,
// la caja del turno noche pasaba a "olvidada" a la medianoche.
const esDeHoy = (iso: string) => !cajaOlvidada({ opened_at: iso });

// Cada lugar (casa, foodtruck, PedidosYa) lleva su propia caja. Compartir
// arqueo haría que el descuadre de uno tape el del otro.
export default function CajaPage() {
  const usuario = useSesion((s) => s.usuario);
  const admin = esAdmin(usuario);
  const showToast = useUI((s) => s.showToast);
  const [cerrando, setCerrando] = useState<string | null>(null);
  const abiertas = useLiveQuery(
    () => db.cash_sessions.where("status").equals("abierta").toArray(),
    []
  );
  const canales = useLiveQuery(
    () => db.canales.orderBy("sort_order").toArray(),
    []
  );
  const closedSessions = useLiveQuery(
    () =>
      db.cash_sessions
        .orderBy("opened_at")
        .reverse()
        .filter((s) => s.status === "cerrada")
        .limit(10)
        .toArray(),
    []
  );

  // Cajas abiertas según el servidor, incluidas las de otros dispositivos
  const remotas = useLiveQuery(async () => {
    const fila = await db.meta.get(CLAVE_CAJAS_REMOTAS);
    if (!fila) return [] as CajaAbiertaRemota[];
    try {
      return JSON.parse(fila.value) as CajaAbiertaRemota[];
    } catch {
      return [] as CajaAbiertaRemota[];
    }
  }, []);

  const activos = useMemo(
    () => (canales ?? []).filter((c) => c.activo),
    [canales]
  );

  // Cajas de días anteriores que quedaron sin cerrar: no las cierro por mi
  // cuenta (habría que inventar cuánta plata había), pero no pueden pasar
  // desapercibidas. Se miran las del servidor para que también aparezcan las
  // que dejó abiertas otro equipo.
  const locales = useMemo(
    () => new Set((abiertas ?? []).map((s) => s.id)),
    [abiertas]
  );
  // Las del servidor y las de este equipo (que pueden no haber llegado todavía)
  const olvidadas = useMemo(() => {
    const porId = new Map<string, { local_uuid: string; canal_id: string | null; opened_at: string; opened_by: string | null }>();
    for (const r of remotas ?? []) porId.set(r.local_uuid, r);
    for (const a of abiertas ?? []) {
      porId.set(a.id, { local_uuid: a.id, canal_id: a.canal_id, opened_at: a.opened_at, opened_by: a.opened_by });
    }
    return [...porId.values()].filter((s) => !esDeHoy(s.opened_at));
  }, [remotas, abiertas]);

  const cerrarSinArqueo = async (id: string) => {
    const nota = window.prompt(
      "Se cierra sin contar la plata (queda marcada como “sin arqueo”). ¿Qué pasó con esta caja?",
      "Quedó abierta de otro día"
    );
    if (nota == null) return;
    setCerrando(id);
    try {
      await forceCloseCash({
        session_id: id,
        closed_by: usuario?.nombre ?? "",
        note: nota.trim() || "Quedó abierta de otro día",
      });
      notifyOutboxChanged();
      showToast("Caja cerrada sin arqueo");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo cerrar la caja.");
    } finally {
      setCerrando(null);
    }
  };
  const enOtroEquipo = useMemo(
    () => (remotas ?? []).filter((s) => !locales.has(s.local_uuid)),
    [remotas, locales]
  );

  if (abiertas === undefined || canales === undefined) {
    return (
      <>
        <PageHeader title="Caja" />
        <div className="p-4" aria-busy />
      </>
    );
  }

  const nombreCanal = (id: string | null) =>
    (canales ?? []).find((c) => c.id === id)?.nombre ?? "Caja";

  const abiertaDe = (canalId: string) =>
    abiertas.find((s) => s.canal_id === canalId) ??
    // Las cajas viejas no tenían canal: se muestran en el canal por defecto
    (activos.find((c) => c.es_default)?.id === canalId
      ? abiertas.find((s) => s.canal_id == null)
      : undefined);

  return (
    <>
      <PageHeader
        title="Caja"
        subtitle={
          abiertas.length === 0
            ? "Ninguna abierta"
            : `${abiertas.length} abierta${abiertas.length === 1 ? "" : "s"}`
        }
      />
      <div className="flex flex-col gap-4 p-4">
        {olvidadas.length > 0 ? (
          <div className="flex items-start gap-2 rounded-2xl border border-warning-600 bg-[#f7ecd8] p-4">
            <AlertTriangle
              size={18}
              className="mt-0.5 shrink-0 text-warning-600"
              aria-hidden
            />
            <div>
              <p className="text-sm font-bold text-ink-950">
                {olvidadas.length === 1
                  ? "Quedó una caja de otro día sin cerrar"
                  : `Quedaron ${olvidadas.length} cajas de otros días sin cerrar`}
              </p>
              <p className="mt-0.5 text-xs text-ink-700">
                {admin
                  ? "Mientras siga abierta, sus ventas no entran en ningún arqueo y no se puede abrir otra en ese lugar. Si está en este equipo, cerrala contando la plata. Si no, cerrala sin arqueo desde acá."
                  : "Mientras siga abierta, sus ventas no entran en ningún arqueo. Si está en este equipo, cerrala contando la plata; si no, avisale al dueño."}
              </p>
              <ul className="mt-2 flex flex-col gap-2 text-xs text-ink-700">
                {olvidadas.map((s) => (
                  <li key={s.local_uuid} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="tnum">
                      {nombreCanal(s.canal_id)} — {dateFmt.format(new Date(s.opened_at))}
                      {s.opened_by ? ` · ${s.opened_by}` : ""}
                    </span>
                    <span className="flex gap-2">
                      {locales.has(s.local_uuid) ? (
                        <Link href={`/caja/cerrar?id=${s.local_uuid}`}>
                          <Button size="sm" variant="secondary">
                            Contar y cerrar
                          </Button>
                        </Link>
                      ) : null}
                      {admin ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger-600"
                          disabled={cerrando === s.local_uuid}
                          onClick={() => void cerrarSinArqueo(s.local_uuid)}
                        >
                          Cerrar sin arqueo
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* Abierta en otro equipo: se avisa, pero sin totales — las ventas de
            ese equipo no están acá y un total incompleto engañaría. */}
        {enOtroEquipo.filter((s) => esDeHoy(s.opened_at)).length > 0 ? (
          <p className="rounded-2xl border border-[var(--border-soft)] bg-cream-100 px-4 py-3 text-xs text-ink-700">
            También hay caja abierta en otro dispositivo:{" "}
            {enOtroEquipo
              .filter((s) => esDeHoy(s.opened_at))
              .map((s) => nombreCanal(s.canal_id))
              .join(", ")}
            . Su arqueo se cierra desde ese equipo.
          </p>
        ) : null}

        {activos.length === 0 ? (
          <EmptyState
            title="No hay canales configurados"
            description="Los lugares de venta (foodtruck, casa, PedidosYa) se administran desde Configuración."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {activos.map((canal) => (
              <li key={canal.id}>
                <CajaDeCanal
                  nombre={canal.nombre}
                  canalId={canal.id}
                  session={abiertaDe(canal.id) ?? null}
                />
              </li>
            ))}
          </ul>
        )}

        {closedSessions && closedSessions.length > 0 ? (
          <HistoryList sessions={closedSessions} canales={canales} />
        ) : null}
      </div>
    </>
  );
}

function CajaDeCanal({
  nombre,
  canalId,
  session,
}: {
  nombre: string;
  canalId: string;
  session: CashSession | null;
}) {
  // resumen reactivo: se recalcula cuando cambian ventas, gastos o cobros
  const salesCount = useLiveQuery(() => db.sales.count(), []);
  const expensesCount = useLiveQuery(() => db.expenses.count(), []);
  const acctCount = useLiveQuery(() => db.account_movements.count(), []);
  const [summary, setSummary] = useState<CashSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (session) {
      void summarizeSession(session).then((s) => {
        if (!cancelled) setSummary(s);
      });
    } else {
      setSummary(null);
    }
    return () => {
      cancelled = true;
    };
  }, [session, salesCount, expensesCount, acctCount]);

  if (!session) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
        <div>
          <p className="text-sm font-bold text-ink-950">{nombre}</p>
          <p className="text-xs text-ink-700">Caja cerrada</p>
        </div>
        <Link href={`/caja/abrir?canal=${canalId}`}>
          <Button size="md">Abrir</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-brand-900 p-5 text-ink-inverse">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{nombre}</p>
          <p className="text-xs text-brand-100">
            Abierta{" "}
            {cajaOlvidada(session)
              ? `el ${dateFmt.format(new Date(session.opened_at))}`
              : timeFmt.format(new Date(session.opened_at))}{" "}
            · {session.opened_by}
          </p>
        </div>
        <Link href={`/caja/cerrar?id=${session.id}`}>
          <Button size="md" variant="gold">
            Cerrar
          </Button>
        </Link>
      </div>

      <p className="tnum mt-3 text-3xl font-bold">
        {summary ? formatARS(summary.salesTotal) : "…"}
      </p>
      <div className="tnum mt-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-brand-100">Ventas</p>
          <p className="font-bold">{summary?.salesCount ?? "…"}</p>
        </div>
        <div>
          <p className="text-brand-100">Efectivo esperado</p>
          <p className="font-bold">
            {summary ? formatARS(summary.expectedCash) : "…"}
          </p>
        </div>
      </div>

      {summary && summary.salesCount > 0 ? (
        <dl className="tnum mt-3 flex flex-col gap-1 border-t border-brand-700 pt-2 text-xs">
          {(Object.keys(summary.byMethod) as PaymentMethod[])
            .filter((m) => summary.byMethod[m] > 0)
            .map((m) => (
              <div key={m} className="flex justify-between">
                <dt className="text-brand-100">{PAYMENT_LABELS[m]}</dt>
                <dd className="font-bold">{formatARS(summary.byMethod[m])}</dd>
              </div>
            ))}
          {summary.cashExpenses > 0 ? (
            <div className="flex justify-between">
              <dt className="text-brand-100">Gastos en efectivo</dt>
              <dd className="font-bold">−{formatARS(summary.cashExpenses)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

function HistoryList({
  sessions,
  canales,
}: {
  sessions: CashSession[];
  canales: { id: string; nombre: string }[];
}) {
  const nombreDe = (id: string | null) =>
    id ? (canales.find((c) => c.id === id)?.nombre ?? "") : "";

  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
        Cierres anteriores
      </h2>
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link
              href={`/caja/historial/${s.id}`}
              className="flex items-center justify-between rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3"
            >
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-ink-950">
                  {dateFmt.format(new Date(s.opened_at))}
                  {nombreDe(s.canal_id) ? (
                    <Badge tone="muted">{nombreDe(s.canal_id)}</Badge>
                  ) : null}
                </p>
                <p className="text-xs text-ink-700">{s.closed_by ?? s.opened_by}</p>
              </div>
              <div className="text-right">
                <p className="tnum text-sm font-bold">
                  {s.sin_arqueo
                    ? "Sin arqueo"
                    : s.difference != null
                      ? formatARSSigned(s.difference)
                      : "—"}
                </p>
                <p className="text-xs text-ink-500">{s.sin_arqueo ? "cerrada por el dueño" : "diferencia"}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
