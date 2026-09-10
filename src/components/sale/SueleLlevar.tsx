"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { formatUnits } from "@/lib/money";
import { Button } from "@/components/ui/Button";

/**
 * Lo que suele llevar un cliente, para poder recomendarle.
 *
 * De la reunión: "recuerdo para que puedan recomendar empanada". Sale de una
 * vista de la base sobre TODO el histórico, no sólo lo vendido desde este
 * celular — si no, el mismo cliente tendría gustos distintos según qué
 * dispositivo lo atienda.
 *
 * Muestra sólo lo que repitió (2 veces o más). Con una sola visita no hay
 * costumbre que recordar, y recomendar sobre un dato de una vez sería inventar.
 */
export function SueleLlevar({
  customerId,
  onCargar,
  compacto = false,
}: {
  customerId: string | null;
  /** carga el pedido de siempre en el carrito */
  onCargar?: (items: { product_id: string; unidades: number }[]) => void;
  compacto?: boolean;
}) {
  const gustos = useLiveQuery(
    async () =>
      customerId
        ? (await db.cliente_gustos.where("customer_id").equals(customerId).toArray())
            .filter((g) => g.veces >= 2)
            .sort((a, b) => b.unidades - a.unidades)
            .slice(0, 4)
        : [],
    [customerId]
  );

  if (!customerId || !gustos || gustos.length === 0) return null;

  // Lo habitual por visita, redondeado: si llevó 18 en 3 visitas, son 6
  const habitual = gustos.map((g) => ({
    product_id: g.product_id,
    product_name: g.product_name,
    unidades: Math.max(1, Math.round(g.unidades / g.veces)),
  }));

  const texto = habitual
    .map((h) => `${formatUnits(h.unidades)} ${h.product_name}`)
    .join(" · ");

  if (compacto) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-ink-700">
        <Sparkles size={13} className="mt-0.5 shrink-0 text-gold-500" aria-hidden />
        <span>
          <span className="font-bold">Suele llevar:</span> {texto}
        </span>
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-cream-100 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-700">
        <Sparkles size={14} className="text-gold-500" aria-hidden />
        Suele llevar
      </p>
      <p className="mt-1 text-sm text-ink-950">{texto}</p>
      {onCargar ? (
        <Button
          variant="secondary"
          size="md"
          className="mt-2 w-full"
          onClick={() =>
            onCargar(
              habitual.map((h) => ({
                product_id: h.product_id,
                unidades: h.unidades,
              }))
            )
          }
        >
          Cargar lo de siempre
        </Button>
      ) : null}
    </div>
  );
}
