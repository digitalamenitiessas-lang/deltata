"use client";

import { useEffect, useState } from "react";
import { Bike, ShoppingBag } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { formatARS } from "@/lib/money";

export interface DatosPedido {
  cliente_nombre: string;
  telefono: string | null;
  tipo: "retira" | "delivery";
  direccion: string | null;
  para_cuando: string | null;
  nota: string | null;
}

/** "HH:MM" de hoy → ISO. Si la hora ya pasó, es de mañana (pedido nocturno). */
export function horaAISO(hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() < Date.now() - 6 * 3600 * 1000) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * Datos de quien pide. El pedido en sí es lo que está en el carrito; acá sólo
 * se anota a nombre de quién, si lo buscan o se lleva, y para qué hora.
 */
export function NuevoPedidoSheet({
  open,
  onOpenChange,
  total,
  unidades,
  hayDescuentoManual,
  onGuardar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  unidades: number;
  hayDescuentoManual: boolean;
  onGuardar: (datos: DatosPedido, cobrarAhora: boolean) => Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [tipo, setTipo] = useState<"retira" | "delivery">("retira");
  const [direccion, setDireccion] = useState("");
  const [hora, setHora] = useState("");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNombre("");
      setTelefono("");
      setTipo("retira");
      setDireccion("");
      setHora("");
      setNota("");
    }
  }, [open]);

  const valido =
    nombre.trim() !== "" &&
    (tipo === "retira" || direccion.trim() !== "") &&
    (hora === "" || horaAISO(hora) != null);

  const guardar = async (cobrarAhora: boolean) => {
    if (!valido || busy) return;
    setBusy(true);
    try {
      await onGuardar(
        {
          cliente_nombre: nombre.trim(),
          telefono: telefono.trim() || null,
          tipo,
          direccion: tipo === "delivery" ? direccion.trim() : null,
          para_cuando: hora ? horaAISO(hora) : null,
          nota: nota.trim() || null,
        },
        cobrarAhora
      );
    } finally {
      setBusy(false);
    }
  };

  const campo =
    "h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Guardar como pedido">
      <div className="flex flex-col gap-3">
        <p className="tnum text-sm text-ink-700">
          {unidades} {unidades === 1 ? "unidad" : "unidades"} ·{" "}
          <span className="font-bold text-ink-950">{formatARS(total)}</span>
        </p>
        {hayDescuentoManual ? (
          <p className="rounded-xl bg-[#f7ecd8] px-3 py-2 text-xs font-bold text-warning-600">
            El descuento a mano no se guarda en el pedido: si corresponde, se
            aplica al cobrarlo.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cómo se entrega">
          {(
            [
              { id: "retira", label: "Lo retira", icon: ShoppingBag },
              { id: "delivery", label: "Delivery", icon: Bike },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={tipo === id}
              onClick={() => setTipo(id)}
              className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-bold ${
                tipo === id
                  ? "bg-brand-900 text-ink-inverse"
                  : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
              }`}
            >
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre de quien pide"
          aria-label="Nombre"
          autoFocus
          className={campo}
        />
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="Teléfono (para avisarle por WhatsApp)"
          aria-label="Teléfono"
          inputMode="tel"
          className={campo}
        />
        {tipo === "delivery" ? (
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Dirección de entrega"
            aria-label="Dirección"
            className={campo}
          />
        ) : null}
        <div>
          <label
            htmlFor="pedido-hora"
            className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700"
          >
            ¿Para qué hora? (vacío = cuanto antes)
          </label>
          <input
            id="pedido-hora"
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className={`tnum ${campo}`}
          />
        </div>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Nota (ej: sin cebolla, timbre B)"
          aria-label="Nota"
          className={campo}
        />

        <div className="flex flex-col gap-2 pt-1">
          <Button size="lg" disabled={!valido || busy} onClick={() => void guardar(true)}>
            Ya pagó · cobrar ahora
          </Button>
          <Button
            variant="secondary"
            size="lg"
            disabled={!valido || busy}
            onClick={() => void guardar(false)}
          >
            Paga al retirar / al recibir
          </Button>
        </div>
        <p className="text-xs text-ink-500">
          El stock se descuenta cuando se cobra. Hasta entonces el pedido se ve
          en Pedidos, en todos los equipos.
        </p>
      </div>
    </Sheet>
  );
}
