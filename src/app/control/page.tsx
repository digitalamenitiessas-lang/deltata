"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatARS, formatUnits } from "@/lib/money";
import { stockState } from "@/lib/stock-state";
import {
  CLAVE_CAJAS_REMOTAS,
  type CajaAbiertaRemota,
} from "@/lib/sync/engine";
import { useSesion } from "@/stores/sesion";
import { PageHeader } from "@/components/shell/AppShell";
import { PrimerosPasos } from "@/components/PrimerosPasos";
import { Badge } from "@/components/ui/Badge";

// El dashboard responde en segundos: cuánto se vendió, si la caja cerró bien,
// qué falta. Las cifras salen del motor local determinístico — acá no hay IA.

function todayStartISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function ControlPage() {
  const profileName = useSesion((s) => s.usuario?.nombre ?? "");

  const todaySales = useLiveQuery(
    () => db.sales.where("sold_at").aboveOrEqual(todayStartISO()).toArray(),
    []
  );
  const products = useLiveQuery(() => db.products.toArray(), []);
  // Del servidor, no sólo de este equipo: una caja que dejó abierta el otro
  // celular igual deja sus ventas fuera del arqueo.
  const cajasAbiertas = useLiveQuery(async () => {
    const fila = await db.meta.get(CLAVE_CAJAS_REMOTAS);
    if (!fila) return [] as CajaAbiertaRemota[];
    try {
      return JSON.parse(fila.value) as CajaAbiertaRemota[];
    } catch {
      return [] as CajaAbiertaRemota[];
    }
  }, []);
  const lastClosed = useLiveQuery(
    () =>
      db.cash_sessions
        .orderBy("opened_at")
        .reverse()
        .filter((s) => s.status === "cerrada")
        .first(),
    []
  );
  const recentCounts = useLiveQuery(async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    return db.stock_counts.where("counted_at").aboveOrEqual(weekAgo).toArray();
  }, []);
  const trackedIds = useLiveQuery(async () => {
    const [movKeys, countKeys] = await Promise.all([
      db.stock_movements.orderBy("product_id").uniqueKeys(),
      db.stock_counts.orderBy("product_id").uniqueKeys(),
    ]);
    return new Set([...movKeys, ...countKeys].map(String));
  }, []);

  const kpis = useMemo(() => {
    if (!todaySales || !products) return null;
    const total = todaySales.reduce((acc, s) => acc + s.total, 0);
    const units = todaySales.reduce(
      (acc, s) => acc + s.items.reduce((a, i) => a + i.qty, 0),
      0
    );
    const ticket = todaySales.length > 0 ? total / todaySales.length : null;

    // Margen: sólo con costos cargados; si faltan, se marca (trampa #3)
    const costById = new Map(products.map((p) => [p.id, p.cost_per_unit]));
    let cost = 0;
    const missingCostProducts = new Set<string>();
    for (const sale of todaySales) {
      for (const item of sale.items) {
        const c = costById.get(item.product_id);
        if (c == null) missingCostProducts.add(item.product_name);
        else cost += c * item.qty;
      }
    }
    // Costo faltante NO es costo $0: sin todos los costos, no hay margen (se
    // muestra "—" con la advertencia de integridad).
    const margin =
      total > 0 && missingCostProducts.size === 0
        ? ((total - cost) / total) * 100
        : null;

    return {
      total,
      units,
      ticket,
      salesCount: todaySales.length,
      margin,
      missingCost: missingCostProducts.size,
    };
  }, [todaySales, products]);

  // Radar determinístico: máx. 3 situaciones, cada una con acción
  const radar = useMemo(() => {
    const items: {
      severity: "alta" | "media";
      area: string;
      text: string;
      href: string;
    }[] = [];
    const enElMinimo: string[] = [];

    for (const p of products ?? []) {
      const st = stockState(p, trackedIds?.has(p.id) ?? false);
      if (st === "negativo") {
        items.push({
          severity: "alta",
          area: "Stock",
          text: `${p.name} tiene stock negativo (${formatUnits(p.current_qty)}): hay ventas sin stock que las respalde.`,
          href: "/stock",
        });
      } else if (st === "sin_stock") {
        items.push({
          severity: "alta",
          area: "Stock",
          text: `${p.name} está en cero: no se puede vender hasta reponer.`,
          href: "/stock",
        });
      } else if (st === "critico") {
        items.push({
          severity: "media",
          area: "Stock",
          text: `${p.name} está crítico: quedan ${formatUnits(p.current_qty)} (mínimo ${formatUnits(p.min_qty ?? 0)}).`,
          href: "/stock",
        });
      } else if (st === "bajo") {
        enElMinimo.push(p.name);
      }
    }

    // El mínimo avisa ANTES de quedarse sin nada, pero agrupado: doce avisos
    // de "llegó al mínimo" taparían el cierre de caja descuadrado.
    if (enElMinimo.length > 0) {
      items.push({
        severity: "media",
        area: "Stock",
        text:
          enElMinimo.length === 1
            ? `${enElMinimo[0]} llegó al mínimo: conviene reponer.`
            : `${enElMinimo.length} productos llegaron al mínimo: ${enElMinimo.slice(0, 3).join(", ")}${enElMinimo.length > 3 ? " y otros" : ""}.`,
        href: "/stock",
      });
    }

    // Una caja de otro día que sigue abierta no entra en ningún arqueo: sus
    // ventas quedan fuera del control hasta que alguien la cierre.
    const hoy = new Date().toDateString();
    const viejasAbiertas = (cajasAbiertas ?? []).filter(
      (s) => new Date(s.opened_at).toDateString() !== hoy
    );
    if (viejasAbiertas.length > 0) {
      items.push({
        severity: "alta",
        area: "Caja",
        text:
          viejasAbiertas.length === 1
            ? "Quedó una caja de otro día sin cerrar: sus ventas no entran en ningún arqueo."
            : `Quedaron ${viejasAbiertas.length} cajas de otros días sin cerrar: sus ventas no entran en ningún arqueo.`,
        href: "/caja",
      });
    }

    if (lastClosed?.difference != null && lastClosed.difference !== 0) {
      items.push({
        severity: Math.abs(lastClosed.difference) >= 5000 ? "alta" : "media",
        area: "Caja",
        text: `La diferencia del último cierre fue de ${formatARS(lastClosed.difference)}.`,
        href: `/caja/historial/${lastClosed.id}`,
      });
    }

    for (const c of recentCounts ?? []) {
      if (Math.abs(c.diff) >= 5) {
        const name =
          (products ?? []).find((p) => p.id === c.product_id)?.name ?? "un producto";
        items.push({
          severity: "alta",
          area: "Stock",
          text: `El conteo de ${name} dio ${c.diff > 0 ? "+" : ""}${formatUnits(c.diff)} contra el sistema.`,
          href: "/stock/movimientos",
        });
      }
    }

    const order = { alta: 0, media: 1 };
    return items.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 3);
  }, [products, lastClosed, recentCounts, trackedIds, cajasAbiertas]);

  // Ventas por hora (hoy) — SVG liviano
  const hourly = useMemo(() => {
    const buckets = new Array<number>(24).fill(0);
    for (const s of todaySales ?? []) {
      buckets[new Date(s.sold_at).getHours()] += s.total;
    }
    const max = Math.max(...buckets);
    return { buckets, max };
  }, [todaySales]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <>
      <PageHeader title="Control" subtitle={`${greeting}, ${profileName}`} />
      <div className="flex flex-col gap-4 p-4">
        {/* Mientras la puesta en marcha esté incompleta, va primero */}
        <PrimerosPasos />

        <section className="rounded-3xl bg-brand-900 p-5 text-ink-inverse">
          <p className="text-sm text-brand-100">
            {kpis && kpis.salesCount > 0
              ? `Hoy vendiste ${formatARS(kpis.total)}.`
              : "Hoy todavía no hay ventas registradas."}
            {radar.length > 0
              ? ` Hay ${radar.length} ${radar.length === 1 ? "situación" : "situaciones"} para revisar.`
              : ""}
          </p>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <KpiCard
            label="Ventas de hoy"
            value={kpis ? formatARS(kpis.total) : "…"}
            detail={kpis ? `${kpis.salesCount} ${kpis.salesCount === 1 ? "venta" : "ventas"}` : ""}
          />
          <KpiCard
            label="Unidades"
            value={kpis ? formatUnits(kpis.units) : "…"}
            detail="vendidas hoy"
          />
          <KpiCard
            label="Ticket promedio"
            value={
              kpis
                ? kpis.ticket != null
                  ? formatARS(Math.round(kpis.ticket))
                  : "Sin ventas"
                : "…"
            }
            detail="hoy"
          />
          <KpiCard
            label="Margen"
            value={
              kpis
                ? kpis.margin != null
                  ? `${kpis.margin.toFixed(1).replace(".", ",")}%`
                  : "—"
                : "…"
            }
            detail=""
            warning={
              kpis && kpis.missingCost > 0
                ? `Costo incompleto en ${kpis.missingCost} ${kpis.missingCost === 1 ? "producto" : "productos"}`
                : kpis && kpis.margin == null && kpis.salesCount > 0
                  ? "Sin costos cargados"
                  : undefined
            }
          />
        </section>

        <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-500">
              Radar del negocio
            </h2>
          </div>
          {radar.length === 0 ? (
            <p className="text-sm text-ink-700">
              Sin situaciones detectadas con los datos cargados hasta ahora.
              {(recentCounts ?? []).length === 0
                ? " Ojo: sin conteos físicos, el radar de stock no puede ver faltantes."
                : ""}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {radar.map((item, i) => (
                <li key={i}>
                  <Link
                    href={item.href}
                    className="flex flex-col gap-1 rounded-2xl border border-[var(--border-soft)] bg-cream-100 p-3"
                  >
                    <span className="flex items-center gap-2">
                      <Badge tone={item.severity === "alta" ? "danger" : "warn"}>
                        {item.severity === "alta" ? "Alta" : "Media"}
                      </Badge>
                      <span className="text-xs font-bold text-ink-500">{item.area}</span>
                    </span>
                    <span className="text-sm font-bold text-ink-950">{item.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">
            Ventas por hora · hoy
          </h2>
          {hourly.max === 0 ? (
            <p className="text-sm text-ink-700">
              Cuando haya ventas, acá se ve en qué franja se concentra la demanda.
            </p>
          ) : (
            <>
              <svg
                viewBox="0 0 240 64"
                className="mt-2 w-full"
                role="img"
                aria-label={`Ventas por hora de hoy. Pico a las ${hourly.buckets.indexOf(hourly.max)} horas con ${formatARS(hourly.max)}.`}
              >
                {hourly.buckets.map((v, h) => {
                  const barH = hourly.max > 0 ? (v / hourly.max) * 52 : 0;
                  const isPeak = v === hourly.max && v > 0;
                  return (
                    <rect
                      key={h}
                      x={h * 10 + 1}
                      y={56 - barH}
                      width={8}
                      height={Math.max(barH, v > 0 ? 2 : 0)}
                      rx={2}
                      fill={isPeak ? "var(--gold-500)" : "var(--brand-700)"}
                    />
                  );
                })}
                {[0, 6, 12, 18].map((h) => (
                  <text
                    key={h}
                    x={h * 10 + 4}
                    y={63}
                    fontSize="6"
                    fill="var(--ink-500)"
                    textAnchor="middle"
                  >
                    {h}h
                  </text>
                ))}
              </svg>
              <p className="mt-1 text-xs text-ink-500">
                Pico: {hourly.buckets.indexOf(hourly.max)}:00 ·{" "}
                {formatARS(hourly.max)}
              </p>
            </>
          )}
        </section>

        <p className="text-center text-xs text-ink-500">
          Análisis de anomalías avanzado y sugerencias con IA: próxima fase, cuando
          haya historial suficiente de ventas y conteos.
        </p>
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  detail,
  warning,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-surface-card p-3">
      <p className="text-xs text-ink-700">{label}</p>
      <p className="tnum text-2xl font-bold text-ink-950">{value}</p>
      {warning ? (
        <p className="text-xs font-bold text-warning-600">{warning}</p>
      ) : detail ? (
        <p className="text-xs text-ink-500">{detail}</p>
      ) : null}
    </div>
  );
}
