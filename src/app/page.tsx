"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSesion, esAdmin } from "@/stores/sesion";

/**
 * Cada rol entra donde le sirve: el dueño al panel de control (que le muestra
 * qué falta poner en marcha), quien atiende directo a vender.
 */
export default function Home() {
  const router = useRouter();
  const usuario = useSesion((s) => s.usuario);
  const cargado = useSesion((s) => s.cargado);

  useEffect(() => {
    if (!cargado) return;
    router.replace(esAdmin(usuario) ? "/control" : "/vender");
  }, [cargado, usuario, router]);

  return <div className="min-h-dvh bg-surface-app" aria-busy />;
}
