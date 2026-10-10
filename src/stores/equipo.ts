"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EquipoState {
  /**
   * Dónde está este equipo (Local o Foodtruck). Define con qué canal arranca
   * Vender y en qué congelador se cuenta y se registran las mermas. Es del
   * dispositivo, no del usuario: la compu del local siempre está en el local.
   * null = todavía no se eligió.
   */
  ubicacionId: string | null;
  setUbicacionId: (id: string | null) => void;
}

export const useEquipo = create<EquipoState>()(
  persist(
    (set) => ({
      ubicacionId: null,
      setUbicacionId: (ubicacionId) => set({ ubicacionId }),
    }),
    { name: "del-tata-equipo" }
  )
);
