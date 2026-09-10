import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSesion } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Snapshot para el pull: catálogo con stock del servidor + clientes.
// Exige sesión: los precios, costos y saldos no son públicos.
export async function GET() {
  const sesion = await getSesion();
  if (!sesion) {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
  const supabase = supabaseAdmin();

  const [
    products,
    customers,
    accountMovements,
    canales,
    canalPrecios,
    promos,
    gustos,
    empleados,
    cajasAbiertas,
  ] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, kind, unit_price, half_dozen_price, dozen_price, frozen_dozen_price, cost_per_unit, current_qty, min_qty, sort_order, is_active, updated_at"
      )
      .order("sort_order"),
    supabase
      .from("customers")
      .select("id, name, phone, note, credit_limit, is_active")
      .eq("is_active", true),
    supabase
      .from("account_movements")
      .select(
        "local_uuid, customer_id, type, amount, balance_after, sale_id, payment_method, cash_session_id, note, moved_at, created_by"
      )
      .order("seq"),
    supabase
      .from("canales")
      .select("id, nombre, recargo_pct, es_default, activo, sort_order")
      .order("sort_order"),
    supabase
      .from("canal_precios")
      .select("canal_id, product_id, unit_price, half_dozen_price, dozen_price, frozen_dozen_price"),
    supabase
      .from("promos")
      .select(
        "id, nombre, tipo, empanadas_qty, bebida_product_id, bebida_qty, precio_fijo, valor, product_id, kind, minimo_unidades, dias, desde, hasta, canal_id, activo, sort_order"
      )
      .order("sort_order"),
    // Lo que suele llevar cada cliente, para poder recomendarle. Sale de una
    // vista: mira todo el histórico, no sólo lo que vendió este dispositivo.
    supabase
      .from("cliente_gustos")
      .select("customer_id, product_id, product_name, unidades, veces, ultima_vez")
      .order("unidades", { ascending: false })
      .limit(500),
    // Sólo nombre y rol: alcanza para saber a quién se le pagó un sueldo y
    // para que funcione sin señal. El correo no hace falta acá.
    supabase
      .from("profiles")
      .select("id, nombre, rol, activo")
      .order("nombre"),
    // Cajas abiertas en CUALQUIER dispositivo. Se manda sólo la cabecera, no
    // los totales: este dispositivo no tiene las ventas del otro y mostrar un
    // total incompleto sería peor que no mostrar nada.
    supabase
      .from("cash_sessions")
      .select("local_uuid, canal_id, opened_at, opened_by")
      .eq("status", "abierta")
      .order("opened_at"),
  ]);

  const error =
    products.error ?? customers.error ?? accountMovements.error ??
    canales.error ?? canalPrecios.error ?? promos.error ?? gustos.error ??
    empleados.error ?? cajasAbiertas.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    products: products.data,
    customers: customers.data,
    account_movements: accountMovements.data,
    canales: canales.data,
    canal_precios: canalPrecios.data,
    promos: promos.data,
    cliente_gustos: gustos.data,
    empleados: empleados.data,
    cajas_abiertas: cajasAbiertas.data,
  });
}
