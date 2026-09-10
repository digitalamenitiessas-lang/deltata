"use client";

import { Minus, Plus, Trash2, Snowflake, TrendingDown, Tag } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import { useCart } from "@/stores/cart";
import { useSesion, esAdmin } from "@/stores/sesion";
import { formatARS } from "@/lib/money";
import { claveLinea, type CartComputation } from "@/lib/pricing";
import { describirDesglose } from "@/lib/tramos";
import { UNIDADES_POR_DOCENA } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartComputation;
  onCheckout: () => void;
}

export function CartSheet({ open, onOpenChange, cart, onCheckout }: Props) {
  const { quantities, setQty, manualDiscount, setManualDiscount, note, setNote, clear } =
    useCart();
  // El descuento a mano lo autoriza el dueño: el ahorro por tramos ya sale solo
  const admin = esAdmin(useSesion((s) => s.usuario));

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Pedido actual">
      {cart.lines.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-700">El pedido está vacío.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
            {cart.lines.map((line) => {
              const congelada = line.presentacion === "congelada";
              const paso = congelada ? UNIDADES_POR_DOCENA : 1;
              const k = claveLinea(line.product_id, line.presentacion);
              const actual = quantities[k] ?? 0;
              return (
                <li key={k} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-bold text-ink-950">
                      {line.product_name}
                      {congelada ? (
                        <Snowflake
                          size={13}
                          className="shrink-0 text-info-600"
                          aria-label="congeladas"
                        />
                      ) : null}
                    </p>
                    <p className="tnum text-xs text-ink-700">
                      {congelada
                        ? `${line.desglose.docenas} ${line.desglose.docenas === 1 ? "docena" : "docenas"} · ${line.qty} u.`
                        : `${line.qty} u. · ${describirDesglose(line.desglose)}`}
                    </p>
                    {line.sugerencia ? (
                      <p className="mt-0.5 flex items-center gap-1 text-[0.7rem] font-bold text-success-600">
                        <TrendingDown size={11} aria-hidden />
                        Con {line.sugerencia.faltan} más:{" "}
                        {formatARS(line.sugerencia.nuevoTotal)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Quitar de ${line.product_name}`}
                      onClick={() =>
                        setQty(line.product_id, line.presentacion, actual - paso)
                      }
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-soft)] text-brand-900 active:bg-cream-100"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="tnum w-8 text-center text-base font-bold">
                      {congelada ? line.desglose.docenas : line.qty}
                    </span>
                    <button
                      type="button"
                      aria-label={`Agregar a ${line.product_name}`}
                      onClick={() =>
                        setQty(line.product_id, line.presentacion, actual + paso)
                      }
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-soft)] text-brand-900 active:bg-cream-100"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <p className="tnum w-20 text-right text-sm font-bold text-ink-950">
                    {formatARS(line.line_total)}
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="repulgue" aria-hidden />

          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-700">Si fuera todo por unidad</dt>
              <dd className="tnum font-bold">{formatARS(cart.sinTramos)}</dd>
            </div>
            {cart.ahorroTramos > 0 ? (
              <div className="flex justify-between text-success-600">
                <dt>Precio por media docena y docena</dt>
                <dd className="tnum font-bold">−{formatARS(cart.ahorroTramos)}</dd>
              </div>
            ) : null}
            {/* Cada promo se muestra con su nombre: el descuento tiene que
                poder explicarse en el mostrador, no aparecer solo */}
            {cart.promos.map((p) => (
              <div key={p.promo_id} className="flex justify-between text-success-600">
                <dt className="flex items-center gap-1">
                  <Tag size={12} aria-hidden />
                  {p.nombre}
                  {p.veces > 1 ? ` ×${p.veces}` : ""}
                </dt>
                <dd className="tnum font-bold">−{formatARS(p.ahorro)}</dd>
              </div>
            ))}
            {cart.manualDiscount > 0 ? (
              <div className="flex justify-between text-terracotta-500">
                <dt>Descuento manual</dt>
                <dd className="tnum font-bold">−{formatARS(cart.manualDiscount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-lg">
              <dt className="font-bold">Total</dt>
              <dd className="tnum font-bold text-brand-900">{formatARS(cart.total)}</dd>
            </div>
          </dl>

          {admin ? (
            <MoneyInput
              label="Descuento manual (opcional)"
              value={manualDiscount > 0 ? String(manualDiscount) : ""}
              onChange={(raw) => setManualDiscount(parseMoney(raw))}
            />
          ) : null}
          <div>
            <label
              htmlFor="sale-note"
              className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700"
            >
              Observación (opcional)
            </label>
            <input
              id="sale-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
            />
          </div>

          <div className="mt-1 flex gap-2">
            <Button
              variant="ghost"
              size="md"
              className="text-danger-600"
              onClick={() => {
                clear();
                onOpenChange(false);
              }}
            >
              <Trash2 size={16} /> Vaciar
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              onClick={() => {
                onOpenChange(false);
                onCheckout();
              }}
            >
              Cobrar · {formatARS(cart.total)}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
