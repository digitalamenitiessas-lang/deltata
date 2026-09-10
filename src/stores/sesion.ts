"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Rol = "admin" | "atiende";

export interface UsuarioSesion {
  userId: string;
  email: string;
  nombre: string;
  rol: Rol;
}

interface SesionState {
  usuario: UsuarioSesion | null;
  /** hidratado desde disco: evita parpadeo del login al abrir la app */
  cargado: boolean;
  setUsuario: (u: UsuarioSesion | null) => void;
  setCargado: (v: boolean) => void;
}

/**
 * Copia local del usuario. La verdad de la sesión vive en las cookies de
 * Supabase; esto es sólo para que la interfaz sepa a quién mostrarle qué
 * mientras está sin conexión, sin tener que preguntarle al servidor.
 * Los permisos reales se validan siempre en el servidor.
 */
export const useSesion = create<SesionState>()(
  persist(
    (set) => ({
      usuario: null,
      cargado: false,
      setUsuario: (usuario) => set({ usuario }),
      setCargado: (cargado) => set({ cargado }),
    }),
    {
      name: "del-tata-sesion",
      partialize: (s) => ({ usuario: s.usuario }),
      onRehydrateStorage: () => (state) => state?.setCargado(true),
    }
  )
);

export const esAdmin = (u: UsuarioSesion | null) => u?.rol === "admin";
