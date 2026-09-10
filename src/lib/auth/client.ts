"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de navegador. Guarda la sesión en cookies para que el servidor
 * también la vea: así /api/sync puede saber quién está operando.
 *
 * La sesión se refresca sola y sobrevive sin conexión — sólo el login inicial
 * necesita red. Después el foodtruck puede vender todo el día en modo avión.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
