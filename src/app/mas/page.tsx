"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Users,
  ReceiptText,
  History,
  Settings,
  Share,
  LogOut,
  RefreshCw,
  ShieldCheck,
  BookOpen,
  UserCog,
  HandCoins,
} from "lucide-react";
import { useSesion, esAdmin } from "@/stores/sesion";
import { supabaseBrowser } from "@/lib/auth/client";
import { useUI } from "@/stores/ui";
import { pullCatalog, flushOutbox } from "@/lib/sync/engine";
import { PageHeader } from "@/components/shell/AppShell";
import { db } from "@/lib/db";

const LINKS = [
  { href: "/guia", label: "Guía: qué hace cada cosa", icon: BookOpen, soloAdmin: false },
  { href: "/clientes", label: "Clientes", icon: Users, soloAdmin: false },
  { href: "/gastos", label: "Gastos", icon: ReceiptText, soloAdmin: false },
  { href: "/historial", label: "Historial", icon: History, soloAdmin: false },
  { href: "/auditoria", label: "Auditoría", icon: ShieldCheck, soloAdmin: true },
  { href: "/empleados", label: "Empleados", icon: HandCoins, soloAdmin: true },
  { href: "/usuarios", label: "Usuarios", icon: UserCog, soloAdmin: true },
  { href: "/configuracion", label: "Configuración", icon: Settings, soloAdmin: true },
] as const;

export default function MasPage() {
  const usuario = useSesion((s) => s.usuario);
  const setUsuario = useSesion((s) => s.setUsuario);
  const showToast = useUI((s) => s.showToast);
  const admin = esAdmin(usuario);

  const isIOS =
    typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        (navigator as { standalone?: boolean }).standalone === true));

  const salir = async () => {
    const pendientes = await db.outbox.count();
    if (pendientes > 0) {
      const seguro = window.confirm(
        `Quedan ${pendientes} operaciones sin sincronizar. Si cerrás sesión ahora, se sincronizan cuando alguien vuelva a entrar en este dispositivo. ¿Salir igual?`
      );
      if (!seguro) return;
    }
    await supabaseBrowser().auth.signOut();
    setUsuario(null);
  };

  return (
    <>
      <PageHeader
        title="Más"
        subtitle={usuario ? `${usuario.nombre} · ${usuario.rol}` : undefined}
      />
      <div className="flex flex-col gap-4 p-4">
        <ul className="flex flex-col gap-2">
          {LINKS.filter((l) => !l.soloAdmin || admin).map(
            ({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex h-14 items-center gap-3 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 text-sm font-bold text-ink-950"
                >
                  <Icon size={20} className="text-brand-900" aria-hidden />
                  {label}
                </Link>
              </li>
            )
          )}
          <li>
            <button
              type="button"
              onClick={() => {
                void flushOutbox().then(() => pullCatalog());
                showToast("Sincronización iniciada");
              }}
              className="flex h-14 w-full items-center gap-3 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 text-sm font-bold text-ink-950"
            >
              <RefreshCw size={20} className="text-brand-900" aria-hidden />
              Sincronizar ahora
            </button>
          </li>
        </ul>

        {isIOS && !isStandalone ? (
          <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
            <div className="flex items-center gap-2">
              <Share size={18} className="text-brand-900" aria-hidden />
              <h2 className="text-sm font-bold text-ink-950">
                Instalar Del Tata en este iPhone
              </h2>
            </div>
            <ol className="mt-2 list-decimal pl-5 text-sm text-ink-700">
              <li>Tocá Compartir en Safari.</li>
              <li>Elegí “Agregar a pantalla de inicio”.</li>
              <li>Abrí la app desde el nuevo ícono.</li>
            </ol>
            <p className="mt-2 text-xs text-ink-500">
              Instalada funciona a pantalla completa y mucho más rápido.
            </p>
          </section>
        ) : null}

        <button
          type="button"
          onClick={() => void salir()}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-[var(--border-soft)] text-sm font-bold text-danger-600"
        >
          <LogOut size={18} aria-hidden />
          Cerrar sesión
        </button>

        <div className="flex flex-col items-center gap-2 py-4 opacity-80">
          <Image
            src="/logo-deltata-crema.png"
            alt=""
            width={687}
            height={800}
            className="h-16 w-auto rounded-2xl bg-brand-900 p-2"
          />
          <p className="text-xs text-ink-500">Del Tata · Empanadas Tucumanas</p>
        </div>
      </div>
    </>
  );
}
