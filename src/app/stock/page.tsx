"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRightLeft, ClipboardList, History } from "lucide-react";
import { db } from "@/lib/db";
import { recordStockMove, transferStock, updateProduct } from "@/lib/ops";
import { UBICACION_FOODTRUCK } from "@/lib/lugar";
import { useEquipo } from "@/stores/equipo";
import { LugarTabs } from "@/components/stock/LugarTabs";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { formatARS, formatUnits } from "@/lib/money";
import { stockState, STOCK_STATE_LABELS, type StockState } from "@/lib/stock-state";
import { useSesion, esAdmin } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import type { Product, Ubicacion } from "@/types";

const stateTones: Record<StockState, BadgeTone> = {
  negativo: "danger",
  sin_stock: "danger",
  critico: "danger",
  bajo: "warn",
  normal: "ok",
  sin_minimo: "muted",
  nunca_contado: "muted",
  inactivo: "muted",
};

type Filter = "todos" | "empanada" | "bebida" | "criticos" | "sin_contar";

export default function StockPage() {
  const usuario = useSesion((s) => s.usuario);
  const profileName = usuario?.nombre ?? "";
  const admin = esAdmin(usuario);
  const showToast = useUI((s) => s.showToast);
  const [filter, setFilter] = useState<Filter>("todos");
  const [selected, setSelected] = useState<Product | null>(null);
  const ubicacionEquipo = useEquipo((s) => s.ubicacionId);
  // undefined = todavía no se tocó: arranca en el lugar de este equipo
  const [lugarElegido, setLugarElegido] = useState<string | null | undefined>(undefined);
  const ubicaciones = useLiveQuery(() => db.ubicaciones.orderBy("sort_order").toArray(), []);
  const lugar: string | null =
    lugarElegido !== undefined ? lugarElegido : (ubicacionEquipo ?? UBICACION_FOODTRUCK);
  const porLugar = useLiveQuery(
    async () =>
      lugar
        ? new Map(
            (await db.stock_ubic.where("ubicacion_id").equals(lugar).toArray()).map((r) => [
              r.product_id,
              r.qty,
            ])
          )
        : null,
    [lugar]
  );
  const qtyDe = (p: Product) => (porLugar ? (porLugar.get(p.id) ?? 0) : p.current_qty);
  const nombreLugar = (ubicaciones ?? []).find((u) => u.id === lugar)?.nombre ?? null;

  const products = useLiveQuery(
    () => db.products.orderBy("sort_order").toArray(),
    []
  );
  const trackedIds = useLiveQuery(async () => {
    // stock_ubic tiene una fila por cada producto que alguna vez se movió
    // (viene del servidor con TODA la historia; el historial local es parcial)
    const [movKeys, countKeys, lugarKeys] = await Promise.all([
      db.stock_movements.orderBy("product_id").uniqueKeys(),
      db.stock_counts.orderBy("product_id").uniqueKeys(),
      db.stock_ubic.orderBy("product_id").uniqueKeys(),
    ]);
    return new Set([...movKeys, ...countKeys, ...lugarKeys].map(String));
  }, []);
  const lastCount = useLiveQuery(
    async () => {
      const todos = await db.stock_counts.orderBy("counted_at").reverse().toArray();
      return lugar
        ? todos.find((c) => (c.ubicacion_id ?? UBICACION_FOODTRUCK) === lugar)
        : todos[0];
    },
    [lugar]
  );

  const rows = useMemo(() => {
    return (products ?? [])
      .filter((p) => p.is_active)
      .map((p) => {
        const qty = porLugar ? (porLugar.get(p.id) ?? 0) : p.current_qty;
        return {
          product: p,
          qty,
          state: stockState(p, trackedIds?.has(p.id) ?? false, qty),
        };
      });
  }, [products, trackedIds, porLugar]);

  const visible = rows.filter(({ product, state }) => {
    if (filter === "todos") return true;
    if (filter === "empanada" || filter === "bebida") return product.kind === filter;
    if (filter === "criticos")
      return state === "critico" || state === "negativo" || state === "sin_stock";
    if (filter === "sin_contar") return state === "nunca_contado";
    return true;
  });

  const totalUnits = rows
    .filter((r) => r.state !== "nunca_contado")
    .reduce((acc, r) => acc + Math.max(0, r.qty), 0);
  const criticalCount = rows.filter(
    (r) => r.state === "critico" || r.state === "negativo"
  ).length;
  const neverCounted = rows.filter((r) => r.state === "nunca_contado").length;
  const noMin = rows.filter((r) => r.state === "sin_minimo").length;

  const productsWithCost = rows.filter((r) => r.product.cost_per_unit != null);
  const missingCost = rows.length - productsWithCost.length;
  const stockValue = productsWithCost.reduce(
    (acc, r) => acc + Math.max(0, r.qty) * (r.product.cost_per_unit ?? 0),
    0
  );

  return (
    <>
      <PageHeader
        title="Stock"
        action={
          <Link href="/stock/movimientos" aria-label="Movimientos">
            <Button variant="secondary" size="md">
              <History size={16} />
            </Button>
          </Link>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <LugarTabs
          ubicaciones={ubicaciones ?? []}
          valor={lugar}
          onChange={setLugarElegido}
          conTotal={admin}
        />
        {/* El que atiende cuenta a ciegas: si viera el número del sistema, el
            conteo podría "coincidir" sin que nadie cuente de verdad. */}
        {admin ? (
        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-[var(--border-soft)] bg-surface-card p-3">
            <p className="text-xs text-ink-700">Unidades en stock</p>
            <p className="tnum text-2xl font-bold text-ink-950">
              {formatUnits(totalUnits)}
            </p>
            {neverCounted > 0 ? (
              <p className="text-xs text-warning-600">
                {neverCounted} sin contar nunca
              </p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-[var(--border-soft)] bg-surface-card p-3">
            <p className="text-xs text-ink-700">Valor estimado</p>
            <p className="tnum text-2xl font-bold text-ink-950">
              {productsWithCost.length > 0 ? formatARS(stockValue) : "—"}
            </p>
            {missingCost > 0 ? (
              <p className="text-xs text-warning-600">
                Incompleto: {missingCost} sin costo cargado
              </p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-[var(--border-soft)] bg-surface-card p-3">
            <p className="text-xs text-ink-700">Críticos</p>
            <p className="tnum text-2xl font-bold text-danger-600">{criticalCount}</p>
            {noMin > 0 ? (
              <p className="text-xs text-ink-500">{noMin} sin mínimo definido</p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-[var(--border-soft)] bg-surface-card p-3">
            <p className="text-xs text-ink-700">Último conteo</p>
            <p className="text-sm font-bold text-ink-950">
              {lastCount
                ? new Intl.DateTimeFormat("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(lastCount.counted_at))
                : "Nunca se hizo un conteo"}
            </p>
          </div>
        </section>
        ) : null}

        <Link href={lugar ? `/stock/conteo?lugar=${lugar}` : "/stock/conteo"}>
          <Button size="lg" className="w-full">
            <ClipboardList size={18} /> Hacer conteo físico
            {nombreLugar ? ` · ${nombreLugar}` : ""}
          </Button>
        </Link>

        <div className="flex gap-2 overflow-x-auto">
          {(
            [
              ["todos", "Todos"],
              ["empanada", "Empanadas"],
              ["bebida", "Bebidas"],
              ["criticos", "Críticos"],
              ["sin_contar", "Sin contar"],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`h-11 shrink-0 rounded-full px-4 text-sm font-bold ${
                filter === id
                  ? "bg-brand-900 text-ink-inverse"
                  : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <ul className="flex flex-col gap-2">
          {visible.map(({ product, state, qty }) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => setSelected(product)}
                className="flex w-full items-center justify-between gap-2 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3 text-left active:bg-cream-100"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink-950">
                    {product.name}
                  </p>
                  {admin ? (
                    <p className="text-xs text-ink-700">
                      {product.min_qty != null
                        ? `Mínimo ${formatUnits(product.min_qty)}`
                        : "Sin mínimo definido"}
                      {" · "}
                      {product.cost_per_unit != null
                        ? `Costo ${formatARS(product.cost_per_unit)}`
                        : "Costo no cargado"}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {admin ? (
                    <span className="tnum text-xl font-bold text-ink-950">
                      {state === "nunca_contado" ? "—" : formatUnits(qty)}
                    </span>
                  ) : null}
                  <Badge tone={stateTones[state]}>{STOCK_STATE_LABELS[state]}</Badge>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ProductSheet
        product={selected}
        onClose={() => setSelected(null)}
        profileName={profileName}
        showToast={showToast}
        admin={admin}
        lugar={lugar}
        qty={selected ? qtyDe(selected) : 0}
        ubicaciones={ubicaciones ?? []}
      />
    </>
  );
}

function ProductSheet({
  product,
  onClose,
  profileName,
  showToast,
  admin,
  lugar,
  qty: qtyLugar,
  ubicaciones,
}: {
  product: Product | null;
  onClose: () => void;
  profileName: string;
  showToast: (m: string) => void;
  admin: boolean;
  /** dónde ocurre el movimiento; null = vista "Total" (no se mueve nada ahí) */
  lugar: string | null;
  qty: number;
  ubicaciones: Ubicacion[];
}) {
  const [mode, setMode] = useState<
    "menu" | "compra" | "merma" | "ajuste" | "minimo" | "traslado"
  >("menu");
  const [destino, setDestino] = useState<string | null>(null);
  const [qtyRaw, setQtyRaw] = useState("");
  const [reason, setReason] = useState("");
  const [minRaw, setMinRaw] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setMode("menu");
    setQtyRaw("");
    setReason("");
    setMinRaw("");
    setDestino(null);
    setBusy(false);
    onClose();
  };
  const nombreDe = (id: string | null) => ubicaciones.find((u) => u.id === id)?.nombre ?? "";
  const otros = ubicaciones.filter((u) => u.activo && u.id !== lugar);
  const hacia = destino ?? otros[0]?.id ?? null;

  if (!product) return null;
  const qty = Number(qtyRaw.replace(/[^\d]/g, "")) || 0;
  // ajuste: entero con signo opcional al inicio, distinto de cero
  const adjustValid = /^-?\d+$/.test(qtyRaw) && Number(qtyRaw) !== 0;

  const submitMove = async (type: "compra" | "merma" | "ajuste", signedQty: number) => {
    if (busy || !lugar) return;
    setBusy(true);
    try {
      await recordStockMove({
        ubicacion_id: lugar,
        product_id: product.id,
        type,
        qty: signedQty,
        reason:
          reason ||
          (type === "compra" ? "Entrada de mercadería" : type === "merma" ? "Merma" : "Ajuste"),
        created_by: profileName,
      });
      notifyOutboxChanged();
      showToast(
        type === "compra"
          ? `Entrada registrada: +${qty} ${product.name}`
          : type === "merma"
            ? `Merma registrada: −${qty} ${product.name}`
            : `Ajuste registrado: ${signedQty > 0 ? "+" : ""}${signedQty} ${product.name}`
      );
      close();
    } catch (err) {
      setBusy(false);
      showToast(
        err instanceof Error && err.message
          ? `No se registró: ${err.message}`
          : "No se registró el movimiento. Reintentá."
      );
    }
  };

  return (
    <Sheet open={product != null} onOpenChange={(o) => !o && close()} title={product.name}>
      {mode === "menu" && !lugar ? (
        <p className="rounded-2xl bg-cream-100 px-3 py-3 text-sm text-ink-700">
          Total en todos los lugares:{" "}
          <span className="tnum font-bold text-ink-950">{formatUnits(qtyLugar)}</span>.
          Para registrar una entrada, una merma o un traslado, elegí primero el
          lugar arriba.
        </p>
      ) : mode === "menu" ? (
        <div className="flex flex-col gap-2">
          {admin ? (
            <p className="tnum text-sm text-ink-700">
              Stock teórico en {nombreDe(lugar)}:{" "}
              <span className="font-bold text-ink-950">{formatUnits(qtyLugar)}</span>
              {product.min_qty != null ? ` · Mínimo: ${formatUnits(product.min_qty)}` : ""}
            </p>
          ) : (
            <p className="text-sm text-ink-700">En {nombreDe(lugar)}</p>
          )}
          {admin ? (
            <Button variant="secondary" size="lg" onClick={() => setMode("compra")}>
              Entrada de mercadería
            </Button>
          ) : null}
          <Button variant="secondary" size="lg" onClick={() => setMode("merma")}>
            Registrar merma
          </Button>
          {otros.length > 0 ? (
            <Button variant="secondary" size="lg" onClick={() => setMode("traslado")}>
              <ArrowRightLeft size={16} /> Llevar a otro lugar
            </Button>
          ) : null}
          {admin ? (
            <>
              <Button variant="secondary" size="lg" onClick={() => setMode("ajuste")}>
                Ajuste manual
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => {
                  setMinRaw(product.min_qty != null ? String(product.min_qty) : "");
                  setMode("minimo");
                }}
              >
                Definir mínimo
              </Button>
            </>
          ) : (
            <p className="rounded-2xl bg-cream-100 px-3 py-2 text-xs leading-relaxed text-ink-700">
              Las entradas de mercadería y los ajustes los hace el dueño. Si
              falta mercadería, registrala como merma con el motivo o hacé un
              conteo físico.
            </p>
          )}
          <Link
            href={`/stock/movimientos?p=${product.id}`}
            className="text-center text-sm font-bold text-brand-900 underline"
            onClick={close}
          >
            Ver movimientos
          </Link>
        </div>
      ) : mode === "minimo" ? (
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
              Mínimo operativo (unidades)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={minRaw}
              onChange={(e) => setMinRaw(e.target.value.replace(/[^\d]/g, ""))}
              autoFocus
              className="tnum h-14 w-full rounded-2xl border border-[var(--border-strong)] bg-surface-elevated px-4 text-2xl font-bold outline-none focus:border-brand-700"
            />
            <p className="mt-1 text-xs text-ink-500">
              Debajo de este número el producto aparece como “Bajo”; a la mitad, “Crítico”.
            </p>
          </div>
          <Button
            size="lg"
            disabled={busy || minRaw === ""}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              await updateProduct(product.id, { min_qty: Number(minRaw) });
              notifyOutboxChanged();
              showToast(`Mínimo de ${product.name}: ${minRaw}`);
              close();
            }}
          >
            Guardar mínimo
          </Button>
        </div>
      ) : mode === "traslado" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-700">
            Sale de <span className="font-bold text-ink-950">{nombreDe(lugar)}</span> y
            entra en el lugar que elijas. El total no cambia.
          </p>
          {otros.length > 1 ? (
            <div className="flex gap-2" role="radiogroup" aria-label="Destino">
              {otros.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  role="radio"
                  aria-checked={hacia === u.id}
                  onClick={() => setDestino(u.id)}
                  className={`h-11 flex-1 rounded-xl text-sm font-bold ${
                    hacia === u.id
                      ? "bg-brand-900 text-ink-inverse"
                      : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                  }`}
                >
                  {u.nombre}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm font-bold text-ink-950">Hacia: {nombreDe(hacia)}</p>
          )}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
              Cantidad (unidades)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={qtyRaw}
              onChange={(e) => setQtyRaw(e.target.value.replace(/[^\d]/g, ""))}
              autoFocus
              className="tnum h-14 w-full rounded-2xl border border-[var(--border-strong)] bg-surface-elevated px-4 text-2xl font-bold outline-none focus:border-brand-700"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setMode("menu")}>
              Volver
            </Button>
            <Button
              size="lg"
              className="flex-1"
              disabled={busy || qty <= 0 || !hacia || !lugar}
              onClick={async () => {
                if (busy || !lugar || !hacia) return;
                setBusy(true);
                try {
                  await transferStock({
                    product_id: product.id,
                    qty,
                    desde_id: lugar,
                    hacia_id: hacia,
                    desde_nombre: nombreDe(lugar),
                    hacia_nombre: nombreDe(hacia),
                    reason: reason || undefined,
                    created_by: profileName,
                  });
                  notifyOutboxChanged();
                  showToast(`${qty} ${product.name} → ${nombreDe(hacia)}`);
                  close();
                } catch (err) {
                  setBusy(false);
                  showToast(
                    err instanceof Error && err.message
                      ? `No se registró: ${err.message}`
                      : "No se registró el traslado. Reintentá."
                  );
                }
              }}
            >
              Registrar traslado
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
              {mode === "ajuste" ? "Cantidad (usá − para restar)" : "Cantidad (unidades)"}
            </label>
            <input
              type="text"
              inputMode={mode === "ajuste" ? "text" : "numeric"}
              value={qtyRaw}
              onChange={(e) => {
                const raw = e.target.value.replace(
                  mode === "ajuste" ? /[^\d-]/g : /[^\d]/g,
                  ""
                );
                // el guion sólo vale al inicio ("5-" o "5-3" no son números)
                setQtyRaw(mode === "ajuste" ? raw.replace(/(?!^)-/g, "") : raw);
              }}
              autoFocus
              className="tnum h-14 w-full rounded-2xl border border-[var(--border-strong)] bg-surface-elevated px-4 text-2xl font-bold outline-none focus:border-brand-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
              Motivo {mode === "merma" ? "(qué pasó)" : "(opcional)"}
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setMode("menu")}>
              Volver
            </Button>
            <Button
              size="lg"
              className="flex-1"
              disabled={
                busy ||
                (mode === "ajuste"
                  ? !adjustValid
                  : qty <= 0 || (mode === "merma" && reason.trim() === ""))
              }
              onClick={() =>
                void submitMove(
                  mode as "compra" | "merma" | "ajuste",
                  mode === "ajuste" ? Number(qtyRaw) : qty
                )
              }
            >
              {mode === "compra"
                ? "Registrar entrada"
                : mode === "merma"
                  ? "Registrar merma"
                  : "Registrar ajuste"}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
