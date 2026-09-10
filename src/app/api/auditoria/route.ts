import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSesion } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** El rastro completo. Sólo el dueño: se valida en servidor, no en la UI. */
export async function GET(req: Request) {
  const sesion = await getSesion();
  if (!sesion) {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
  if (sesion.rol !== "admin") {
    return NextResponse.json(
      { error: "Sólo el dueño puede ver la auditoría." },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const accion = url.searchParams.get("accion");
  const usuario = url.searchParams.get("usuario");
  const desde = url.searchParams.get("desde");
  const limite = Math.min(Number(url.searchParams.get("limite") ?? 200), 500);

  let q = supabaseAdmin()
    .from("audit_log")
    .select(
      "id, ocurrido_en, registrado_en, user_email, accion, entidad, entidad_id, resumen, monto, unidades, dispositivo"
    )
    .order("ocurrido_en", { ascending: false })
    .limit(limite);

  if (accion && accion !== "todas") q = q.eq("accion", accion);
  if (usuario && usuario !== "todos") q = q.eq("user_email", usuario);
  if (desde) q = q.gte("ocurrido_en", desde);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Para poblar los filtros con lo que realmente existe
  const { data: usuarios } = await supabaseAdmin()
    .from("profiles")
    .select("email, nombre, rol, activo");

  return NextResponse.json({ eventos: data ?? [], usuarios: usuarios ?? [] });
}
