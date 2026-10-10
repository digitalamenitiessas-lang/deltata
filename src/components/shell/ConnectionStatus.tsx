"use client";

import { useRouter } from "next/navigation";
import { useSyncStore, flushOutbox } from "@/lib/sync/engine";

// Estados del indicador (spec §5.1): discreto en línea, visible offline,
// nunca bloquea la venta. Tocar reintenta la sincronización.
export function ConnectionStatus() {
  const { online, pending, syncing, lastError, rechazadas } = useSyncStore();
  const router = useRouter();

  let text: string;
  let dot: string;
  if (!online) {
    text =
      pending > 0
        ? `Sin conexión · ${pending} por sincronizar`
        : "Sin conexión · las ventas se guardan en este dispositivo";
    dot = "bg-warning-600";
  } else if (syncing && pending > 0) {
    text = `Sincronizando ${pending} ${pending === 1 ? "operación" : "operaciones"}`;
    dot = "bg-info-600";
  } else if (lastError && pending > 0) {
    text = `No se pudo enviar · ${pending} pendientes · ver`;
    dot = "bg-danger-600";
  } else if (rechazadas > 0) {
    text = `${rechazadas} sin guardar en el servidor · ver`;
    dot = "bg-danger-600";
  } else if (pending > 0) {
    text = `${pending} ${pending === 1 ? "operación pendiente" : "operaciones pendientes"}`;
    dot = "bg-warning-600";
  } else {
    text = "En línea";
    dot = "bg-success-600";
  }

  return (
    <button
      type="button"
      onClick={() => {
        // Con un problema, tocar lleva a ver qué pasa (Más → Sincronización)
        if (rechazadas > 0 || (lastError && pending > 0)) router.push("/mas");
        void flushOutbox();
      }}
      title={lastError ?? undefined}
      aria-live="polite"
      className="flex h-11 max-w-full items-center gap-2 rounded-full bg-surface-card px-3 text-xs font-bold text-ink-700 border border-[var(--border-soft)]"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="truncate">{text}</span>
    </button>
  );
}
