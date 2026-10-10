"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Search,
  Flame,
  Snowflake,
  MessageCircle,
  Tag,
  UserRound,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import { db } from "@/lib/db";
import { cajaOlvidada, cobrarPedido, crearPedido, recordSale } from "@/lib/ops";
import { canalDelLugar, ubicacionDeCanal } from "@/lib/lugar";
import { useEquipo } from "@/stores/equipo";
import { NuevoPedidoSheet, type DatosPedido } from "@/components/pedidos/NuevoPedidoSheet";
import { computeCart, claveLinea } from "@/lib/pricing";
import { formatARS } from "@/lib/money";
import { notifyOutboxChanged, useSyncStore } from "@/lib/sync/engine";
import { useCart } from "@/stores/cart";
import { useSesion } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { PrimerosPasos } from "@/components/PrimerosPasos";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { ProductCard } from "@/components/sale/ProductCard";
import { CartSheet } from "@/components/sale/CartSheet";
import { PaymentSheet } from "@/components/sale/PaymentSheet";
import { ReciboSheet } from "@/components/sale/ReciboSheet";
import { SueleLlevar } from "@/components/sale/SueleLlevar";
import {
  PAYMENT_LABELS,
  UNIDADES_POR_DOCENA,
  type PaymentMethod,
  type Presentacion,
  type ProductKind,
  type Pedido,
  type Sale,
} from "@/types";

type Filter = "todos" | ProductKind;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "empanada", label: "Empanadas" },
  { id: "bebida", label: "Bebidas" },
  { id: "otro", label: "Otros" },
];

export default function VenderPage() {
  const profileName = useSesion((s) => s.usuario?.nombre ?? "");
  const showToast = useUI((s) => s.showToast);
  const online = useSyncStore((s) => s.online);

  const [filter, setFilter] = useState<Filter>("todos");
  const [search, setSearch] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [quickFor, setQuickFor] = useState<string | null>(null);
  // La última venta queda a mano por si el cliente pide el recibo después de
  // pagar. Se limpia cuando arranca el pedido siguiente.
  const [ultimaVenta, setUltimaVenta] = useState<Sale | null>(null);
  const [reciboAbierto, setReciboAbierto] = useState(false);
  const [clienteAbierto, setClienteAbierto] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [vuelto, setVuelto] = useState<number | null>(null);
  const [pedidoAbierto, setPedidoAbierto] = useState(false);
  // Pedido recién tomado que pagan en el momento: se cobra con el mismo sheet
  const [pedidoACobrar, setPedidoACobrar] = useState<Pedido | null>(null);
  const ubicacionEquipo = useEquipo((s) => s.ubicacionId);

  const {
    quantities,
    manualDiscount,
    note,
    presentacion,
    setPresentacion,
    canalId,
    setCanalId,
    customerId,
    setCustomerId,
    add,
    setQty,
    clear,
  } = useCart();
  const congeladas = presentacion === "congelada";

  const products = useLiveQuery(
    () => db.products.orderBy("sort_order").toArray(),
    []
  );
  const canales = useLiveQuery(
    () => db.canales.orderBy("sort_order").toArray(),
    []
  );
  const promos = useLiveQuery(() => db.promos.orderBy("sort_order").toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const clienteElegido = (customers ?? []).find((c) => c.id === customerId) ?? null;
  // Sin elegir, arranca con el canal del lugar donde está este equipo (la
  // compu del local vende como Local; el celular del foodtruck, como Foodtruck)
  const canalActivo = useMemo(() => {
    const lista = (canales ?? []).filter((c) => c.activo);
    return lista.find((c) => c.id === canalId) ?? canalDelLugar(lista, ubicacionEquipo);
  }, [canales, canalId, ubicacionEquipo]);
  const ubicacionVenta = ubicacionDeCanal(canalActivo);
  const stockLugar = useLiveQuery(
    async () =>
      new Map(
        (await db.stock_ubic.where("ubicacion_id").equals(ubicacionVenta).toArray()).map(
          (r) => [r.product_id, r.qty]
        )
      ),
    [ubicacionVenta]
  );
  const preciosCanal = useLiveQuery(
    async () =>
      canalActivo
        ? db.canal_precios.where("canal_id").equals(canalActivo.id).toArray()
        : [],
    [canalActivo?.id]
  );
  // Cada lugar tiene su caja: la venta del foodtruck no puede entrar en el
  // arqueo de la casa. undefined = todavía cargando.
  const cajasAbiertas = useLiveQuery(
    () => db.cash_sessions.where("status").equals("abierta").toArray(),
    []
  );
  const openSession = useMemo(() => {
    if (cajasAbiertas === undefined) return undefined;
    if (!canalActivo) return cajasAbiertas[0] ?? null;
    return (
      cajasAbiertas.find((s) => s.canal_id === canalActivo.id) ??
      // Cajas viejas, de cuando había una sola: valen para el canal por defecto
      (canalActivo.es_default
        ? (cajasAbiertas.find((s) => s.canal_id == null) ?? null)
        : null)
    );
  }, [cajasAbiertas, canalActivo]);
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

  const activeProducts = useMemo(
    () => (products ?? []).filter((p) => p.is_active),
    [products]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeProducts
      .filter((p) => filter === "todos" || p.kind === filter)
      .filter((p) => q === "" || p.name.toLowerCase().includes(q))
      // Congeladas: sólo los gustos con precio de docena congelada cargado
      .filter((p) => !congeladas || p.frozen_dozen_price != null);
  }, [activeProducts, filter, search, congeladas]);

  const cart = useMemo(
    () =>
      computeCart(
        activeProducts,
        quantities,
        manualDiscount,
        canalActivo,
        preciosCanal ?? [],
        promos ?? []
      ),
    [activeProducts, quantities, manualDiscount, canalActivo, preciosCanal, promos]
  );

  const quickProduct = activeProducts.find((p) => p.id === quickFor) ?? null;

  // Cargando datos locales: render inmediato sin skeleton pesado
  if (products === undefined || openSession === undefined) {
    return (
      <>
        <PageHeader title="Vender" />
        <div className="p-4" aria-busy />
      </>
    );
  }

  // Bloqueo funcional: sin caja abierta no se vende (spec §6.7). Ahora es por
  // lugar: puede estar abierta la de la casa y cerrada la del foodtruck.
  if (!openSession) {
    const otrasAbiertas = (cajasAbiertas ?? []).length > 0;
    return (
      <>
        <PageHeader title="Vender" subtitle={canalActivo?.nombre} />
        <div className="mx-auto flex max-w-md flex-col gap-5 px-5 py-10">
          <div className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-6 text-center">
            <p className="text-lg font-bold text-ink-950">
              {canalActivo
                ? `No hay caja abierta en ${canalActivo.nombre}`
                : "Primero abrí la caja"}
            </p>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-700">
              {otrasAbiertas
                ? "Hay caja abierta en otro lugar, pero cada uno lleva la suya: si la venta entrara en la caja equivocada, ese arqueo cerraría con plata que no está."
                : "Se abre una vez al empezar el turno, anotando el cambio con el que arrancás. A partir de ahí cada venta queda dentro de ese turno y al final el sistema puede decirte si la plata coincide."}
            </p>
            <Link
              href={canalActivo ? `/caja/abrir?canal=${canalActivo.id}` : "/caja/abrir"}
              className="mt-5 inline-block"
            >
              <Button size="lg">
                {canalActivo ? `Abrir caja de ${canalActivo.nombre}` : "Abrir caja"}
              </Button>
            </Link>
          </div>

          {/* Cambiar de lugar sin salir de acá */}
          {(canales ?? []).filter((c) => c.activo).length > 1 ? (
            <div
              className="flex flex-wrap justify-center gap-2"
              role="radiogroup"
              aria-label="Lugar de venta"
            >
              {(canales ?? [])
                .filter((c) => c.activo)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={canalActivo?.id === c.id}
                    onClick={() => setCanalId(c.id)}
                    className={`h-11 rounded-full px-4 text-sm font-bold ${
                      canalActivo?.id === c.id
                        ? "bg-wood-700 text-ink-inverse"
                        : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                    }`}
                  >
                    {c.nombre}
                  </button>
                ))}
            </div>
          ) : null}

          <PrimerosPasos />

          <Link
            href="/guia"
            className="text-center text-sm font-bold text-brand-900 underline"
          >
            ¿Cómo funciona todo esto?
          </Link>
        </div>
      </>
    );
  }

  const confirmSale = async (input: {
    payment_method: PaymentMethod;
    cash_received?: number;
    customer_id?: string;
  }) => {
    const sale = pedidoACobrar
      ? (
          await cobrarPedido({
            pedido_id: pedidoACobrar.id,
            payment_method: input.payment_method,
            cash_received: input.cash_received,
            customer_id: input.customer_id ?? customerId ?? undefined,
            sold_by: profileName,
            expected_total: pedidoACobrar.total,
          })
        ).sale
      : await recordSale({
          quantities,
          payment_method: input.payment_method,
          // Si eligieron el cliente al empezar, la venta queda a su nombre aunque
          // pague en efectivo: es lo que alimenta el "suele llevar" de mañana.
          customer_id: input.customer_id ?? customerId ?? undefined,
          manualDiscount,
          cash_received: input.cash_received,
          sold_by: profileName,
          note: note || undefined,
          canal_id: canalActivo?.id ?? null,
          // lo que el cliente vio en pantalla: si cambió, no se cobra otro número
          expected_total: cart.total,
        });
    notifyOutboxChanged();
    setPayOpen(false);
    setPedidoACobrar(null);
    clear();
    setUltimaVenta(sale);
    // El vuelto queda a la vista hasta el próximo pedido: el toast se va solo
    setVuelto(
      input.payment_method === "efectivo" && input.cash_received != null
        ? input.cash_received - sale.total
        : null
    );
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(40);
    }
    showToast(
      online
        ? `Venta registrada · ${formatARS(sale.total)} · ${PAYMENT_LABELS[sale.payment_method]}`
        : `Venta registrada · ${formatARS(sale.total)} · se sincronizará al volver la conexión`
    );
  };

  const guardarPedido = async (datos: DatosPedido, cobrarAhora: boolean) => {
    try {
      const pedido = await crearPedido({
        ...datos,
        creado_por: profileName,
        canal_id: canalActivo?.id ?? null,
        cantidades: quantities,
        lineas: cart.lines.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          qty: l.qty,
          presentacion: l.presentacion,
          line_total: l.line_total,
        })),
        // sin descuento a mano: el pedido se cobra con lo que diga el sistema
        total: cart.total + cart.manualDiscount,
      });
      notifyOutboxChanged();
      setPedidoAbierto(false);
      if (cobrarAhora) {
        setPedidoACobrar(pedido);
        setPayOpen(true);
      } else {
        clear();
        showToast(`Pedido de ${pedido.cliente_nombre} guardado`);
      }
    } catch (err) {
      showToast(
        err instanceof Error && err.message
          ? `No se guardó el pedido: ${err.message}`
          : "No se guardó el pedido. Reintentá."
      );
    }
  };

  // Una caja abierta de hace más de un turno: lo que se venda ahora se mezcla
  // con otro día en el mismo arqueo
  const cajaVieja = cajaOlvidada(openSession);

  return (
    <>
      <PageHeader
        title="Vender"
        subtitle={`${canalActivo ? `${canalActivo.nombre} · ` : ""}caja de ${openSession.opened_by}${
          cajaVieja
            ? ` · abierta el ${new Date(openSession.opened_at).toLocaleDateString("es-AR", {
                day: "2-digit",
                month: "2-digit",
              })}`
            : ""
        }`}
      />

      <div className="flex flex-col gap-3 p-4">
        <PrimerosPasos compacto />

        {cajaVieja ? (
          <div className="flex items-start gap-2 rounded-2xl border border-warning-600 bg-[#f7ecd8] p-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink-950">
                Esta caja está abierta desde el{" "}
                {new Date(openSession.opened_at).toLocaleString("es-AR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="text-xs text-ink-700">
                Lo que vendas ahora se mezcla con ese día en el arqueo. Cerrala y
                abrí una nueva para el turno de hoy.
              </p>
            </div>
            <Link href={`/caja/cerrar?id=${openSession.id}`} className="shrink-0">
              <Button size="sm" variant="secondary">
                Cerrar
              </Button>
            </Link>
          </div>
        ) : null}

        {/* El recibo se manda si el cliente lo pide, después de cobrar */}
        {ultimaVenta && cart.totalUnits === 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-success-600 bg-[#eef6ef] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-950">
                Última venta · {formatARS(ultimaVenta.total)}
              </p>
              {vuelto != null && vuelto > 0 ? (
                <p className="tnum text-lg font-bold text-success-600">
                  Vuelto: {formatARS(vuelto)}
                </p>
              ) : null}
              <p className="text-xs text-ink-700">
                ¿Pide el recibo? Mandáselo por WhatsApp.
              </p>
            </div>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setReciboAbierto(true)}
            >
              <MessageCircle size={16} /> Recibo
            </Button>
          </div>
        ) : null}

        {/* Canal: cada uno tiene su propia lista de precios */}
        {(canales ?? []).filter((c) => c.activo).length > 1 ? (
          <div
            className="flex gap-2 overflow-x-auto"
            role="radiogroup"
            aria-label="Canal de venta"
          >
            {(canales ?? [])
              .filter((c) => c.activo)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={canalActivo?.id === c.id}
                  onClick={() => setCanalId(c.id)}
                  className={`h-11 shrink-0 rounded-full px-4 text-sm font-bold transition-colors duration-[var(--motion-fast)] ${
                    canalActivo?.id === c.id
                      ? "bg-wood-700 text-ink-inverse"
                      : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                  }`}
                >
                  {c.nombre}
                  {c.recargo_pct !== 0 ? (
                    <span className="ml-1 font-normal opacity-80">
                      {c.recargo_pct > 0 ? "+" : ""}
                      {c.recargo_pct}%
                    </span>
                  ) : null}
                </button>
              ))}
          </div>
        ) : null}

        {/* Cliente del pedido: sirve para recomendarle lo que suele llevar */}
        {clienteElegido ? (
          <div className="rounded-2xl border border-brand-700 bg-brand-050 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-bold text-ink-950">
                {clienteElegido.name}
              </p>
              <button
                type="button"
                onClick={() => setCustomerId(null)}
                className="shrink-0 text-xs font-bold text-brand-900 underline"
              >
                Quitar
              </button>
            </div>
            <div className="mt-2">
              <SueleLlevar
                customerId={clienteElegido.id}
                onCargar={(items) => {
                  for (const i of items) add(i.product_id, "cocida", i.unidades);
                  showToast(`Cargado lo de siempre de ${clienteElegido.name}`);
                }}
              />
            </div>
          </div>
        ) : null}

        {/* Cómo se lleva: cambia el precio, no el producto ni el stock. Va en
            la misma fila que "cliente conocido": en el celular la grilla de
            productos tiene que verse sin scrollear. */}
        <div className="flex gap-2">
        {!clienteElegido ? (
          <button
            type="button"
            onClick={() => setClienteAbierto(true)}
            aria-label="¿Es un cliente conocido?"
            title="¿Es un cliente conocido?"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-dashed border-[var(--border-strong)] text-ink-700"
          >
            <UserRound size={20} aria-hidden />
          </button>
        ) : null}
        <div
          className="grid flex-1 grid-cols-2 gap-1 rounded-2xl bg-cream-200 p-1"
          role="radiogroup"
          aria-label="Cómo se lleva"
        >
          {(
            [
              { id: "cocida", label: "Cocidas", sub: "por unidad", icon: Flame },
              { id: "congelada", label: "Congeladas", sub: "por docena", icon: Snowflake },
            ] as const
          ).map(({ id, label, sub, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={presentacion === id}
              onClick={() => setPresentacion(id as Presentacion)}
              className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors duration-[var(--motion-fast)] ${
                presentacion === id
                  ? id === "congelada"
                    ? "bg-info-600 text-ink-inverse"
                    : "bg-brand-900 text-ink-inverse"
                  : "text-ink-700"
              }`}
            >
              <Icon size={16} aria-hidden />
              <span>
                {label}
                <span className="ml-1 hidden font-normal opacity-75 sm:inline">
                  {sub}
                </span>
              </span>
            </button>
          ))}
        </div>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-3">
          <Search size={18} className="shrink-0 text-ink-500" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto…"
            aria-label="Buscar producto"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Categorías">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`h-11 shrink-0 rounded-full px-4 text-sm font-bold transition-colors duration-[var(--motion-fast)] ${
                filter === f.id
                  ? "bg-brand-900 text-ink-inverse"
                  : "bg-surface-card text-ink-700 border border-[var(--border-soft)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => (
            <ProductCard
              key={`${p.id}-${presentacion}`}
              product={p}
              presentacion={presentacion}
              qty={quantities[claveLinea(p.id, presentacion)] ?? 0}
              everTracked={trackedIds?.has(p.id) ?? false}
              stockQty={stockLugar?.get(p.id) ?? 0}
              onAdd={() => add(p.id, presentacion)}
              onRemove={() =>
                setQty(
                  p.id,
                  presentacion,
                  (quantities[claveLinea(p.id, presentacion)] ?? 0) -
                    (congeladas ? UNIDADES_POR_DOCENA : 1)
                )
              }
              onQuickQty={() => setQuickFor(p.id)}
            />
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-700">
            {congeladas
              ? "Todavía no hay gustos con precio de docena congelada. Se carga en Configuración."
              : "Ningún producto coincide con la búsqueda."}
          </p>
        ) : null}
      </div>

      {/* Resumen del pedido, fijo abajo */}
      {cart.totalUnits > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-30 mx-auto w-full max-w-screen-xl px-4 pb-2 md:bottom-0 md:pl-60">
          <div className="flex items-center justify-between gap-3 rounded-3xl bg-brand-900 p-3 pl-5 shadow-[0_8px_30px_rgba(7,53,26,0.35)]">
            <div>
              <p className="text-xs font-bold text-brand-100">
                {cart.totalUnits} {cart.totalUnits === 1 ? "unidad" : "unidades"}
                {cart.ahorroTramos + cart.ahorroPromos > 0
                  ? ` · ahorra ${formatARS(cart.ahorroTramos + cart.ahorroPromos)}`
                  : ""}
              </p>
              {cart.promos.length > 0 ? (
                <p className="flex items-center gap-1 text-[0.7rem] font-bold text-gold-500">
                  <Tag size={11} aria-hidden />
                  {cart.promos.map((p) => p.nombre).join(" · ")}
                </p>
              ) : null}
              <p className="tnum text-xl font-bold text-ink-inverse">
                {formatARS(cart.total)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="md"
                className="text-ink-inverse"
                onClick={() => setCartOpen(true)}
              >
                Ver pedido
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="text-ink-inverse"
                aria-label="Guardar como pedido para llevar o delivery"
                title="Guardar como pedido"
                onClick={() => setPedidoAbierto(true)}
              >
                <ClipboardList size={18} />
                <span className="hidden sm:inline">Pedido</span>
              </Button>
              <Button variant="gold" size="lg" onClick={() => setPayOpen(true)}>
                Cobrar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        cart={cart}
        onCheckout={() => setPayOpen(true)}
      />
      <PaymentSheet
        open={payOpen}
        onOpenChange={(o) => {
          setPayOpen(o);
          // Si cierran sin cobrar, el pedido queda guardado igual (sin pagar)
          if (!o && pedidoACobrar) {
            setPedidoACobrar(null);
            clear();
            showToast(`Pedido de ${pedidoACobrar.cliente_nombre} guardado sin cobrar`);
          }
        }}
        total={pedidoACobrar ? pedidoACobrar.total : cart.total}
        titulo={pedidoACobrar ? `Cobrar pedido de ${pedidoACobrar.cliente_nombre}` : "Cobrar"}
        clientePreelegido={customerId}
        onConfirm={confirmSale}
      />
      <NuevoPedidoSheet
        open={pedidoAbierto}
        onOpenChange={setPedidoAbierto}
        total={cart.total + cart.manualDiscount}
        unidades={cart.totalUnits}
        hayDescuentoManual={cart.manualDiscount > 0}
        onGuardar={guardarPedido}
      />
      <ReciboSheet
        sale={reciboAbierto ? ultimaVenta : null}
        onClose={() => setReciboAbierto(false)}
      />

      {/* Elegir cliente antes de armar el pedido, para poder recomendarle */}
      <Sheet
        open={clienteAbierto}
        onOpenChange={(o) => {
          setClienteAbierto(o);
          if (!o) setBuscaCliente("");
        }}
        title="¿Quién es?"
      >
        <div className="flex flex-col gap-2">
          <input
            value={buscaCliente}
            onChange={(e) => setBuscaCliente(e.target.value)}
            placeholder="Buscar cliente…"
            aria-label="Buscar cliente"
            className="h-12 rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          <ul className="flex max-h-[45dvh] flex-col gap-1 overflow-y-auto">
            {(customers ?? [])
              .filter((c) => c.is_active)
              .filter((c) =>
                c.name.toLowerCase().includes(buscaCliente.trim().toLowerCase())
              )
              .slice(0, 12)
              .map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerId(c.id);
                      setClienteAbierto(false);
                      setBuscaCliente("");
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-xl border border-[var(--border-soft)] bg-surface-card px-3 py-2.5 text-left"
                  >
                    <span className="text-sm font-bold text-ink-950">{c.name}</span>
                    <SueleLlevar customerId={c.id} compacto />
                  </button>
                </li>
              ))}
          </ul>
          <p className="text-xs text-ink-500">
            Los clientes nuevos se cargan al cobrar en cuenta corriente, o desde
            la pantalla de Clientes.
          </p>
        </div>
      </Sheet>

      {/* Selector rápido de cantidad */}
      <Sheet
        open={quickFor != null}
        onOpenChange={(o) => !o && setQuickFor(null)}
        title={
          quickProduct
            ? congeladas
              ? `${quickProduct.name} congeladas`
              : quickProduct.name
            : "Cantidad"
        }
      >
        {quickProduct ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-4 gap-2">
              {(congeladas ? [1, 2, 3, 6] : [1, 3, 6, 12]).map((n) => (
                <Button
                  key={n}
                  variant="secondary"
                  size="lg"
                  onClick={() => {
                    add(
                      quickProduct.id,
                      presentacion,
                      congeladas ? n * UNIDADES_POR_DOCENA : n
                    );
                    setQuickFor(null);
                  }}
                >
                  +{n}
                  {congeladas ? (
                    <span className="text-[0.6rem] font-normal">doc</span>
                  ) : null}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="qty-exact"
                className="text-xs font-bold uppercase tracking-wide text-ink-700"
              >
                {congeladas ? "Docenas exactas" : "Cantidad exacta"}
              </label>
              <input
                id="qty-exact"
                type="text"
                inputMode="numeric"
                defaultValue={(() => {
                  const u = quantities[claveLinea(quickProduct.id, presentacion)] ?? 0;
                  return u ? (congeladas ? u / UNIDADES_POR_DOCENA : u) : "";
                })()}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d]/g, ""));
                  const val = Number.isFinite(n) ? n : 0;
                  setQty(
                    quickProduct.id,
                    presentacion,
                    congeladas ? val * UNIDADES_POR_DOCENA : val
                  );
                }}
                className="tnum h-12 w-24 rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-center text-lg font-bold outline-none focus:border-brand-700"
              />
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
