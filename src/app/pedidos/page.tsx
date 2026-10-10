"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Bike, Clock, MessageCircle, ShoppingBag } from "lucide-react";
import { db } from "@/lib/db";
import { actualizarPedido, cobrarPedido } from "@/lib/ops";
import { computeCart } from "@/lib/pricing";
import { formatARS } from "@/lib/money";
import { normalizarTelefono } from "@/lib/recibo";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { useSesion } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaymentSheet } from "@/components/sale/PaymentSheet";
import { UNIDADES_POR_DOCENA, type Pedido, type PedidoEstado } from "@/types";

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

const SIGUIENTE: Partial<Record<PedidoEstado, { estado: PedidoEstado; label: string }>> = {
  pendiente: { estado: "preparando", label: "Empezar a preparar" },
  preparando: { estado: "listo", label: "Marcar listo" },
};

const ESTADO_LABEL: Record<PedidoEstado, string> = {
  pendiente: "Pendiente",
  preparando: "Preparando",
  listo: "Listo",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

/** "6 Carne, 1 doc. congelada Pollo" */
function resumen(p: Pedido): string {
  return p.lineas
    .map((l) =>
      l.presentacion === "congelada"
        ? `${l.qty / UNIDADES_POR_DOCENA} doc. congelada ${l.product_name}`
        : `${l.qty} ${l.product_name}`
    )
    .join(", ");
}

/**
 * Pedidos para llevar y delivery. Se toman desde Vender ("Pedido") y se siguen
 * acá, en cualquier equipo: el celular que atiende WhatsApp los carga y la
 * compu del local los ve para prepararlos.
 */
export default function PedidosPage() {
  const profileName = useSesion((s) => s.usuario?.nombre ?? "");
  const showToast = useUI((s) => s.showToast);
  const [cobrando, setCobrando] = useState<Pedido | null>(null);
  const [verCerrados, setVerCerrados] = useState(false);

  const pedidos = useLiveQuery(() => db.pedidos.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const canales = useLiveQuery(() => db.canales.toArray(), []);
  const precios = useLiveQuery(() => db.canal_precios.toArray(), []);
  const promos = useLiveQuery(() => db.promos.toArray(), []);

  // Lo que sale cobrarlo AHORA (si cambió un precio desde que se tomó, manda
  // el precio de hoy, igual que en el mostrador)
  const totalActual = useMemo(() => {
    return (p: Pedido) => {
      const canal = (canales ?? []).find((c) => c.id === p.canal_id) ?? null;
      return computeCart(
        (products ?? []).filter((x) => x.is_active),
        p.cantidades,
        0,
        canal,
        (precios ?? []).filter((x) => x.canal_id === canal?.id),
        promos ?? []
      ).total;
    };
  }, [products, canales, precios, promos]);

  const orden = (a: Pedido, b: Pedido) =>
    (a.para_cuando ?? a.creado_en).localeCompare(b.para_cuando ?? b.creado_en);
  const enCurso = (pedidos ?? [])
    .filter((p) => p.estado === "pendiente" || p.estado === "preparando")
    .sort(orden);
  const listos = (pedidos ?? []).filter((p) => p.estado === "listo").sort(orden);
  const cerrados = (pedidos ?? [])
    .filter((p) => p.estado === "entregado" || p.estado === "cancelado")
    .sort((a, b) => b.cambiado_en.localeCompare(a.cambiado_en));

  const mover = async (p: Pedido, estado: PedidoEstado) => {
    try {
      await actualizarPedido(p.id, { estado });
      notifyOutboxChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo actualizar el pedido.");
    }
  };

  const canalDe = (id: string | null) => (canales ?? []).find((c) => c.id === id)?.nombre;

  const Tarjeta = ({ p }: { p: Pedido }) => {
    const atrasado =
      p.para_cuando != null &&
      (p.estado === "pendiente" || p.estado === "preparando") &&
      new Date(p.para_cuando).getTime() < Date.now();
    const tel = p.telefono ? normalizarTelefono(p.telefono) : null;
    const sig = SIGUIENTE[p.estado];
    const total = p.pagado ? p.total : totalActual(p);
    return (
      <li className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-base font-bold text-ink-950">
              {p.tipo === "delivery" ? (
                <Bike size={16} aria-label="Delivery" />
              ) : (
                <ShoppingBag size={16} aria-label="Lo retira" />
              )}
              <span className="truncate">{p.cliente_nombre}</span>
            </p>
            <p
              className={`tnum mt-0.5 flex items-center gap-1 text-xs font-bold ${
                atrasado ? "text-danger-600" : "text-ink-700"
              }`}
            >
              <Clock size={12} aria-hidden />
              {p.para_cuando ? `Para las ${hora(p.para_cuando)}` : "Cuanto antes"}
              {atrasado ? " · atrasado" : ""}
              <span className="font-normal text-ink-500">
                {" "}
                · tomado {hora(p.creado_en)}
                {canalDe(p.canal_id) ? ` · ${canalDe(p.canal_id)}` : ""}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge
              tone={
                p.estado === "listo"
                  ? "ok"
                  : p.estado === "cancelado"
                    ? "danger"
                    : p.estado === "entregado"
                      ? "muted"
                      : "warn"
              }
            >
              {ESTADO_LABEL[p.estado]}
            </Badge>
            <Badge tone={p.pagado ? "ok" : "muted"}>{p.pagado ? "Pagado" : "Sin pagar"}</Badge>
          </div>
        </div>

        <p className="mt-2 text-sm text-ink-950">{resumen(p)}</p>
        {p.tipo === "delivery" && p.direccion ? (
          <p className="mt-1 text-sm text-ink-700">📍 {p.direccion}</p>
        ) : null}
        {p.nota ? <p className="mt-1 text-sm italic text-ink-700">“{p.nota}”</p> : null}
        <p className="tnum mt-2 text-lg font-bold text-ink-950">{formatARS(total)}</p>

        {p.estado !== "entregado" && p.estado !== "cancelado" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {sig ? (
              <Button size="md" onClick={() => void mover(p, sig.estado)}>
                {sig.label}
              </Button>
            ) : null}
            {p.estado === "listo" ? (
              p.pagado ? (
                <Button size="md" onClick={() => void mover(p, "entregado")}>
                  Entregado
                </Button>
              ) : (
                <Button size="md" variant="gold" onClick={() => setCobrando(p)}>
                  Cobrar y entregar
                </Button>
              )
            ) : !p.pagado ? (
              <Button size="md" variant="secondary" onClick={() => setCobrando(p)}>
                Cobrar
              </Button>
            ) : null}
            {tel && p.estado === "listo" ? (
              <a
                href={`https://wa.me/${tel}?text=${encodeURIComponent(
                  `¡Hola ${p.cliente_nombre}! Tu pedido de Del Tata ya está listo${
                    p.tipo === "delivery" ? " y sale para tu casa" : " para retirar"
                  }. ${p.pagado ? "" : `Total: ${formatARS(total)}.`}`.trim()
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button size="md" variant="secondary">
                  <MessageCircle size={16} /> Avisar
                </Button>
              </a>
            ) : null}
            {!p.pagado ? (
              <Button
                size="md"
                variant="ghost"
                className="text-danger-600"
                onClick={() => {
                  if (window.confirm(`¿Cancelar el pedido de ${p.cliente_nombre}?`)) {
                    void mover(p, "cancelado");
                  }
                }}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Pedidos"
        subtitle={
          enCurso.length + listos.length === 0
            ? "Ninguno en curso"
            : `${enCurso.length} en preparación · ${listos.length} listos`
        }
      />
      <div className="flex flex-col gap-4 p-4">
        {pedidos === undefined ? (
          <div aria-busy />
        ) : enCurso.length + listos.length === 0 ? (
          <EmptyState
            title="No hay pedidos en curso"
            description="Los pedidos para llevar y delivery se toman desde Vender: armá el pedido como siempre y tocá “Pedido” en vez de “Cobrar”."
            action={
              <Link href="/vender">
                <Button>Ir a Vender</Button>
              </Link>
            }
          />
        ) : null}

        {listos.length > 0 ? (
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-success-600">
              Listos para entregar
            </h2>
            <ul className="flex flex-col gap-3">
              {listos.map((p) => (
                <Tarjeta key={p.id} p={p} />
              ))}
            </ul>
          </section>
        ) : null}

        {enCurso.length > 0 ? (
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
              Para preparar
            </h2>
            <ul className="flex flex-col gap-3">
              {enCurso.map((p) => (
                <Tarjeta key={p.id} p={p} />
              ))}
            </ul>
          </section>
        ) : null}

        {cerrados.length > 0 ? (
          <section>
            <button
              type="button"
              onClick={() => setVerCerrados((v) => !v)}
              className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500 underline"
            >
              {verCerrados ? "Ocultar" : "Ver"} entregados y cancelados ({cerrados.length})
            </button>
            {verCerrados ? (
              <ul className="flex flex-col gap-3">
                {cerrados.map((p) => (
                  <Tarjeta key={p.id} p={p} />
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

      <PaymentSheet
        open={cobrando != null}
        onOpenChange={(o) => !o && setCobrando(null)}
        total={cobrando ? totalActual(cobrando) : 0}
        titulo={cobrando ? `Cobrar pedido de ${cobrando.cliente_nombre}` : "Cobrar"}
        onConfirm={async (input) => {
          if (!cobrando) return;
          await cobrarPedido({
            pedido_id: cobrando.id,
            payment_method: input.payment_method,
            cash_received: input.cash_received,
            customer_id: input.customer_id,
            sold_by: profileName,
            expected_total: totalActual(cobrando),
            entregar: cobrando.estado === "listo",
          });
          notifyOutboxChanged();
          const vuelto =
            input.payment_method === "efectivo" && input.cash_received != null
              ? input.cash_received - totalActual(cobrando)
              : 0;
          showToast(
            vuelto > 0
              ? `Cobrado · vuelto ${formatARS(vuelto)}`
              : `Pedido de ${cobrando.cliente_nombre} cobrado`
          );
          setCobrando(null);
        }}
      />
    </>
  );
}
