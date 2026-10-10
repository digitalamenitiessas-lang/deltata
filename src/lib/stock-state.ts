import type { Product } from "@/types";

// Criticidad sin ruido (trampa #4 de la base técnica): una alerta significa
// "hacé algo ahora". "Sin mínimo definido" y "nunca contado" son estados
// informativos, no alarmas.

export type StockState =
  | "negativo"
  | "sin_stock"
  | "critico"
  | "bajo"
  | "normal"
  | "sin_minimo"
  | "nunca_contado"
  | "inactivo";

/**
 * `qty` es lo que hay en el lugar que se está mirando (local o foodtruck); sin
 * él, el total. El mínimo es por lugar: cada congelador tiene que tenerlo.
 */
export function stockState(
  product: Product,
  everTracked: boolean,
  qty: number = product.current_qty
): StockState {
  if (!product.is_active) return "inactivo";
  if (!everTracked) return "nunca_contado";
  if (qty < 0) return "negativo";
  if (qty === 0) return "sin_stock";
  if (product.min_qty == null) return "sin_minimo";
  if (qty <= product.min_qty / 2) return "critico";
  if (qty <= product.min_qty) return "bajo";
  return "normal";
}

export const STOCK_STATE_LABELS: Record<StockState, string> = {
  negativo: "Negativo",
  sin_stock: "Sin stock",
  critico: "Crítico",
  bajo: "Bajo",
  normal: "Normal",
  sin_minimo: "Sin mínimo definido",
  nunca_contado: "Nunca contado",
  inactivo: "Inactivo",
};

/** Estado breve para la tarjeta del POS (no siempre muestra la cifra exacta). */
export function saleCardStockLabel(
  product: Product,
  everTracked: boolean,
  qty: number = product.current_qty
): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (!everTracked) return { label: "Stock sin contar", tone: "muted" };
  if (qty < 0) return { label: `Negativo (${qty})`, tone: "danger" };
  if (qty === 0) return { label: "Sin stock", tone: "danger" };
  if (qty <= 3) return { label: `Últimas ${qty}`, tone: "warn" };
  if (qty <= 12) return { label: `Quedan ${qty}`, tone: "warn" };
  return { label: "Disponible", tone: "ok" };
}
