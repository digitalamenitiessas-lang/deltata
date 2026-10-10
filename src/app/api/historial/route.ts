import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSesion } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * Lo que hicieron los OTROS equipos: ventas, cajas, gastos y stock.
 *
 * Cada dispositivo vende sin señal y guarda lo suyo. Sin esto, el celular del
 * dueño no veía lo que se vendió en la compu del local. Es incremental: el
 * dispositivo pide "lo que cambió desde X" y guarda el `hasta` para la próxima.
 *
 * El que atiende recibe una semana y sin sueldos; el dueño, 45 días.
 */

const LIMITE = 2000;
// Margen contra transacciones que se confirman mientras se lee: se repiten
// algunas filas (se guardan por id, no duplica) pero no se pierde ninguna.
const MARGEN_MS = 60_000;

export async function GET(req: Request) {
  const sesion = await getSesion();
  if (!sesion) {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
  const admin = sesion.rol === "admin";
  const inicio = Date.now();
  const ventana = new Date(inicio - (admin ? 45 : 7) * 24 * 3600 * 1000).toISOString();

  const pedido = new URL(req.url).searchParams.get("desde");
  const desde =
    pedido && !Number.isNaN(Date.parse(pedido)) && pedido > ventana ? pedido : ventana;

  const supabase = supabaseAdmin();

  let gastos = supabase
    .from("expenses")
    .select(
      "id, spent_at, category, description, amount, payment_method, cash_session_id, product_id, qty_purchased, supplier, empleado_id, created_by, actualizado_en"
    )
    .gte("actualizado_en", desde)
    .order("actualizado_en")
    .limit(LIMITE);
  if (!admin) gastos = gastos.neq("category", "sueldos");

  const [ventas, cajas, gastosRes, movimientos, conteos] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id, sold_at, cash_session_id, canal_id, payment_method, customer_id, subtotal, discount, promo_discount, total, cash_received, sold_by, note, actualizado_en, sale_items(product_id, qty, unit_price, line_total, presentacion, products(name)), sale_promos(promo_id, nombre, veces, ahorro)"
      )
      .gte("actualizado_en", desde)
      .order("actualizado_en")
      .limit(LIMITE),
    supabase
      .from("cash_sessions")
      .select(
        "id, canal_id, opened_at, opened_by, opening_float, closed_at, closed_by, counted_cash, expected_cash, difference, note, status, conciliacion, sin_arqueo, actualizado_en"
      )
      .gte("actualizado_en", desde)
      .order("actualizado_en")
      .limit(LIMITE),
    gastos,
    supabase
      .from("stock_movements")
      .select(
        "local_uuid, product_id, type, qty, reason, ref_id, balance_after, moved_at, created_by, ubicacion_id, absorbido, actualizado_en"
      )
      .gte("actualizado_en", desde)
      .order("actualizado_en")
      .limit(LIMITE),
    supabase
      .from("stock_counts")
      .select(
        "id, counted_at, product_id, system_qty, counted_qty, diff, note, counted_by, ubicacion_id, actualizado_en"
      )
      .gte("actualizado_en", desde)
      .order("actualizado_en")
      .limit(LIMITE),
  ]);

  const error =
    ventas.error ?? cajas.error ?? gastosRes.error ?? movimientos.error ?? conteos.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Si alguna tabla llegó al límite, la próxima vez se sigue desde donde se
  // cortó (la más atrasada), no desde ahora: así no queda nada en el medio.
  let hasta = new Date(inicio - MARGEN_MS).toISOString();
  let completo = true;
  for (const filas of [ventas.data, cajas.data, gastosRes.data, movimientos.data, conteos.data]) {
    if ((filas?.length ?? 0) >= LIMITE) {
      completo = false;
      const ultima = filas![filas!.length - 1] as { actualizado_en: string };
      if (ultima.actualizado_en < hasta) hasta = ultima.actualizado_en;
    }
  }
  if (hasta < desde) hasta = desde;

  return NextResponse.json({
    hasta,
    completo,
    sales: ventas.data,
    cash_sessions: cajas.data,
    expenses: gastosRes.data,
    stock_movements: movimientos.data,
    stock_counts: conteos.data,
  });
}
