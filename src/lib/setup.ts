import { db, getMeta, setMeta } from "./db";

/** Pasos que no se pueden deducir del dato y el dueño confirma a mano. */
const CLAVE_CONFIRMADO = (id: string) => `setup:${id}`;

export async function confirmarPaso(id: string): Promise<void> {
  await setMeta(CLAVE_CONFIRMADO(id), new Date().toISOString());
}

/**
 * Estado real de la puesta en marcha. No es un tutorial que se marca solo:
 * cada paso se considera hecho cuando el dato existe de verdad en la base.
 */
export interface Paso {
  id: string;
  titulo: string;
  porQue: string;
  href: string;
  cta: string;
  hecho: boolean;
  /** detalle de lo que falta, cuando aplica */
  pendiente?: string;
  /** sólo el dueño puede resolverlo */
  soloAdmin: boolean;
  /** no se deduce del dato: se marca a mano */
  seConfirma?: boolean;
}

export interface EstadoSetup {
  pasos: Paso[];
  hechos: number;
  total: number;
  completo: boolean;
}

export async function calcularSetup(): Promise<EstadoSetup> {
  const [productos, conteos, cajas, ventas, preciosOk] = await Promise.all([
    db.products.toArray(),
    db.stock_counts.count(),
    db.cash_sessions.count(),
    db.sales.count(),
    getMeta(CLAVE_CONFIRMADO("precios")),
  ]);

  const activos = productos.filter((p) => p.is_active);
  const sinCosto = activos.filter((p) => p.cost_per_unit == null);
  const sinMinimo = activos.filter((p) => p.min_qty == null);

  const pasos: Paso[] = [
    {
      id: "precios",
      titulo: "Revisar los precios",
      porQue:
        "Los que trae el sistema son de referencia. Si no coinciden con el pizarrón, cada venta se registra mal.",
      href: "/configuracion",
      cta: "Revisar precios",
      // No hay forma de deducirlo del dato: lo confirma el dueño una vez
      hecho: preciosOk != null,
      soloAdmin: true,
      seConfirma: true,
    },
    {
      id: "costos",
      titulo: "Cargar el costo de cada producto",
      porQue:
        "Sin costo no hay margen: el sistema va a mostrar “—” en vez de inventar una ganancia que no puede calcular.",
      href: "/configuracion",
      cta: "Cargar costos",
      hecho: sinCosto.length === 0 && activos.length > 0,
      pendiente:
        sinCosto.length > 0
          ? `Faltan ${sinCosto.length} de ${activos.length}`
          : undefined,
      soloAdmin: true,
    },
    {
      id: "minimos",
      titulo: "Definir el mínimo de cada producto",
      porQue:
        "Es lo que le permite al sistema avisarte que algo se está por acabar, en vez de enterarte cuando ya no hay.",
      href: "/stock",
      cta: "Definir mínimos",
      hecho: sinMinimo.length === 0 && activos.length > 0,
      pendiente:
        sinMinimo.length > 0
          ? `Faltan ${sinMinimo.length} de ${activos.length}`
          : undefined,
      soloAdmin: true,
    },
    {
      id: "conteo",
      titulo: "Hacer el primer conteo de stock",
      porQue:
        "Es el punto de partida. Sin un conteo inicial el sistema no sabe cuántas hay y no puede detectar faltantes.",
      href: "/stock/conteo",
      cta: "Contar ahora",
      hecho: conteos > 0,
      soloAdmin: false,
    },
    {
      id: "caja",
      titulo: "Abrir la caja",
      porQue:
        "Sin caja abierta no se puede vender. Se abre al empezar el turno con el cambio que tenés.",
      href: "/caja/abrir",
      cta: "Abrir caja",
      hecho: cajas > 0,
      soloAdmin: false,
    },
    {
      id: "venta",
      titulo: "Registrar la primera venta",
      porQue: "Con eso el circuito queda cerrado y el sistema empieza a servir.",
      href: "/vender",
      cta: "Ir a vender",
      hecho: ventas > 0,
      soloAdmin: false,
    },
  ];

  const hechos = pasos.filter((p) => p.hecho).length;
  return { pasos, hechos, total: pasos.length, completo: hechos === pasos.length };
}
