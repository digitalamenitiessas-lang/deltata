"use client";

import { useRef } from "react";
import { Minus, Plus, Snowflake } from "lucide-react";
import type { Presentacion, Product } from "@/types";
import { formatARS } from "@/lib/money";
import { saleCardStockLabel } from "@/lib/stock-state";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const toneMap: Record<string, BadgeTone> = {
  ok: "ok",
  warn: "warn",
  danger: "danger",
  muted: "muted",
};

interface Props {
  product: Product;
  /** unidades en el carrito para esta presentación */
  qty: number;
  presentacion: Presentacion;
  everTracked: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onQuickQty: () => void;
}

/**
 * Toque = +1 cocida, o +1 docena si está en modo congeladas.
 * Presión prolongada = selector rápido de cantidad.
 */
export function ProductCard({
  product,
  qty,
  presentacion,
  everTracked,
  onAdd,
  onRemove,
  onQuickQty,
}: Props) {
  const stock = saleCardStockLabel(product, everTracked);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedLong = useRef(false);
  const congelada = presentacion === "congelada";

  const precio = congelada
    ? (product.frozen_dozen_price ?? 0)
    : product.unit_price;
  // En congeladas el contador va en docenas: 24 unidades son 2 docenas
  const mostrado = congelada ? qty / 12 : qty;

  const startPress = () => {
    firedLong.current = false;
    longPress.current = setTimeout(() => {
      firedLong.current = true;
      onQuickQty();
    }, 450);
  };
  const endPress = (add: boolean) => {
    if (longPress.current) clearTimeout(longPress.current);
    if (add && !firedLong.current) onAdd();
  };

  return (
    <div
      className={`relative flex flex-col rounded-3xl border bg-surface-card p-3 transition-colors duration-[var(--motion-fast)] ${
        qty > 0
          ? congelada
            ? "border-info-600 shadow-[0_2px_12px_rgba(53,108,145,0.16)]"
            : "border-brand-700 shadow-[0_2px_12px_rgba(11,71,35,0.12)]"
          : "border-[var(--border-soft)]"
      }`}
    >
      <button
        type="button"
        className="flex min-h-[84px] flex-col items-start gap-1 text-left"
        onPointerDown={startPress}
        onPointerUp={() => endPress(true)}
        onPointerLeave={() => endPress(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          onQuickQty();
        }}
        aria-label={
          congelada
            ? `${product.name} congeladas, ${formatARS(precio)} la docena. Agregar una docena`
            : `${product.name}, ${formatARS(precio)}. Agregar una unidad`
        }
      >
        <span className="text-sm font-bold leading-tight text-ink-950">
          {product.name}
        </span>
        <span className="flex items-baseline gap-1">
          <span
            className={`tnum text-base font-bold ${
              congelada ? "text-info-600" : "text-brand-900"
            }`}
          >
            {formatARS(precio)}
          </span>
          {congelada ? (
            <span className="text-[0.65rem] font-bold text-ink-500">
              /docena
            </span>
          ) : null}
        </span>
        {congelada ? (
          <Badge tone="info">
            <Snowflake size={11} /> Congelada
          </Badge>
        ) : (
          <Badge tone={toneMap[stock.tone]}>{stock.label}</Badge>
        )}
      </button>

      {qty > 0 ? (
        <div
          className={`mt-2 flex items-center justify-between rounded-2xl px-1 py-1 ${
            congelada ? "bg-info-600" : "bg-brand-900"
          }`}
        >
          <button
            type="button"
            onClick={onRemove}
            aria-label={
              congelada
                ? `Quitar una docena de ${product.name}`
                : `Quitar una unidad de ${product.name}`
            }
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-inverse active:opacity-70"
          >
            <Minus size={18} />
          </button>
          <span className="flex items-baseline gap-1" aria-live="polite">
            <span className="tnum text-lg font-bold text-ink-inverse">
              {mostrado}
            </span>
            {congelada ? (
              <span className="text-[0.6rem] font-bold text-ink-inverse/75">
                {mostrado === 1 ? "doc" : "docs"}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={onAdd}
            aria-label={
              congelada
                ? `Agregar una docena de ${product.name}`
                : `Agregar una unidad de ${product.name}`
            }
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-inverse active:opacity-70"
          >
            <Plus size={18} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
