"use client";

import Link from "next/link";
import {
  Store,
  Wallet,
  Package,
  ChartNoAxesColumn,
  Users,
  ReceiptText,
  History,
  Settings,
  ShieldCheck,
  Percent,
  HandCoins,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/AppShell";
import { useSesion, esAdmin } from "@/stores/sesion";

interface Modulo {
  href: string;
  icon: LucideIcon;
  nombre: string;
  queHace: string;
  cuando: string;
  ojo?: string;
  soloAdmin: boolean;
}

const MODULOS: Modulo[] = [
  {
    href: "/vender",
    icon: Store,
    nombre: "Vender",
    queHace:
      "Registra cada venta y descuenta el stock solo. Arriba elegís si van cocidas (por unidad) o congeladas (por docena); tocás los gustos, elegís cómo pagan y listo. Si el cliente pide el recibo, después de cobrar aparece el botón para mandárselo por WhatsApp.",
    cuando: "Todo el tiempo, mientras hay gente.",
    ojo: "Cocidas y congeladas son las mismas empanadas y el mismo stock: cambia el precio, no el pozo. Un pedido puede llevar las dos cosas del mismo gusto. La media docena y la docena se arman con todas las cocidas del pedido, sin importar el gusto: 6 surtidas salen lo mismo que 6 de carne, y 14 son una docena + 2 sueltas. Si un gusto tiene otro precio, arma su propia docena aparte.",
    soloAdmin: false,
  },
  {
    href: "/caja",
    icon: Wallet,
    nombre: "Caja",
    queHace:
      "Abre el turno con el cambio inicial y lo cierra contando la plata. Calcula cuánto tendría que haber y cuánto hay. Cada lugar (foodtruck, casa, PedidosYa) lleva su propia caja.",
    cuando: "Al empezar y al terminar el día, en cada lugar.",
    ojo: "Al cerrar te pide contar primero y recién después te muestra lo esperado. Es a propósito: si ves el número antes, el conteo no sirve para detectar nada. Y las cajas van separadas porque si compartieran arqueo, el descuadre de un lugar taparía el del otro.",
    soloAdmin: false,
  },
  {
    href: "/stock",
    icon: Package,
    nombre: "Stock",
    queHace:
      "Lleva cuántas hay de cada gusto. Registra lo que entra, lo que se rompe o quema, y los conteos físicos.",
    cuando: "Cuando llega mercadería, cuando se pierde algo, y para contar.",
    ojo: "Hay un solo stock por gusto. Se descuenta igual si la empanada sale cocida o si se va congelada por docena, porque físicamente es la misma. El conteo también es a ciegas: si el número contado no coincide con el del sistema, ahí aparece la diferencia.",
    soloAdmin: false,
  },
  {
    href: "/gastos",
    icon: ReceiptText,
    nombre: "Gastos",
    queHace:
      "Anota lo que se paga: mercadería, gas, combustible, lo que sea.",
    cuando: "Cada vez que sale plata.",
    ojo: "Un gasto en efectivo con la caja abierta se descuenta del arqueo. Por eso al cerrar no aparece como si faltara plata.",
    soloAdmin: false,
  },
  {
    href: "/clientes",
    icon: Users,
    nombre: "Clientes",
    queHace:
      "Las cuentas corrientes: quién debe, cuánto y desde cuándo. Registrás los pagos acá. Y guarda lo que suele llevar cada uno, para poder recomendarle.",
    cuando: "Cuando alguien se lleva fiado o viene a pagar, y al atender a un conocido.",
    ojo: "Si el cliente se pasa del límite te avisa, pero no te frena. La decisión de fiar es tuya, no del sistema. El “suele llevar” aparece recién cuando repitió: con una sola visita no hay costumbre que recordar, y recomendar sobre un dato de una vez sería inventarlo.",
    soloAdmin: false,
  },
  {
    href: "/control",
    icon: ChartNoAxesColumn,
    nombre: "Control",
    queHace:
      "El resumen del negocio: cuánto se vendió, ticket promedio, margen, y las situaciones que necesitan tu atención.",
    cuando: "Cuando querés saber cómo viene la cosa.",
    ojo: "Si falta cargar un costo, el margen muestra “—” en vez de un número inventado. Un número falso es peor que ninguno.",
    soloAdmin: true,
  },
  {
    href: "/auditoria",
    icon: ShieldCheck,
    nombre: "Auditoría",
    queHace:
      "Todo lo que pasó, con nombre y hora: ventas, mermas, ajustes, cambios de precio, cierres. No se puede borrar.",
    cuando: "Cuando algo no cierra y querés saber qué pasó.",
    ojo: "Arriba de todo destaca lo que puede tapar un faltante: mermas, ajustes y cambios de precio. Son los que conviene mirar primero.",
    soloAdmin: true,
  },
  {
    href: "/historial",
    icon: History,
    nombre: "Historial",
    queHace: "La lista de todo lo que se registró en este dispositivo.",
    cuando: "Para buscar una venta o un movimiento puntual.",
    soloAdmin: false,
  },
  {
    href: "/configuracion",
    icon: Settings,
    nombre: "Configuración",
    queHace:
      "Precios: por unidad, por docena cocida y por docena congelada. También el costo de cada producto, la alerta de mínimo, y el alta y baja de productos.",
    cuando: "Cuando cambian los precios o entra un gusto nuevo.",
    ojo: "Un gusto aparece en el modo Congeladas sólo si le cargaste el precio de docena congelada. Sin ese precio, el sistema no lo ofrece en vez de inventar uno. Y si eliminás un producto que ya se vendió, sale del catálogo pero se conserva el histórico: si se borrara del todo, las ventas viejas quedarían apuntando a la nada.",
    soloAdmin: true,
  },
  {
    href: "/empleados",
    icon: HandCoins,
    nombre: "Empleados",
    queHace:
      "Cuánto se le pagó a cada uno y cuándo fue el último pago.",
    cuando: "Cuando pagás un sueldo o un adelanto, y a fin de mes para revisar.",
    ojo: "El pago se carga desde Gastos con la categoría Sueldos, eligiendo a quién. No hay una segunda planilla a propósito: si el pago se anotara en dos lados, tarde o temprano los dos números dejarían de coincidir. Como es un gasto, si lo pagás en efectivo con la caja abierta ya descuenta del arqueo.",
    soloAdmin: true,
  },
  {
    href: "/configuracion",
    icon: Percent,
    nombre: "Promos",
    queHace:
      "Combos y descuentos que se aplican solos: “6 empanadas + una bebida a tal precio”, o un porcentaje sobre las bebidas. Podés limitarlos a ciertos días y a una franja horaria.",
    cuando: "Cuando querés mover un producto o armar la promo del fin de semana.",
    ojo: "La promo se calcula sobre el precio que el pedido YA tiene con media docena y docena, así el mismo ahorro no se cuenta dos veces. Y nunca sube el precio: si el combo sale más caro que lo que el cliente ya pagaba, no se aplica. Cada promo aplicada aparece con su nombre en el pedido y en el recibo.",
    soloAdmin: true,
  },
];

const DIA = [
  {
    n: "01",
    t: "Abrís la caja",
    d: "Con el cambio que tenés en la mano. Sin esto no se puede vender.",
  },
  {
    n: "02",
    t: "Vendés",
    d: "Cada venta descuenta el stock sola. Funciona sin internet.",
  },
  {
    n: "03",
    t: "Anotás los gastos",
    d: "Lo que se paga en el día, sobre todo lo que sale de la caja.",
  },
  {
    n: "04",
    t: "Contás lo que quedó",
    d: "El conteo físico es lo que permite descubrir si falta mercadería.",
  },
  {
    n: "05",
    t: "Cerrás la caja",
    d: "Contás la plata. El sistema te dice si coincide con lo que esperaba.",
  },
];

export default function GuiaPage() {
  const usuario = useSesion((s) => s.usuario);
  const admin = esAdmin(usuario);
  const modulos = MODULOS.filter((m) => !m.soloAdmin || admin);

  return (
    <>
      <PageHeader title="Guía" subtitle="Qué hace cada parte del sistema" />

      <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 pb-10">
        {/* Para qué sirve todo esto */}
        <section className="rounded-3xl bg-brand-900 p-5 text-ink-inverse">
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-bold">
            Para qué sirve
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-brand-100">
            Para saber tres cosas al final del día:{" "}
            <span className="font-bold text-ink-inverse">cuánto se vendió</span>,{" "}
            <span className="font-bold text-ink-inverse">cuánto quedó</span> y{" "}
            <span className="font-bold text-ink-inverse">
              si falta algo
            </span>
            . Todo lo demás está al servicio de eso.
          </p>
        </section>

        {/* El circuito de un día */}
        <section>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-bold text-ink-950">
            Un día de trabajo
          </h2>
          <ol className="mt-4 flex flex-col gap-2">
            {DIA.map((p, i) => (
              <li key={p.n} className="relative flex gap-4">
                {/* línea que une los pasos */}
                {i < DIA.length - 1 ? (
                  <span
                    className="absolute left-[15px] top-8 h-[calc(100%-8px)] w-px bg-[var(--border-strong)]"
                    aria-hidden
                  />
                ) : null}
                <span className="tnum relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-900 text-xs font-bold text-ink-inverse">
                  {p.n}
                </span>
                <div className="pb-4">
                  <p className="text-sm font-bold text-ink-950">{p.t}</p>
                  <p className="mt-0.5 text-sm text-ink-700">{p.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="repulgue" aria-hidden />

        {/* Cada módulo */}
        <section>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-bold text-ink-950">
            Cada sección
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {modulos.map(({ href, icon: Icon, nombre, queHace, cuando, ojo }) => (
              <li key={href}>
                <div className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-5">
                  <Link href={href} className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-050">
                      <Icon size={20} className="text-brand-900" aria-hidden />
                    </span>
                    <h3 className="font-[family-name:var(--font-fraunces)] text-xl font-bold text-ink-950">
                      {nombre}
                    </h3>
                  </Link>

                  <p className="mt-3 text-sm leading-relaxed text-ink-950">
                    {queHace}
                  </p>
                  <p className="mt-2 text-xs text-ink-500">
                    <span className="font-bold uppercase tracking-wide">
                      Cuándo:
                    </span>{" "}
                    {cuando}
                  </p>
                  {ojo ? (
                    <p className="mt-3 rounded-2xl bg-cream-100 px-3 py-2 text-xs leading-relaxed text-ink-700">
                      <span className="font-bold text-ink-950">Ojo: </span>
                      {ojo}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="repulgue" aria-hidden />

        {/* Sin internet */}
        <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-5">
          <div className="flex items-center gap-3">
            <Wifi size={20} className="text-brand-900" aria-hidden />
            <h2 className="font-[family-name:var(--font-fraunces)] text-xl font-bold text-ink-950">
              Sin internet también anda
            </h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-700">
            La venta se guarda en el celular al instante, tengas señal o no. Lo
            que todavía no viajó al servidor se cuenta arriba a la derecha, al
            lado del estado de conexión. Cuando vuelve la señal se manda solo.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">
            No hace falta esperar ni reintentar a mano: aunque toques varias
            veces, una venta nunca se registra dos veces.
          </p>
        </section>

        {/* Reglas que no se negocian */}
        <section>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-bold text-ink-950">
            Por qué el sistema es así
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {[
              {
                t: "Se cuenta antes de ver lo esperado",
                d: "Tanto la caja como el stock. Si primero ves el número que debería dar, terminás contando para que coincida y el control deja de servir.",
              },
              {
                t: "Cero no es lo mismo que “no sé”",
                d: "Si nunca contaste un gusto, dice “nunca contado”, no “0”. Si no cargaste un costo, dice “sin costo”, no “$0”. Un dato falso rompe todos los números que dependen de él.",
              },
              {
                t: "Todo se cuenta en unidades",
                d: "La docena existe para cobrar, pero el stock siempre se lleva de a una. Así nunca hay que adivinar si “3” son tres empanadas o tres docenas.",
              },
              {
                t: "Lo que se cierra no se edita",
                d: "Una caja cerrada queda como está. Si hubo un error, se corrige con un ajuste que queda registrado. Borrar el error es borrar la evidencia.",
              },
            ].map((r) => (
              <li
                key={r.t}
                className="rounded-2xl border-l-2 border-gold-500 bg-surface-card py-1 pl-4"
              >
                <p className="text-sm font-bold text-ink-950">{r.t}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-700">
                  {r.d}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
