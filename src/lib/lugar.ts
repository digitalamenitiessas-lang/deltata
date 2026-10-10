import { db } from "./db";
import type { Canal, Ubicacion } from "@/types";

/**
 * El lugar de lo que no dice dónde ocurrió. Antes del local había un solo
 * lugar, el foodtruck: todo lo viejo es de ahí. Es el mismo id que usa la base.
 */
export const UBICACION_FOODTRUCK = "0b1c0000-0000-4000-8000-000000000001";
export const UBICACION_LOCAL = "0b1c0000-0000-4000-8000-000000000002";

/** De qué congelador sale lo que se vende por un canal. */
export function ubicacionDeCanal(canal: Pick<Canal, "ubicacion_id"> | null | undefined): string {
  return canal?.ubicacion_id ?? UBICACION_FOODTRUCK;
}

/** Cuánto hay de un producto en un lugar (0 si nunca hubo nada). */
export async function stockEn(productId: string, ubicacionId: string): Promise<number> {
  const fila = await db.stock_ubic.get([productId, ubicacionId]);
  return fila?.qty ?? 0;
}

/**
 * Suma (o resta) en el saldo de un lugar y en el total del producto. Va
 * siempre dentro de la transacción de la operación que lo mueve.
 */
export async function moverStock(
  productId: string,
  ubicacionId: string,
  qty: number,
  cuando: string
): Promise<number> {
  const actual = await stockEn(productId, ubicacionId);
  const saldo = actual + qty;
  await db.stock_ubic.put({ product_id: productId, ubicacion_id: ubicacionId, qty: saldo });
  const producto = await db.products.get(productId);
  if (producto) {
    await db.products.update(productId, {
      current_qty: producto.current_qty + qty,
      updated_at: cuando,
    });
  }
  return saldo;
}

/** El canal con el que arranca Vender en un equipo ubicado en `ubicacionId`. */
export function canalDelLugar(
  canales: Canal[],
  ubicacionId: string | null
): Canal | null {
  const activos = canales.filter((c) => c.activo);
  if (ubicacionId) {
    const delLugar = activos
      .filter((c) => ubicacionDeCanal(c) === ubicacionId)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (delLugar.length > 0) return delLugar[0];
  }
  return activos.find((c) => c.es_default) ?? activos[0] ?? null;
}

export const nombreUbicacion = (ubicaciones: Ubicacion[] | undefined, id: string | null | undefined) =>
  (ubicaciones ?? []).find((u) => u.id === (id ?? UBICACION_FOODTRUCK))?.nombre ?? "";
