"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** oculta visualmente el título (queda para lectores de pantalla) */
  hideTitle?: boolean;
}

/** Bottom sheet accesible (Radix Dialog): el patrón de capa rápida del POS. */
export function Sheet({ open, onOpenChange, title, children, hideTitle }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink-950/40 data-[state=open]:animate-[fadeIn_var(--motion-base)_ease-out]" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-8px_40px_rgba(23,32,25,0.18)] outline-none data-[state=open]:animate-[slideUp_var(--motion-base)_ease-out]"
          aria-describedby={undefined}
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-cream-200" aria-hidden />
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title
              className={hideTitle ? "sr-only" : "text-lg font-bold text-ink-950"}
            >
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Cerrar"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 active:bg-cream-100"
            >
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
