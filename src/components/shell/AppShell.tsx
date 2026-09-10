"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Store,
  Wallet,
  Package,
  ChartNoAxesColumn,
  Menu,
  Users,
  ReceiptText,
  History,
  Settings,
  ShieldCheck,
  BookOpen,
  UserCog,
  HandCoins,
} from "lucide-react";
import { useSesion, esAdmin } from "@/stores/sesion";
import { supabaseBrowser } from "@/lib/auth/client";
import { Login } from "./Login";
import { useUI } from "@/stores/ui";
import { ensureSeeded } from "@/lib/seed";
import { startSyncEngine, pullCatalog } from "@/lib/sync/engine";
import { ConnectionStatus } from "./ConnectionStatus";
import { BotonAyuda } from "./Ayuda";
import { Button } from "@/components/ui/Button";

const NAV = [
  { href: "/vender", label: "Vender", icon: Store, soloAdmin: false },
  { href: "/caja", label: "Caja", icon: Wallet, soloAdmin: false },
  { href: "/stock", label: "Stock", icon: Package, soloAdmin: false },
  { href: "/control", label: "Control", icon: ChartNoAxesColumn, soloAdmin: true },
  { href: "/mas", label: "Más", icon: Menu, soloAdmin: false },
] as const;

const SIDE_NAV = [
  ...NAV.slice(0, 4),
  { href: "/clientes", label: "Clientes", icon: Users, soloAdmin: false },
  { href: "/gastos", label: "Gastos", icon: ReceiptText, soloAdmin: false },
  { href: "/historial", label: "Historial", icon: History, soloAdmin: false },
  { href: "/guia", label: "Guía", icon: BookOpen, soloAdmin: false },
  { href: "/auditoria", label: "Auditoría", icon: ShieldCheck, soloAdmin: true },
  { href: "/empleados", label: "Empleados", icon: HandCoins, soloAdmin: true },
  { href: "/usuarios", label: "Usuarios", icon: UserCog, soloAdmin: true },
  { href: "/configuracion", label: "Configuración", icon: Settings, soloAdmin: true },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const usuario = useSesion((s) => s.usuario);
  const cargado = useSesion((s) => s.cargado);
  const setUsuario = useSesion((s) => s.setUsuario);
  const hideNav = useUI((s) => s.hideNav);
  const toast = useUI((s) => s.toast);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    void ensureSeeded().then(() => {
      startSyncEngine();
      void pullCatalog();
    });
  }, []);

  // Revalidar la sesión contra el servidor cuando hay red: si al usuario le
  // dieron de baja o le cambiaron el rol, la app se entera.
  useEffect(() => {
    if (!usuario) return;
    const revalidar = async () => {
      if (!navigator.onLine) return;
      try {
        const res = await fetch("/api/sesion");
        if (res.status === 401) return setUsuario(null);
        if (res.ok) setUsuario(await res.json());
      } catch {
        // sin red: seguimos con la copia local, la app no se bloquea
      }
    };
    void revalidar();
    window.addEventListener("online", revalidar);
    return () => window.removeEventListener("online", revalidar);
  }, [usuario?.userId, setUsuario]);

  if (!hydrated || !cargado)
    return <div className="min-h-dvh bg-surface-app" aria-busy />;
  if (!usuario) return <Login />;

  // Ocultar no es seguridad — el servidor igual valida el rol en cada
  // operación. Esto es sólo para no mostrarle al que atiende cosas que no
  // puede usar.
  const admin = esAdmin(usuario);
  const navMovil = NAV.filter((n) => !n.soloAdmin || admin);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-xl">
      {/* Sidebar tablet/escritorio */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-[var(--border-soft)] bg-surface-card p-4 md:flex">
        <div className="mb-4 flex items-center gap-3 px-2">
          <Image
            src="/logo-deltata-crema.png"
            alt=""
            width={687}
            height={800}
            className="h-10 w-auto rounded-none bg-brand-900 p-1"
          />
          <div>
            <p className="font-[family-name:var(--font-fraunces)] text-lg font-bold leading-none text-brand-900">
              Del Tata
            </p>
            <p className="text-xs text-ink-500">
              {usuario.nombre} · {usuario.rol}
            </p>
          </div>
        </div>
        {SIDE_NAV.filter((n) => !n.soloAdmin || admin).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold transition-colors ${
              isActive(href)
                ? "bg-brand-900 text-ink-inverse"
                : "text-ink-700 hover:bg-brand-050"
            }`}
          >
            <Icon size={18} aria-hidden />
            {label}
          </Link>
        ))}
      </aside>

      <div className="flex min-h-dvh w-full flex-1 flex-col">
        <main
          className={`flex-1 ${hideNav ? "pb-4" : "pb-24"} md:pb-6`}
        >
          {children}
        </main>

        {/* Navegación inferior móvil */}
        {!hideNav && (
          <nav
            aria-label="Navegación principal"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-soft)] bg-surface-card pb-[env(safe-area-inset-bottom)] md:hidden"
          >
            <div
              className="mx-auto grid max-w-lg"
              style={{ gridTemplateColumns: `repeat(${navMovil.length}, minmax(0, 1fr))` }}
            >
              {navMovil.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive(href) ? "page" : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold ${
                    isActive(href) ? "text-brand-900" : "text-ink-500"
                  }`}
                >
                  <Icon size={22} aria-hidden strokeWidth={isActive(href) ? 2.4 : 2} />
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        )}

        {/* Toast global */}
        {toast ? (
          <div
            role="status"
            aria-live="polite"
            className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[90vw] rounded-2xl bg-ink-950 px-4 py-3 text-sm font-bold text-ink-inverse shadow-lg md:bottom-8"
          >
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Encabezado de módulo con estado de conexión siempre visible. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-surface-app/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate font-[family-name:var(--font-fraunces)] text-2xl font-bold text-brand-900">
            {title}
          </h1>
          {subtitle ? <p className="text-xs text-ink-700">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <ConnectionStatus />
          <BotonAyuda />
        </div>
      </div>
    </header>
  );
}
