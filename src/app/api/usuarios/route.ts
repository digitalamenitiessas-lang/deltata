import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSesion } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** Mínimo que exige Supabase Auth. No se puede bajar de acá. */
const MIN_PASSWORD = 6;

/** Sólo el dueño administra usuarios. Se valida en servidor, siempre. */
async function exigirAdmin() {
  const sesion = await getSesion();
  if (!sesion) return { error: NextResponse.json({ error: "Sin sesión" }, { status: 401 }) };
  if (sesion.rol !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Sólo el dueño administra usuarios." },
        { status: 403 }
      ),
    };
  }
  return { sesion };
}

export async function GET() {
  const { error, sesion } = await exigirAdmin();
  if (error) return error;

  const { data, error: err } = await supabaseAdmin()
    .from("profiles")
    .select("id, email, nombre, rol, activo, created_at")
    .order("rol")
    .order("email");

  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  return NextResponse.json({ usuarios: data, yo: sesion!.userId });
}

/** Crea un usuario nuevo. Sólo el dueño. */
export async function POST(req: Request) {
  const { error, sesion } = await exigirAdmin();
  if (error) return error;

  const body: {
    email?: string;
    nombre?: string;
    rol?: "admin" | "atiende";
    password?: string;
  } = await req.json().catch(() => ({}));

  const email = body.email?.trim().toLowerCase();
  const nombre = body.nombre?.trim();
  const rol = body.rol ?? "atiende";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Falta un correo válido." }, { status: 400 });
  }
  if (!nombre) {
    return NextResponse.json({ error: "Falta el nombre." }, { status: 400 });
  }
  if (!body.password || body.password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `La contraseña necesita al menos ${MIN_PASSWORD} caracteres.` },
      { status: 400 }
    );
  }

  const supabase = supabaseAdmin();

  // Sin confirmación por correo: las casillas @deltata.com no existen, el
  // dueño le pasa la contraseña a mano.
  const { data, error: e1 } = await supabase.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true,
    user_metadata: { nombre },
  });

  if (e1 || !data.user) {
    const msg = e1?.message ?? "No se pudo crear el usuario.";
    return NextResponse.json(
      {
        error: msg.includes("already")
          ? "Ya existe un usuario con ese correo."
          : msg,
      },
      { status: 400 }
    );
  }

  // Sin fila en profiles el login entra pero no tiene rol: van juntos.
  const { error: e2 } = await supabase
    .from("profiles")
    .insert({ id: data.user.id, email, nombre, rol, activo: true });

  if (e2) {
    // No dejamos un usuario huérfano sin perfil
    await supabase.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: e2.message }, { status: 500 });
  }

  await supabase.rpc("log_audit", {
    p_user_id: sesion!.userId,
    p_email: sesion!.email,
    p_accion: "alta_usuario",
    p_entidad: "profiles",
    p_entidad_id: data.user.id,
    p_resumen: `Creó el usuario ${email} (${nombre}) con rol ${rol}`,
    p_ocurrido: new Date().toISOString(),
    p_monto: null,
    p_unidades: null,
    p_datos: { email, nombre, rol },
    p_dispositivo: req.headers.get("user-agent")?.slice(0, 180) ?? null,
  });

  return NextResponse.json({ ok: true, id: data.user.id });
}

export async function PATCH(req: Request) {
  const { error, sesion } = await exigirAdmin();
  if (error) return error;

  const body: {
    id?: string;
    nombre?: string;
    rol?: "admin" | "atiende";
    activo?: boolean;
    password?: string;
  } = await req.json().catch(() => ({}));

  if (!body.id) {
    return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });
  }

  // Nadie puede sacarse a sí mismo el rol ni darse de baja: si el último
  // admin se equivoca, el sistema queda sin dueño.
  if (body.id === sesion!.userId && (body.rol === "atiende" || body.activo === false)) {
    return NextResponse.json(
      { error: "No podés quitarte tu propio acceso de dueño." },
      { status: 400 }
    );
  }

  const supabase = supabaseAdmin();
  const cambios: Record<string, unknown> = {};
  if (body.nombre != null) cambios.nombre = body.nombre.trim();
  if (body.rol != null) cambios.rol = body.rol;
  if (body.activo != null) cambios.activo = body.activo;

  // Siempre tiene que quedar al menos un dueño activo
  if (cambios.rol === "atiende" || cambios.activo === false) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("rol", "admin")
      .eq("activo", true);
    const { data: objetivo } = await supabase
      .from("profiles")
      .select("rol, activo")
      .eq("id", body.id)
      .single();
    if (objetivo?.rol === "admin" && objetivo.activo && (count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Tiene que quedar al menos un dueño activo." },
        { status: 400 }
      );
    }
  }

  if (Object.keys(cambios).length > 0) {
    const { error: e1 } = await supabase
      .from("profiles")
      .update(cambios)
      .eq("id", body.id);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  }

  if (body.password) {
    if (body.password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `La contraseña necesita al menos ${MIN_PASSWORD} caracteres.` },
        { status: 400 }
      );
    }
    const { error: e2 } = await supabase.auth.admin.updateUserById(body.id, {
      password: body.password,
    });
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  }

  // Queda registrado quién tocó a quién
  const { data: destino } = await supabase
    .from("profiles")
    .select("email, nombre, rol, activo")
    .eq("id", body.id)
    .single();

  await supabase.rpc("log_audit", {
    p_user_id: sesion!.userId,
    p_email: sesion!.email,
    p_accion: body.password ? "reset_password" : "cambio_usuario",
    p_entidad: "profiles",
    p_entidad_id: body.id,
    p_resumen: body.password
      ? `Cambió la contraseña de ${destino?.email}`
      : `Actualizó a ${destino?.email}: ${destino?.nombre}, rol ${destino?.rol}, ${destino?.activo ? "activo" : "dado de baja"}`,
    p_ocurrido: new Date().toISOString(),
    p_monto: null,
    p_unidades: null,
    p_datos: cambios,
    p_dispositivo: req.headers.get("user-agent")?.slice(0, 180) ?? null,
  });

  return NextResponse.json({ ok: true, usuario: destino });
}
