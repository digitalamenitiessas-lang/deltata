import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// (Next 16: "middleware" pasó a llamarse "proxy".)
// Refresca el token en cada navegación para que la sesión no expire mientras
// se está trabajando, y deja las cookies listas para los route handlers.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Todo menos estáticos: la app opera offline, no conviene bloquear assets
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-|apple-touch|manifest.json|sw.js|logo|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)",
  ],
};
