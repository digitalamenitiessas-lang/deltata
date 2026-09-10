"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Tag, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { deletePromo, upsertPromo } from "@/lib/ops";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { describirPromo, describirVigencia, promoVigente } from "@/lib/promos";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Canal, Product, Promo, PromoTipo } from "@/types";

const DIAS = [
  { n: 1, label: "Lun" },
  { n: 2, label: "Mar" },
  { n: 3, label: "Mié" },
  { n: 4, label: "Jue" },
  { n: 5, label: "Vie" },
  { n: 6, label: "Sáb" },
  { n: 0, label: "Dom" },
];

const vacia = (): Promo => ({
  id: "",
  nombre: "",
  tipo: "combo",
  empanadas_qty: 6,
  bebida_product_id: null,
  bebida_qty: 1,
  precio_fijo: null,
  valor: null,
  product_id: null,
  kind: null,
  minimo_unidades: null,
  dias: null,
  desde: null,
  hasta: null,
  canal_id: null,
  activo: true,
  sort_order: 0,
});

export function Promos({
  products,
  canales,
  showToast,
}: {
  products: Product[];
  canales: Canal[];
  showToast: (m: string) => void;
}) {
  const promos = useLiveQuery(() => db.promos.orderBy("sort_order").toArray(), []);
  const [editando, setEditando] = useState<Promo | null>(null);
  const ahora = new Date();

  const nombreProducto = (id: string | null) =>
    products.find((p) => p.id === id)?.name;

  return (
    <>
      <p className="text-sm text-ink-700">
        Las promos se aplican solas cuando el pedido las cumple. Se calculan
        sobre el precio que el pedido ya tiene con media docena y docena, así
        que el mismo ahorro nunca se cuenta dos veces.
      </p>

      {(promos ?? []).length === 0 ? (
        <EmptyState
          title="Todavía no hay promos"
          description="Por ejemplo: 6 empanadas + una gaseosa a $14.000, sólo viernes y sábado a la noche."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(promos ?? []).map((p) => {
            const corriendo = promoVigente(p, { canalId: null, ahora });
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setEditando(p)}
                  className={`w-full rounded-2xl border border-[var(--border-soft)] bg-surface-card p-4 text-left ${
                    p.activo ? "" : "opacity-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-bold text-ink-950">
                        <Tag size={14} className="shrink-0 text-brand-900" aria-hidden />
                        {p.nombre}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-700">
                        {describirPromo(p, nombreProducto(p.bebida_product_id))}
                      </p>
                      <p className="text-xs text-ink-500">{describirVigencia(p)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {!p.activo ? (
                        <Badge tone="muted">Apagada</Badge>
                      ) : corriendo ? (
                        <Badge tone="brand">Corriendo ahora</Badge>
                      ) : (
                        <Badge tone="info">Fuera de horario</Badge>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button variant="secondary" size="lg" onClick={() => setEditando(vacia())}>
        <Plus size={16} /> Nueva promo
      </Button>

      {editando ? (
        <EditarPromo
          promo={editando}
          products={products}
          canales={canales}
          onClose={() => setEditando(null)}
          showToast={showToast}
        />
      ) : null}
    </>
  );
}

function EditarPromo({
  promo,
  products,
  canales,
  onClose,
  showToast,
}: {
  promo: Promo;
  products: Product[];
  canales: Canal[];
  onClose: () => void;
  showToast: (m: string) => void;
}) {
  const esNueva = promo.id === "";
  const [f, setF] = useState<Promo>(promo);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Promo>(k: K, v: Promo[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const bebidas = products.filter((p) => p.kind === "bebida" && p.is_active);
  const activos = products.filter((p) => p.is_active);

  const toggleDia = (n: number) => {
    const actuales = f.dias ?? [];
    const siguiente = actuales.includes(n)
      ? actuales.filter((d) => d !== n)
      : [...actuales, n];
    set("dias", siguiente.length === 0 ? null : siguiente);
  };

  const valido =
    f.nombre.trim() !== "" &&
    (f.tipo === "combo"
      ? (f.empanadas_qty ?? 0) > 0 && (f.precio_fijo ?? 0) > 0
      : (f.valor ?? 0) > 0);

  const num = (s: string): number | null => {
    const n = Number(s.replace(/[^\d]/g, ""));
    return s.trim() === "" || !Number.isFinite(n) ? null : n;
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={esNueva ? "Nueva promo" : f.nombre || "Promo"}
    >
      <div className="flex flex-col gap-3">
        <Campo label="Nombre (así lo ve el cliente en el recibo)">
          <input
            value={f.nombre}
            onChange={(e) => set("nombre", e.target.value)}
            placeholder="Ej: Combo noche"
            autoFocus
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
        </Campo>

        <Campo label="Tipo de promo">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo">
            {(
              [
                ["combo", "Combo"],
                ["porcentaje", "% off"],
                ["monto", "$ off"],
              ] as [PromoTipo, string][]
            ).map(([id, label]) => (
              <Opcion
                key={id}
                activo={f.tipo === id}
                onClick={() => set("tipo", id)}
                label={label}
              />
            ))}
          </div>
        </Campo>

        {f.tipo === "combo" ? (
          <>
            <Campo label="Cuántas empanadas entran">
              <input
                type="text"
                inputMode="numeric"
                value={f.empanadas_qty ?? ""}
                onChange={(e) => set("empanadas_qty", num(e.target.value))}
                className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-lg font-bold outline-none focus:border-brand-700"
              />
            </Campo>

            <Campo label="Con qué bebida">
              <select
                value={f.bebida_product_id ?? ""}
                onChange={(e) => set("bebida_product_id", e.target.value || null)}
                className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
              >
                <option value="">Cualquier bebida</option>
                {bebidas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Cuántas bebidas">
              <input
                type="text"
                inputMode="numeric"
                value={f.bebida_qty ?? ""}
                onChange={(e) => set("bebida_qty", num(e.target.value))}
                className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-lg font-bold outline-none focus:border-brand-700"
              />
            </Campo>

            <MoneyInput
              label="Precio de todo junto"
              value={f.precio_fijo != null ? String(f.precio_fijo) : ""}
              onChange={(raw) => set("precio_fijo", raw === "" ? null : parseMoney(raw))}
              hint="Si el combo sale más caro que lo que el cliente ya pagaba, no se aplica."
            />
          </>
        ) : (
          <>
            {f.tipo === "porcentaje" ? (
              <Campo label="Porcentaje de descuento">
                <input
                  type="text"
                  inputMode="numeric"
                  value={f.valor ?? ""}
                  onChange={(e) => set("valor", num(e.target.value))}
                  placeholder="10"
                  className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-lg font-bold outline-none focus:border-brand-700"
                />
              </Campo>
            ) : (
              <MoneyInput
                label="Cuánto descuenta"
                value={f.valor != null ? String(f.valor) : ""}
                onChange={(raw) => set("valor", raw === "" ? null : parseMoney(raw))}
              />
            )}

            <Campo label="Sobre qué se aplica">
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Alcance">
                <Opcion
                  activo={f.product_id == null && f.kind == null}
                  onClick={() => {
                    set("product_id", null);
                    set("kind", null);
                  }}
                  label="Todo"
                />
                <Opcion
                  activo={f.kind != null}
                  onClick={() => {
                    set("product_id", null);
                    set("kind", "empanada");
                  }}
                  label="Categoría"
                />
                <Opcion
                  activo={f.product_id != null}
                  onClick={() => {
                    set("kind", null);
                    set("product_id", activos[0]?.id ?? null);
                  }}
                  label="Un producto"
                />
              </div>
            </Campo>

            {f.kind != null ? (
              <select
                value={f.kind}
                onChange={(e) => set("kind", e.target.value as Promo["kind"])}
                className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
              >
                <option value="empanada">Empanadas</option>
                <option value="bebida">Bebidas</option>
                <option value="otro">Otros</option>
              </select>
            ) : null}

            {f.product_id != null ? (
              <select
                value={f.product_id}
                onChange={(e) => set("product_id", e.target.value)}
                className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
              >
                {activos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}

            <Campo label="Mínimo de unidades para que se dispare (vacío = sin mínimo)">
              <input
                type="text"
                inputMode="numeric"
                value={f.minimo_unidades ?? ""}
                onChange={(e) => set("minimo_unidades", num(e.target.value))}
                className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-lg font-bold outline-none focus:border-brand-700"
              />
            </Campo>
          </>
        )}

        <div className="repulgue" aria-hidden />

        <Campo label="Qué días corre (ninguno marcado = todos)">
          <div className="grid grid-cols-7 gap-1">
            {DIAS.map(({ n, label }) => {
              const activo = f.dias?.includes(n) ?? false;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => toggleDia(n)}
                  className={`h-11 rounded-xl text-xs font-bold ${
                    activo
                      ? "bg-brand-900 text-ink-inverse"
                      : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Campo>

        <div className="grid grid-cols-2 gap-2">
          <Campo label="Desde">
            <input
              type="time"
              value={f.desde ?? ""}
              onChange={(e) => set("desde", e.target.value || null)}
              className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
            />
          </Campo>
          <Campo label="Hasta">
            <input
              type="time"
              value={f.hasta ?? ""}
              onChange={(e) => set("hasta", e.target.value || null)}
              className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
            />
          </Campo>
        </div>
        <p className="-mt-1 text-xs text-ink-500">
          Si &ldquo;hasta&rdquo; es más temprano que &ldquo;desde&rdquo; la promo cruza la medianoche:
          20:00 a 01:00 sigue siendo la noche del mismo día.
        </p>

        <Campo label="En qué canal">
          <select
            value={f.canal_id ?? ""}
            onChange={(e) => set("canal_id", e.target.value || null)}
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          >
            <option value="">Todos los canales</option>
            {canales.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Campo>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            className={f.activo ? "text-danger-600" : "text-success-600"}
            onClick={() => set("activo", !f.activo)}
          >
            {f.activo ? "Apagar promo" : "Encender promo"}
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={busy || !valido}
            onClick={async () => {
              setBusy(true);
              try {
                await upsertPromo({ ...f, id: f.id || undefined });
                notifyOutboxChanged();
                showToast(esNueva ? `Promo "${f.nombre}" creada` : "Promo actualizada");
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {esNueva ? "Crear promo" : "Guardar cambios"}
          </Button>
        </div>

        {!esNueva ? (
          <Button
            variant="ghost"
            className="text-danger-600"
            onClick={async () => {
              if (
                !window.confirm(
                  `¿Eliminar la promo "${f.nombre}"? Si ya se usó en alguna venta queda apagada en vez de borrarse, para que el recibo viejo se siga entendiendo.`
                )
              ) {
                return;
              }
              await deletePromo(f.id);
              notifyOutboxChanged();
              showToast("Promo eliminada");
              onClose();
            }}
          >
            <Trash2 size={16} /> Eliminar promo
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
        {label}
      </p>
      {children}
    </div>
  );
}

function Opcion({
  activo,
  onClick,
  label,
}: {
  activo: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activo}
      onClick={onClick}
      className={`h-11 rounded-xl text-sm font-bold ${
        activo
          ? "bg-brand-900 text-ink-inverse"
          : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
      }`}
    >
      {label}
    </button>
  );
}
