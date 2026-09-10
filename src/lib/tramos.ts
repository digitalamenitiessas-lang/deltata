import { UNIDADES_POR_DOCENA } from "@/types";

export const UNIDADES_POR_MEDIA = 6;

export interface Tarifa {
  unidad: number;
  /** null = no hay tramo de media docena */
  media: number | null;
  /** null = no hay tramo de docena */
  docena: number | null;
}

export interface Desglose {
  docenas: number;
  medias: number;
  sueltas: number;
  total: number;
}

/**
 * Cuánto sale llevarse exactamente N unidades.
 *
 * No alcanza con dividir por 12: con media docena a $12.000 y docena a
 * $24.000, llevarse 6 tiene que costar $12.000 y no 6 × $2.500. Y hay casos
 * donde conviene combinar (14 = una docena + 2 sueltas).
 *
 * Se resuelve con programación dinámica en vez de reglas sueltas: para cada
 * cantidad se elige el armado más barato. Así funciona con cualquier
 * combinación de tramos que cargue el dueño, incluso si mañana suma otro.
 */
export function calcularTramos(unidades: number, tarifa: Tarifa): Desglose {
  const n = Math.max(0, Math.floor(unidades));
  if (n === 0) return { docenas: 0, medias: 0, sueltas: 0, total: 0 };

  // De mayor a menor: ante dos armados del mismo precio gana el tramo más
  // grande, para que 12 se lea "1 docena" y no "2 medias".
  const opciones: { size: number; precio: number; tipo: keyof Desglose }[] = [];
  if (tarifa.docena != null)
    opciones.push({ size: UNIDADES_POR_DOCENA, precio: tarifa.docena, tipo: "docenas" });
  if (tarifa.media != null)
    opciones.push({ size: UNIDADES_POR_MEDIA, precio: tarifa.media, tipo: "medias" });
  opciones.push({ size: 1, precio: tarifa.unidad, tipo: "sueltas" });

  const costo = new Array<number>(n + 1).fill(Infinity);
  const usado = new Array<number>(n + 1).fill(-1);
  costo[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let o = 0; o < opciones.length; o++) {
      const { size, precio } = opciones[o];
      if (size > i) continue;
      const cand = costo[i - size] + precio;
      if (cand < costo[i]) {
        costo[i] = cand;
        usado[i] = o;
      }
    }
  }

  const res: Desglose = { docenas: 0, medias: 0, sueltas: 0, total: costo[n] };
  let i = n;
  while (i > 0 && usado[i] >= 0) {
    const o = opciones[usado[i]];
    res[o.tipo] += 1;
    i -= o.size;
  }
  return res;
}

/**
 * ¿Conviene sumar unas pocas para llegar al tramo siguiente?
 * Devuelve la sugerencia sólo si sale más barato o igual llevándose MÁS.
 * Nunca cambia el pedido por su cuenta: es información para el que atiende.
 */
export function sugerirTramo(
  unidades: number,
  tarifa: Tarifa
): { faltan: number; nuevoTotal: number; ahorro: number } | null {
  if (unidades <= 0) return null;
  const actual = calcularTramos(unidades, tarifa).total;
  const techo = Math.max(UNIDADES_POR_DOCENA, UNIDADES_POR_MEDIA);

  for (let extra = 1; extra <= techo; extra++) {
    const total = calcularTramos(unidades + extra, tarifa).total;
    if (total <= actual) {
      return { faltan: extra, nuevoTotal: total, ahorro: actual - total };
    }
  }
  return null;
}

/** Texto corto del armado, para mostrar en la línea del carrito. */
export function describirDesglose(d: Desglose): string {
  const partes: string[] = [];
  if (d.docenas > 0)
    partes.push(`${d.docenas} ${d.docenas === 1 ? "docena" : "docenas"}`);
  if (d.medias > 0)
    partes.push(`${d.medias} ${d.medias === 1 ? "media" : "medias"}`);
  if (d.sueltas > 0)
    partes.push(`${d.sueltas} ${d.sueltas === 1 ? "suelta" : "sueltas"}`);
  return partes.join(" + ");
}
