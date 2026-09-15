import { formatARS } from "./money";
import { UNIDADES_POR_DOCENA, type Sale } from "@/types";

/**
 * Recibo y comanda digital por WhatsApp.
 *
 * Sin API ni tokens: se arma el texto y se abre WhatsApp con el mensaje ya
 * escrito. Funciona desde el celular del foodtruck tal como está, y el que
 * atiende sólo toca "enviar". No se manda nada solo: el mensaje sale cuando
 * la persona lo aprueba en WhatsApp.
 */

const NEGOCIO = "Del Tata · Empanadas Tucumanas";

/**
 * Un teléfono argentino escrito como lo escribe la gente → el formato que
 * necesita wa.me (54 + 9 + área sin 0 + número sin 15).
 *
 * Devuelve null si no llega a parecer un número: mejor pedirlo de nuevo que
 * mandarle el recibo a un desconocido.
 */
export function normalizarTelefono(raw: string): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d === "") return null;

  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.startsWith("9") && d.length > 10) d = d.slice(1);

  // El "15" del celular va después del código de área (2, 3 o 4 dígitos)
  if (d.length === 12) {
    for (const corte of [3, 2, 4]) {
      if (d.slice(corte, corte + 2) === "15") {
        d = d.slice(0, corte) + d.slice(corte + 2);
        break;
      }
    }
  }

  // Área (2 a 4) + abonado (6 a 8) = 10 dígitos en todo el país
  if (d.length !== 10) return null;
  return `549${d}`;
}

/** Cómo se muestra un teléfono ya normalizado, para confirmarlo a ojo. */
export function mostrarTelefono(e164: string): string {
  const d = e164.replace(/^549/, "");
  if (d.length !== 10) return e164;
  return `+54 9 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}`;
}

const fecha = (iso: string): string =>
  new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export interface OpcionesRecibo {
  /** nombre del cliente, si lo hay */
  cliente?: string | null;
  /** "comanda" agrega el detalle para la cocina; "recibo" es para el cliente */
  tipo?: "recibo" | "comanda";
}

/**
 * El texto del recibo. Sin alinear en columnas a propósito: WhatsApp usa
 * tipografía variable y las columnas quedan torcidas en la mitad de los
 * teléfonos.
 */
export function textoRecibo(sale: Sale, opts: OpcionesRecibo = {}): string {
  const comanda = opts.tipo === "comanda";
  const l: string[] = [];

  l.push(`*${NEGOCIO}*`);
  l.push(comanda ? `Comanda · ${fecha(sale.sold_at)}` : `Recibo · ${fecha(sale.sold_at)}`);
  if (opts.cliente) l.push(`Para: ${opts.cliente}`);
  l.push("");

  for (const item of sale.items) {
    const congelada = item.presentacion === "congelada";
    const cantidad = congelada
      ? `${item.qty / UNIDADES_POR_DOCENA} doc. congeladas`
      : `${item.qty}`;
    l.push(`${cantidad} × ${item.product_name} — ${formatARS(item.line_total)}`);
  }

  l.push("");

  // Si hubo descuento se muestra de dónde salió: el cliente ve el precio de
  // lista y el ahorro, no un total que no puede explicar.
  if (sale.discount > 0) {
    l.push(`Precio de lista: ${formatARS(sale.subtotal)}`);
    // Las líneas ya vienen con la media docena y la docena, que se arman sobre
    // todas las empanadas del pedido (la docena surtida también). Lo que falta
    // hasta el precio de lista es ese ahorro; no es un descuento a mano.
    const conTramos = sale.items.reduce((a, i) => a + i.line_total, 0);
    const porTramos = Math.max(0, sale.subtotal - conTramos);
    if (porTramos > 0.5) {
      l.push(`Precio por media docena y docena: −${formatARS(porTramos)}`);
    }
    for (const promo of sale.promos ?? []) {
      l.push(`${promo.nombre}: −${formatARS(promo.ahorro)}`);
    }
    const aMano = sale.discount - (sale.promo_discount ?? 0) - porTramos;
    if (aMano > 0.5) l.push(`Descuento: −${formatARS(aMano)}`);
  }

  l.push(`*TOTAL: ${formatARS(sale.total)}*`);

  if (!comanda) {
    l.push("");
    l.push(`Pago: ${etiquetaPago(sale.payment_method)}`);
    if (sale.cash_received != null && sale.cash_received > sale.total) {
      l.push(`Vuelto: ${formatARS(sale.cash_received - sale.total)}`);
    }
  }

  if (sale.note) {
    l.push("");
    l.push(`Nota: ${sale.note}`);
  }

  l.push("");
  l.push(comanda ? `Atiende: ${sale.sold_by}` : "¡Gracias por elegirnos!");

  return l.join("\n");
}

const ETIQUETAS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  qr: "QR",
  tarjeta: "Tarjeta",
  cuenta_corriente: "Cuenta corriente",
};

const etiquetaPago = (m: string): string => ETIQUETAS[m] ?? m;

/**
 * Link de WhatsApp con el mensaje listo. Sin teléfono abre el selector de
 * contactos: sirve igual para mandarle la comanda a la cocina.
 */
export function linkWhatsApp(texto: string, telefono?: string | null): string {
  const msg = encodeURIComponent(texto);
  const destino = telefono ? normalizarTelefono(telefono) : null;
  return destino
    ? `https://wa.me/${destino}?text=${msg}`
    : `https://wa.me/?text=${msg}`;
}
