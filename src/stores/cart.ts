"use client";

import { create } from "zustand";
import { UNIDADES_POR_DOCENA, type Presentacion } from "@/types";
import { claveLinea } from "@/lib/pricing";

// Carrito del POS. Guarda SIEMPRE unidades, con la presentación en la clave:
// el mismo gusto puede ir cocido y congelado en el mismo pedido. El cálculo de
// precios vive en lib/pricing (testeable, sin estado).

interface CartState {
  quantities: Record<string, number>;
  manualDiscount: number;
  note: string;
  /** modo actual del POS */
  presentacion: Presentacion;
  setPresentacion: (p: Presentacion) => void;
  /** canal con cuya lista se cobra (foodtruck, PedidosYa, …) */
  canalId: string | null;
  setCanalId: (id: string | null) => void;
  /**
   * Cliente del pedido, elegido antes de armarlo. Sirve para recomendarle lo
   * que suele llevar; si paga en cuenta corriente, ya viene elegido al cobrar.
   */
  customerId: string | null;
  setCustomerId: (id: string | null) => void;
  add: (productId: string, p: Presentacion, unidades?: number) => void;
  setQty: (productId: string, p: Presentacion, unidades: number) => void;
  setManualDiscount: (value: number) => void;
  setNote: (value: string) => void;
  clear: () => void;
}

// Tope defensivo por línea: evita cantidades absurdas por tipeo.
const MAX_UNIDADES = 999;

const clamp = (n: number) =>
  Number.isFinite(n) ? Math.min(MAX_UNIDADES, Math.max(0, Math.floor(n))) : 0;

export const useCart = create<CartState>((set) => ({
  quantities: {},
  manualDiscount: 0,
  note: "",
  presentacion: "cocida",
  canalId: null,
  customerId: null,

  setPresentacion: (presentacion) => set({ presentacion }),
  setCanalId: (canalId) => set({ canalId }),
  setCustomerId: (customerId) => set({ customerId }),

  add: (productId, p, unidades) =>
    set((s) => {
      const paso = unidades ?? (p === "congelada" ? UNIDADES_POR_DOCENA : 1);
      const k = claveLinea(productId, p);
      return {
        quantities: { ...s.quantities, [k]: clamp((s.quantities[k] ?? 0) + paso) },
      };
    }),

  setQty: (productId, p, unidades) =>
    set((s) => {
      const quantities = { ...s.quantities };
      const k = claveLinea(productId, p);
      const v = clamp(unidades);
      if (v <= 0) delete quantities[k];
      else quantities[k] = v;
      return { quantities };
    }),

  setManualDiscount: (value) => set({ manualDiscount: Math.max(0, value) }),
  setNote: (value) => set({ note: value }),
  clear: () =>
    set({ quantities: {}, manualDiscount: 0, note: "", customerId: null }),
}));
