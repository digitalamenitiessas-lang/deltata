import type { Promo, PromoAplicada } from "@/types";

/**
 * Promociones: se definen una vez y después se aplican solas.
 *
 * Tres reglas que no se negocian, porque una promo mal calculada se cobra de
 * verdad:
 *
 * 1. **Una promo nunca sube el precio.** Si el combo sale más caro que lo que
 *    el cliente ya estaba pagando (por ejemplo porque la docena le convenía
 *    más), la promo no se aplica. El ahorro se calcula contra el precio que
 *    ya tenía el pedido con tramos, no contra el precio de lista.
 * 2. **Nada se cuenta dos veces.** El combo consume unidades del pedido; un
 *    descuento por porcentaje sólo mira lo que quedó libre.
 * 3. **El ahorro total nunca supera el pedido.** No existe el total negativo.
 */

/** Una unidad disponible del pedido, al precio que ya tiene con tramos. */
export interface UnidadDisponible {
  product_id: string;
  kind: string;
  presentacion: string;
  /** precio efectivo por unidad, ya con tramos y canal aplicados */
  unit_price: number;
  qty: number;
}

export interface ContextoPromo {
  canalId: string | null;
  ahora: Date;
}

const minutos = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
};

const diaHabilitado = (promo: Promo, dia: number): boolean =>
  promo.dias == null || promo.dias.length === 0 || promo.dias.includes(dia);

/**
 * ¿Corre esta promo ahora mismo?
 *
 * La franja puede cruzar la medianoche: el turno noche va de 20:00 a 00:00 o
 * 01:00. En ese caso, a las 00:30 la jornada que corre es la de AYER, así que
 * el día se evalúa contra el día anterior. Sin esto, una promo de "sábado a la
 * noche" se apagaría justo a las doce.
 */
export function promoVigente(promo: Promo, ctx: ContextoPromo): boolean {
  if (!promo.activo) return false;
  if (promo.canal_id != null && promo.canal_id !== ctx.canalId) return false;

  const dia = ctx.ahora.getDay();
  const ahora = ctx.ahora.getHours() * 60 + ctx.ahora.getMinutes();
  const desde = promo.desde ? minutos(promo.desde) : null;
  const hasta = promo.hasta ? minutos(promo.hasta) : null;

  if (desde == null && hasta == null) return diaHabilitado(promo, dia);

  const d = desde ?? 0;
  const h = hasta ?? 24 * 60;

  if (d <= h) return diaHabilitado(promo, dia) && ahora >= d && ahora < h;

  // Cruza la medianoche
  if (ahora < h) return diaHabilitado(promo, (dia + 6) % 7);
  return diaHabilitado(promo, dia) && ahora >= d;
}

/** Texto corto para mostrar la promo en pantalla. */
export function describirPromo(promo: Promo, nombreBebida?: string): string {
  if (promo.tipo === "combo") {
    const bebida = promo.bebida_product_id
      ? (nombreBebida ?? "una bebida")
      : "una bebida";
    const cantBebida = promo.bebida_qty ?? 1;
    return `${promo.empanadas_qty ?? 0} empanadas + ${
      cantBebida > 1 ? `${cantBebida} ${bebida}` : bebida
    } a $${(promo.precio_fijo ?? 0).toLocaleString("es-AR")}`;
  }
  const alcance = promo.product_id
    ? "en un producto"
    : promo.kind
      ? `en ${promo.kind === "empanada" ? "empanadas" : promo.kind === "bebida" ? "bebidas" : "otros"}`
      : "en todo el pedido";
  const cuanto =
    promo.tipo === "porcentaje"
      ? `${promo.valor ?? 0}%`
      : `$${(promo.valor ?? 0).toLocaleString("es-AR")}`;
  const minimo =
    promo.minimo_unidades != null && promo.minimo_unidades > 0
      ? ` desde ${promo.minimo_unidades} u.`
      : "";
  return `${cuanto} ${alcance}${minimo}`;
}

/** Días en texto, para la pantalla de configuración. */
const NOMBRE_DIA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function describirVigencia(promo: Promo): string {
  const dias =
    promo.dias == null || promo.dias.length === 0 || promo.dias.length === 7
      ? "Todos los días"
      : promo.dias
          .slice()
          .sort((a, b) => a - b)
          .map((d) => NOMBRE_DIA[d] ?? "")
          .join(", ");
  if (!promo.desde && !promo.hasta) return dias;
  const franja = `${promo.desde ?? "00:00"} a ${promo.hasta ?? "23:59"}`;
  return `${dias} · ${franja}`;
}

/**
 * Cuánto descuenta cada promo en este pedido.
 *
 * Recibe las unidades al precio que YA tienen (con tramos y canal aplicados),
 * así el ahorro de la promo es el ahorro adicional y nunca se duplica con el
 * precio por docena.
 */
export function aplicarPromos(
  disponibles: UnidadDisponible[],
  promos: Promo[],
  ctx: ContextoPromo,
  subtotal: number
): PromoAplicada[] {
  // Pool mutable: el combo consume unidades y el resto ve lo que quedó
  const pool = disponibles
    .filter((u) => u.qty > 0)
    .map((u) => ({ ...u }));

  const vigentes = promos
    .filter((p) => promoVigente(p, ctx))
    .sort((a, b) => a.sort_order - b.sort_order);

  const aplicadas: PromoAplicada[] = [];
  const techo = Math.max(0, subtotal);
  let ahorroTotal = 0;

  for (const promo of vigentes) {
    const disponible = techo - ahorroTotal;
    if (disponible <= 0) break;

    const candidata =
      promo.tipo === "combo"
        ? aplicarCombo(promo, pool)
        : aplicarDescuento(promo, pool);
    if (!candidata || candidata.ahorro <= 0) continue;

    // Regla 3: el pedido nunca queda en negativo
    candidata.ahorro = Math.min(candidata.ahorro, disponible);
    ahorroTotal += candidata.ahorro;
    aplicadas.push(candidata);
  }

  return aplicadas;
}

/**
 * Combo: N empanadas + M de una bebida a precio fijo.
 *
 * Consume primero las unidades MÁS BARATAS del pedido. Es la lectura
 * conservadora: el descuento que se calcula es el mínimo honesto, y así el
 * combo nunca termina regalando la empanada cara del pedido.
 */
function aplicarCombo(
  promo: Promo,
  pool: UnidadDisponible[]
): PromoAplicada | null {
  const necesitaEmpanadas = Math.max(0, Math.floor(promo.empanadas_qty ?? 0));
  const necesitaBebidas = Math.max(0, Math.floor(promo.bebida_qty ?? 1));
  const precioFijo = promo.precio_fijo;
  if (necesitaEmpanadas === 0 || precioFijo == null) return null;

  // Las congeladas ya se venden por docena cerrada: no entran al combo
  const empanadas = pool
    .filter((u) => u.kind === "empanada" && u.presentacion === "cocida")
    .sort((a, b) => a.unit_price - b.unit_price);
  const bebidas = pool
    .filter(
      (u) =>
        u.kind === "bebida" &&
        (promo.bebida_product_id == null ||
          u.product_id === promo.bebida_product_id)
    )
    .sort((a, b) => a.unit_price - b.unit_price);

  const totalEmpanadas = empanadas.reduce((a, u) => a + u.qty, 0);
  const totalBebidas = bebidas.reduce((a, u) => a + u.qty, 0);

  let veces = Math.floor(totalEmpanadas / necesitaEmpanadas);
  if (necesitaBebidas > 0) {
    veces = Math.min(veces, Math.floor(totalBebidas / necesitaBebidas));
  }
  if (veces <= 0) return null;

  // Cuánto vale hoy lo que entra al combo, al precio que ya tiene el pedido
  const tomar = (
    lista: UnidadDisponible[],
    cuantas: number
  ): { valor: number; consumo: { u: UnidadDisponible; qty: number }[] } => {
    let faltan = cuantas;
    let valor = 0;
    const consumo: { u: UnidadDisponible; qty: number }[] = [];
    for (const u of lista) {
      if (faltan <= 0) break;
      const usa = Math.min(u.qty, faltan);
      valor += usa * u.unit_price;
      consumo.push({ u, qty: usa });
      faltan -= usa;
    }
    return { valor, consumo };
  };

  const emp = tomar(empanadas, necesitaEmpanadas * veces);
  const beb = tomar(bebidas, necesitaBebidas * veces);
  const valorNormal = emp.valor + beb.valor;
  const ahorro = Math.round(valorNormal - precioFijo * veces);

  // Regla 1: si el combo sale más caro que lo que ya pagaba, no se aplica
  if (ahorro <= 0) return null;

  for (const { u, qty } of [...emp.consumo, ...beb.consumo]) u.qty -= qty;

  return { promo_id: promo.id, nombre: promo.nombre, veces, ahorro };
}

/** Porcentaje o monto fijo sobre lo que quedó libre del pedido. */
function aplicarDescuento(
  promo: Promo,
  pool: UnidadDisponible[]
): PromoAplicada | null {
  const alcance = pool.filter(
    (u) =>
      u.qty > 0 &&
      (promo.product_id == null || u.product_id === promo.product_id) &&
      (promo.kind == null || u.kind === promo.kind)
  );
  const unidades = alcance.reduce((a, u) => a + u.qty, 0);
  const base = alcance.reduce((a, u) => a + u.qty * u.unit_price, 0);

  if (unidades <= 0 || base <= 0) return null;
  if (promo.minimo_unidades != null && unidades < promo.minimo_unidades) {
    return null;
  }

  const valor = promo.valor ?? 0;
  if (valor <= 0) return null;

  const ahorro =
    promo.tipo === "porcentaje"
      ? Math.round((base * Math.min(valor, 100)) / 100)
      : Math.round(Math.min(valor, base));

  if (ahorro <= 0) return null;

  return { promo_id: promo.id, nombre: promo.nombre, veces: 1, ahorro };
}
