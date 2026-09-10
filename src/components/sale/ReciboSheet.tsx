"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, MessageCircle, Receipt, ChefHat } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { db } from "@/lib/db";
import {
  linkWhatsApp,
  mostrarTelefono,
  normalizarTelefono,
  textoRecibo,
} from "@/lib/recibo";
import { useUI } from "@/stores/ui";
import type { Sale } from "@/types";

/**
 * Recibo digital: se manda por WhatsApp si el cliente lo pide.
 *
 * No se envía nada solo. Se arma el texto, se abre WhatsApp con el mensaje ya
 * escrito y la persona toca enviar. Es lo que hace falta para el foodtruck y
 * no depende de ninguna cuenta de API.
 */
export function ReciboSheet({
  sale,
  onClose,
}: {
  sale: Sale | null;
  onClose: () => void;
}) {
  const showToast = useUI((s) => s.showToast);
  const [tipo, setTipo] = useState<"recibo" | "comanda">("recibo");
  const [telefono, setTelefono] = useState("");
  const [tocado, setTocado] = useState(false);

  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const cliente = useMemo(
    () =>
      sale?.customer_id
        ? (customers ?? []).find((c) => c.id === sale.customer_id)
        : undefined,
    [customers, sale?.customer_id]
  );

  // Cada venta arranca con el teléfono del cliente si lo tenemos guardado
  useEffect(() => {
    if (sale) {
      setTipo("recibo");
      setTocado(false);
      setTelefono(cliente?.phone ?? "");
    }
  }, [sale, cliente?.phone]);

  if (!sale) return null;

  const texto = textoRecibo(sale, { cliente: cliente?.name, tipo });
  const normalizado = telefono.trim() ? normalizarTelefono(telefono) : null;
  const telefonoInvalido = tocado && telefono.trim() !== "" && normalizado == null;

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={tipo === "recibo" ? "Recibo digital" : "Comanda"}
    >
      <div className="flex flex-col gap-3">
        <div
          className="grid grid-cols-2 gap-1 rounded-2xl bg-cream-200 p-1"
          role="radiogroup"
          aria-label="Qué mandar"
        >
          {(
            [
              { id: "recibo", label: "Recibo al cliente", icon: Receipt },
              { id: "comanda", label: "Comanda", icon: ChefHat },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={tipo === id}
              onClick={() => setTipo(id)}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold ${
                tipo === id ? "bg-brand-900 text-ink-inverse" : "text-ink-700"
              }`}
            >
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div>
          <label
            htmlFor="recibo-tel"
            className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700"
          >
            {tipo === "recibo"
              ? "Teléfono del cliente (vacío = elegir en WhatsApp)"
              : "Teléfono de la cocina (vacío = elegir en WhatsApp)"}
          </label>
          <input
            id="recibo-tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            onBlur={() => setTocado(true)}
            inputMode="tel"
            placeholder="383 415-1234"
            className={`h-12 w-full rounded-xl border bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700 ${
              telefonoInvalido
                ? "border-danger-600"
                : "border-[var(--border-strong)]"
            }`}
          />
          {telefonoInvalido ? (
            <p className="mt-1 text-xs font-bold text-danger-600">
              Ese número no parece un celular argentino. Debe tener el código de
              área y 10 dígitos en total.
            </p>
          ) : normalizado ? (
            <p className="mt-1 text-xs text-ink-500">
              Se envía a {mostrarTelefono(normalizado)}
            </p>
          ) : null}
        </div>

        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
            Así se va a ver
          </p>
          <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-cream-100 p-3 text-xs leading-relaxed text-ink-950">
            {texto}
          </pre>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(texto);
                showToast("Recibo copiado");
              } catch {
                showToast("No se pudo copiar. Mantené apretado el texto.");
              }
            }}
          >
            <Copy size={16} /> Copiar
          </Button>
          <a
            href={linkWhatsApp(texto, normalizado)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-success-600 px-5 text-sm font-bold text-ink-inverse"
            onClick={() => onClose()}
          >
            <MessageCircle size={18} aria-hidden />
            Abrir WhatsApp
          </a>
        </div>
        <p className="text-center text-xs text-ink-500">
          Se abre WhatsApp con el mensaje escrito. El envío lo confirmás vos.
        </p>
      </div>
    </Sheet>
  );
}
