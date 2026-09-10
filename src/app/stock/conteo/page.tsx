"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Check } from "lucide-react";
import { db } from "@/lib/db";
import { recordCount } from "@/lib/ops";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { formatARS, formatUnits } from "@/lib/money";
import { useSesion } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { Product } from "@/types";

// Conteo a ciegas: NUNCA se muestra el stock teórico antes de registrar el
// físico. Cada conteo se guarda al confirmarse: pausar no pierde nada.

const NOTE_THRESHOLD = 5; // unidades de diferencia que exigen nota

interface CountResult {
  product: Product;
  system: number;
  counted: number;
  diff: number;
  impact: number | null;
}

export default function ConteoPage() {
  const router = useRouter();
  const profileName = useSesion((s) => s.usuario?.nombre ?? "");
  const showToast = useUI((s) => s.showToast);
  const setHideNav = useUI((s) => s.setHideNav);

  const [active, setActive] = useState<Product | null>(null);
  const [countedRaw, setCountedRaw] = useState("");
  const [note, setNote] = useState("");
  const [pendingResult, setPendingResult] = useState<CountResult | null>(null);
  const [sessionResults, setSessionResults] = useState<CountResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHideNav(true);
    return () => setHideNav(false);
  }, [setHideNav]);

  const products = useLiveQuery(
    () => db.products.orderBy("sort_order").toArray(),
    []
  );

  const countedToday = useLiveQuery(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await db.stock_counts
      .where("counted_at")
      .aboveOrEqual(start.toISOString())
      .toArray();
    return new Set(rows.map((r) => r.product_id));
  }, []);

  const activeProducts = useMemo(
    () => (products ?? []).filter((p) => p.is_active),
    [products]
  );
  const doneCount = activeProducts.filter((p) => countedToday?.has(p.id)).length;

  const counted = Number(countedRaw.replace(/[^\d]/g, ""));
  const needsNote =
    pendingResult != null &&
    Math.abs(pendingResult.diff) >= NOTE_THRESHOLD &&
    note.trim() === "";

  // Paso de resultado: mostrar diferencia + impacto tras confirmar el número
  if (pendingResult) {
    const r = pendingResult;
    return (
      <>
        <PageHeader title="Conteo físico" subtitle={r.product.name} />
        <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
          <section
            className={`rounded-3xl border p-4 ${
              r.diff === 0
                ? "border-success-600/40 bg-[#e5f2e9]"
                : "border-danger-600/40 bg-[#f8e5e4]"
            }`}
          >
            <dl className="tnum flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt>Sistema</dt>
                <dd className="font-bold">{formatUnits(r.system)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Contado</dt>
                <dd className="font-bold">{formatUnits(r.counted)}</dd>
              </div>
              <div className="flex justify-between text-base">
                <dt className="font-bold">Diferencia</dt>
                <dd className={`font-bold ${r.diff === 0 ? "text-success-600" : "text-danger-600"}`}>
                  {r.diff > 0 ? `+${formatUnits(r.diff)}` : formatUnits(r.diff)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Impacto estimado</dt>
                <dd className="font-bold">
                  {r.diff === 0
                    ? "—"
                    : r.impact != null
                      ? formatARS(Math.abs(r.impact))
                      : "Sin costo cargado"}
                </dd>
              </div>
            </dl>
          </section>

          {Math.abs(r.diff) >= NOTE_THRESHOLD ? (
            <div>
              <label
                htmlFor="count-note"
                className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700"
              >
                Nota (obligatoria: la diferencia es grande)
              </label>
              <textarea
                id="count-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                autoFocus
                className="w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 py-2 text-sm outline-none focus:border-brand-700"
              />
            </div>
          ) : null}

          <Button
            size="lg"
            disabled={busy || needsNote}
            onClick={async () => {
              setBusy(true);
              try {
                await recordCount({
                  product_id: r.product.id,
                  counted_qty: r.counted,
                  note: note || undefined,
                  counted_by: profileName,
                });
                notifyOutboxChanged();
                setSessionResults((prev) => [...prev, r]);
                setPendingResult(null);
                setNote("");
                setCountedRaw("");
                setActive(null);
                showToast(`Conteo guardado: ${r.product.name}`);
              } catch (err) {
                showToast(
                  err instanceof Error && err.message
                    ? `No se guardó el conteo: ${err.message}`
                    : "No se guardó el conteo. Reintentá."
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Guardar y seguir
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setPendingResult(null);
              setNote("");
            }}
          >
            Corregir el número
          </Button>
        </div>
      </>
    );
  }

  // Paso de ingreso: sólo se pregunta cuántas hay físicamente
  if (active) {
    return (
      <>
        <PageHeader title="Conteo físico" subtitle={`${doneCount} de ${activeProducts.length} contados hoy`} />
        <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
          <div className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-5 text-center">
            <p className="text-lg font-bold text-ink-950">{active.name}</p>
            <p className="mt-1 text-sm text-ink-700">
              ¿Cuántas unidades hay físicamente?
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={countedRaw}
              onChange={(e) => setCountedRaw(e.target.value.replace(/[^\d]/g, ""))}
              autoFocus
              aria-label={`Unidades físicas de ${active.name}`}
              className="tnum mx-auto mt-4 h-20 w-40 rounded-2xl border-2 border-[var(--border-strong)] bg-surface-elevated text-center text-4xl font-bold outline-none focus:border-brand-700"
            />
          </div>
          <Button
            size="lg"
            disabled={countedRaw === ""}
            onClick={() => {
              const system = active.current_qty;
              const diff = counted - system;
              setPendingResult({
                product: active,
                system,
                counted,
                diff,
                impact:
                  active.cost_per_unit != null ? diff * active.cost_per_unit : null,
              });
            }}
          >
            Confirmar conteo
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setActive(null);
              setCountedRaw("");
            }}
          >
            Elegir otro producto
          </Button>
        </div>
      </>
    );
  }

  // Selección de producto a contar
  return (
    <>
      <PageHeader
        title="Conteo físico"
        subtitle={`${doneCount} de ${activeProducts.length} contados hoy`}
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-ink-700">
          Elegí un producto y contá lo físico. El sistema no te muestra el
          teórico hasta que confirmes — así el conteo vale.
        </p>
        <ul className="flex flex-col gap-2">
          {activeProducts.map((p) => {
            const done = countedToday?.has(p.id) ?? false;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setActive(p)}
                  className="flex w-full items-center justify-between rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3 text-left active:bg-cream-100"
                >
                  <span className="text-sm font-bold text-ink-950">{p.name}</span>
                  {done ? (
                    <Badge tone="ok">
                      <Check size={12} /> Contado hoy
                    </Badge>
                  ) : (
                    <Badge tone="muted">Pendiente</Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {sessionResults.length > 0 ? (
          <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
              Diferencias de esta sesión
            </h2>
            <ul className="tnum flex flex-col gap-1 text-sm">
              {sessionResults.map((r) => (
                <li key={r.product.id} className="flex justify-between">
                  <span className="text-ink-700">{r.product.name}</span>
                  <span
                    className={`font-bold ${
                      r.diff === 0 ? "text-success-600" : "text-danger-600"
                    }`}
                  >
                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Button variant="secondary" size="lg" onClick={() => router.push("/stock")}>
          Terminar conteo
        </Button>
      </div>
    </>
  );
}
