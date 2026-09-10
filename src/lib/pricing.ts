import {
  UNIDADES_POR_DOCENA,
  type Canal,
  type CanalPrecio,
  type Presentacion,
  type Product,
  type Promo,
  type PromoAplicada,
  type SaleItem,
} from "@/types";
import { calcularTramos, sugerirTramo, type Desglose, type Tarifa } from "./tramos";
import { aplicarPromos, type UnidadDisponible } from "./promos";

/**
 * El carrito guarda unidades, siempre. La clave distingue la presentación
 * porque el mismo gusto se puede llevar cocido y congelado en el mismo pedido.
 */
export const claveLinea = (productId: string, p: Presentacion) =>
  `${productId}|${p}`;

export function partirClave(clave: string): {
  productId: string;
  presentacion: Presentacion;
} {
  const [productId, presentacion] = clave.split("|");
  return { productId, presentacion: (presentacion as Presentacion) ?? "cocida" };
}

/**
 * Precio efectivo de un producto en un canal.
 * Orden: precio propio del canal → precio base con el recargo del canal.
 * Así el dueño puede fijar un precio puntual sin perder el recargo general.
 */
export function tarifaDe(
  product: Product,
  canal: Canal | null,
  override: CanalPrecio | undefined
): Tarifa & { congelada: number | null } {
  const factor = 1 + (canal?.recargo_pct ?? 0) / 100;
  const conRecargo = (v: number | null) =>
    v == null ? null : Math.round(v * factor);

  return {
    unidad: override?.unit_price ?? conRecargo(product.unit_price) ?? 0,
    media: override?.half_dozen_price ?? conRecargo(product.half_dozen_price),
    docena: override?.dozen_price ?? conRecargo(product.dozen_price),
    congelada:
      override?.frozen_dozen_price ?? conRecargo(product.frozen_dozen_price),
  };
}

export interface CartLine extends SaleItem {
  kind: Product["kind"];
  /** cómo se armó el precio: docenas, medias y sueltas */
  desglose: Desglose;
  /** cuántas faltan para que convenga el tramo siguiente */
  sugerencia: { faltan: number; nuevoTotal: number; ahorro: number } | null;
}

export interface CartComputation {
  lines: CartLine[];
  /** lo que saldría sin tramos: sirve para mostrar cuánto se ahorró */
  sinTramos: number;
  ahorroTramos: number;
  /** promos que entraron solas, con su nombre y cuánto descontó cada una */
  promos: PromoAplicada[];
  ahorroPromos: number;
  manualDiscount: number;
  total: number;
  totalUnits: number;
  unidadesCongeladas: number;
}

/**
 * Precio del pedido, con los tramos del canal activo.
 *
 * - Cocidas: se arma el combo más barato entre docenas, medias y sueltas.
 *   6 salen $12.000 y no 6 × $2.500; 14 salen 1 docena + 2 sueltas.
 * - Congeladas: ya se venden por docena, así que van a su propio precio.
 *
 * Las promos entran DESPUÉS de los tramos y sobre el precio ya rebajado, para
 * que el mismo ahorro no se cuente dos veces.
 */
export function computeCart(
  products: Product[],
  quantities: Record<string, number>,
  manualDiscount = 0,
  canal: Canal | null = null,
  precios: CanalPrecio[] = [],
  promos: Promo[] = [],
  ahora: Date = new Date()
): CartComputation {
  const byId = new Map(products.map((p) => [p.id, p]));
  const overrides = new Map(precios.map((c) => [c.product_id, c]));
  const lines: CartLine[] = [];
  let sinTramos = 0;

  for (const [clave, qty] of Object.entries(quantities)) {
    if (qty <= 0) continue;
    const { productId, presentacion } = partirClave(clave);
    const product = byId.get(productId);
    if (!product) continue;
    const tarifa = tarifaDe(product, canal, overrides.get(productId));

    if (presentacion === "congelada") {
      if (tarifa.congelada == null) continue;
      const docenas = qty / UNIDADES_POR_DOCENA;
      const total = docenas * tarifa.congelada;
      sinTramos += total;
      lines.push({
        product_id: product.id,
        product_name: product.name,
        qty,
        unit_price: tarifa.congelada / UNIDADES_POR_DOCENA,
        line_total: total,
        presentacion,
        kind: product.kind,
        desglose: { docenas, medias: 0, sueltas: 0, total },
        sugerencia: null,
      });
    } else {
      const desglose = calcularTramos(qty, tarifa);
      sinTramos += qty * tarifa.unidad;
      lines.push({
        product_id: product.id,
        product_name: product.name,
        qty,
        unit_price: desglose.total / qty,
        line_total: desglose.total,
        presentacion: "cocida",
        kind: product.kind,
        desglose,
        // Sólo tiene sentido sugerir en empanadas con tramos cargados
        sugerencia:
          tarifa.media != null || tarifa.docena != null
            ? sugerirTramo(qty, tarifa)
            : null,
      });
    }
  }

  const subtotalTramos = lines.reduce((acc, l) => acc + l.line_total, 0);

  // Unidades al precio que ya tienen con tramos: así el combo descuenta sobre
  // el precio real del pedido y no sobre el de lista.
  const disponibles: UnidadDisponible[] = lines.map((l) => ({
    product_id: l.product_id,
    kind: l.kind,
    presentacion: l.presentacion,
    unit_price: l.unit_price,
    qty: l.qty,
  }));
  const aplicadas = aplicarPromos(
    disponibles,
    promos,
    { canalId: canal?.id ?? null, ahora },
    subtotalTramos
  );
  const ahorroPromos = aplicadas.reduce((acc, p) => acc + p.ahorro, 0);

  const conPromos = Math.max(0, subtotalTramos - ahorroPromos);
  const clampedManual = Math.max(0, Math.min(manualDiscount, conPromos));
  const total = Math.max(0, conPromos - clampedManual);

  return {
    lines,
    sinTramos,
    ahorroTramos: Math.max(0, sinTramos - subtotalTramos),
    promos: aplicadas,
    ahorroPromos,
    manualDiscount: clampedManual,
    total,
    totalUnits: lines.reduce((acc, l) => acc + l.qty, 0),
    unidadesCongeladas: lines
      .filter((l) => l.presentacion === "congelada")
      .reduce((acc, l) => acc + l.qty, 0),
  };
}
