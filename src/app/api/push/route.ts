import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSesion } from "@/lib/auth/server";
import { clavesDelEntorno, endpointValido } from "@/lib/webpush";
import { avisoDePrueba } from "@/lib/avisos";

export const dynamic = "force-dynamic";

/**
 * Suscripciones a las notificaciones push de este usuario.
 *
 * GET    → la clave pública VAPID (null si el servidor todavía no la tiene).
 * POST   → anota este navegador y, si se pide, le manda un aviso de prueba.
 * DELETE → lo borra.
 *
 * Los avisos son del dueño: la suscripción la puede crear cualquiera con
 * sesión, pero a la hora de mandar sólo se busca a los administradores.
 */

export async function GET() {
  const sesion = await getSesion();
  if (!sesion) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  return NextResponse.json({ publicKey: clavesDelEntorno()?.publica ?? null });
}

const largo = (s: unknown) => {
  try {
    return typeof s === "string" ? Buffer.from(s, "base64url").length : 0;
  } catch {
    return 0;
  }
};

export async function POST(req: Request) {
  const sesion = await getSesion();
  if (!sesion) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  const claves = clavesDelEntorno();
  if (!claves) {
    return NextResponse.json(
      { error: "Las notificaciones todavía no están configuradas en el servidor." },
      { status: 503 }
    );
  }

  let body: {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    prueba?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const endpoint = body.subscription?.endpoint ?? "";
  const p256dh = body.subscription?.keys?.p256dh ?? "";
  const auth = body.subscription?.keys?.auth ?? "";
  // P-256 sin comprimir (65 bytes) y secreto de 16: lo que genera cualquier navegador
  if (!endpointValido(endpoint) || largo(p256dh) !== 65 || largo(auth) !== 16) {
    return NextResponse.json({ error: "Suscripción inválida." }, { status: 400 });
  }

  const fila = {
    endpoint,
    p256dh,
    auth,
    user_id: sesion.userId,
    dispositivo: req.headers.get("user-agent")?.slice(0, 180) ?? null,
    fallos: 0,
  };
  const { error } = await supabaseAdmin()
    .from("push_suscripciones")
    .upsert(fila, { onConflict: "endpoint" });
  if (error) {
    return NextResponse.json({ error: "No se pudo guardar la suscripción." }, { status: 500 });
  }

  if (!body.prueba) return NextResponse.json({ ok: true });
  const prueba = await avisoDePrueba(fila, claves);
  return NextResponse.json({ ok: prueba === "ok", prueba });
}

export async function DELETE(req: Request) {
  const sesion = await getSesion();
  if (!sesion) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  let endpoint = "";
  try {
    endpoint = String((await req.json()).endpoint ?? "");
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  // Sólo la propia: nadie apaga los avisos del celular de otro
  await supabaseAdmin()
    .from("push_suscripciones")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", sesion.userId);
  return NextResponse.json({ ok: true });
}
