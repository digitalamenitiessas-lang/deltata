import { NextResponse } from "next/server";
import { getSesion } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** Devuelve el perfil del usuario autenticado (nombre y rol), o 401. */
export async function GET() {
  const sesion = await getSesion();
  if (!sesion) {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
  return NextResponse.json(sesion);
}
