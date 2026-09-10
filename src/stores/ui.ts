"use client";

import { create } from "zustand";

// La barra de navegación desaparece durante flujos críticos
// (cierre de caja, conteo físico, cobro) para no interrumpirlos.

interface UIState {
  hideNav: boolean;
  setHideNav: (hide: boolean) => void;
  toast: string | null;
  showToast: (message: string) => void;
  clearToast: () => void;
}

export const useUI = create<UIState>((set) => ({
  hideNav: false,
  setHideNav: (hideNav) => set({ hideNav }),
  toast: null,
  showToast: (message) => {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), 2600);
  },
  clearToast: () => set({ toast: null }),
}));
