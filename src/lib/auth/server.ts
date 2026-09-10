import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-server";

export type Rol = "admin" | "atiende";

export interface Sesion {
  userId: string;
  email: string;
  nombre: string;
  rol: Rol;
}

/** Cliente de servidor atado a las cookies del request. */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // llamado desde un Server Component: el middleware ya refresca
          }
        },
      },
    }
  );
}

/**
 * Devuelve la sesión verificada contra el servidor de auth, o null.
 * Usa getUser() y no getSession(): getSession lee la cookie sin validarla,
 * así que un token falsificado pasaría.
 */
export async function getSesion(): Promise<Sesion | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // El perfil se lee con service_role: el rol no puede depender de algo que
  // el cliente pueda influir.
  const { data: perfil } = await supabaseAdmin()
    .from("profiles")
    .select("nombre, rol, activo, email")
    .eq("id", user.id)
    .single();

  if (!perfil || !perfil.activo) return null;

  return {
    userId: user.id,
    email: perfil.email ?? user.email ?? "",
    nombre: perfil.nombre,
    rol: perfil.rol as Rol,
  };
}

/** Corta con 401/403 si no hay sesión o el rol no alcanza. */
export async function exigirSesion(rol?: Rol): Promise<Sesion> {
  const sesion = await getSesion();
  if (!sesion) throw new RespuestaError(401, "Sesión no válida o expirada.");
  if (rol && sesion.rol !== rol) {
    throw new RespuestaError(403, "No tenés permiso para esta operación.");
  }
  return sesion;
}

export class RespuestaError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
