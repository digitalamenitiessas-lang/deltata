"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ShoppingCart,
  Truck,
  Trash2,
  Wrench,
  ClipboardCheck,
  Flame,
  ArrowRightLeft,
} from "lucide-react";
import { db } from "@/lib/db";
import { formatUnits } from "@/lib/money";
import { UBICACION_FOODTRUCK } from "@/lib/lugar";
import { PageHeader } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import type { StockMovementType } from "@/types";

const typeMeta: Record<
  StockMovementType,
  { label: string; icon: typeof Truck; tone: string }
> = {
  compra: { label: "Compra", icon: Truck, tone: "text-success-600" },
  venta: { label: "Venta", icon: ShoppingCart, tone: "text-ink-700" },
  merma: { label: "Merma", icon: Trash2, tone: "text-danger-600" },
  ajuste: { label: "Ajuste", icon: Wrench, tone: "text-info-600" },
  produccion: { label: "Producción", icon: Flame, tone: "text-success-600" },
  conteo: { label: "Conteo físico", icon: ClipboardCheck, tone: "text-brand-900" },
  traslado: { label: "Traslado", icon: ArrowRightLeft, tone: "text-info-600" },
};

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function MovimientosContent() {
  const params = useSearchParams();
  const productFilter = params.get("p");

  const products = useLiveQuery(() => db.products.toArray(), []);
  const ubicaciones = useLiveQuery(() => db.ubicaciones.toArray(), []);
  const lugarDe = (id: string | null | undefined) =>
    (ubicaciones ?? []).find((u) => u.id === (id ?? UBICACION_FOODTRUCK))?.nombre ?? "";
  const movements = useLiveQuery(async () => {
    if (productFilter) {
      const rows = await db.stock_movements
        .where("product_id")
        .equals(productFilter)
        .sortBy("moved_at");
      return rows.reverse().slice(0, 200);
    }
    const rows = await db.stock_movements.orderBy("moved_at").reverse().limit(200).toArray();
    return rows;
  }, [productFilter]);

  const productName = useMemo(() => {
    if (!productFilter) return null;
    return products?.find((p) => p.id === productFilter)?.name ?? null;
  }, [products, productFilter]);

  const nameById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p.name])),
    [products]
  );

  return (
    <>
      <PageHeader
        title="Movimientos"
        subtitle={productName ?? "Todos los productos"}
      />
      <div className="flex flex-col gap-2 p-4">
        {movements === undefined ? (
          <div aria-busy />
        ) : movements.length === 0 ? (
          <EmptyState
            title="Todavía no hay movimientos"
            description="Las ventas, entradas, mermas y conteos van a aparecer acá, con su saldo resultante. Es el historial auditable del stock."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {movements.map((m) => {
              const meta = typeMeta[m.type];
              const Icon = meta.icon;
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3"
                >
                  <Icon size={18} className={`shrink-0 ${meta.tone}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink-950">
                      {nameById.get(m.product_id) ?? "Producto"}
                      <span className="font-normal text-ink-700"> · {meta.label}</span>
                    </p>
                    <p className="text-xs text-ink-500">
                      {(ubicaciones ?? []).length > 1 ? `${lugarDe(m.ubicacion_id)} · ` : ""}
                      {dateFmt.format(new Date(m.moved_at))}
                      {m.created_by ? ` · ${m.created_by}` : ""}
                      {m.reason && m.reason !== meta.label ? ` · ${m.reason}` : ""}
                    </p>
                  </div>
                  <div className="tnum shrink-0 text-right">
                    <p
                      className={`text-base font-bold ${
                        m.qty > 0 ? "text-success-600" : "text-ink-950"
                      }`}
                    >
                      {m.qty > 0 ? `+${formatUnits(m.qty)}` : formatUnits(m.qty)}
                    </p>
                    <p className="text-xs text-ink-500">
                      {m.absorbido
                        ? "ya lo midió un conteo posterior"
                        : `saldo ${formatUnits(m.balance_after)}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

export default function MovimientosPage() {
  return (
    <Suspense fallback={<div className="p-4" aria-busy />}>
      <MovimientosContent />
    </Suspense>
  );
}
