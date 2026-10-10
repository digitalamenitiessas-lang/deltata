"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Store, Tag, Percent, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import {
  createProduct,
  deleteProduct,
  setCanalPrecio,
  updateProduct,
  upsertCanal,
} from "@/lib/ops";
import { Promos } from "@/components/config/Promos";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { formatARS } from "@/lib/money";
import { tarifaDe } from "@/lib/pricing";
import { useUI } from "@/stores/ui";
import { useSesion, esAdmin } from "@/stores/sesion";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Canal, Product, ProductKind } from "@/types";

// Precios, tramos, costo y mínimo por producto. Lo que falta se muestra como
// faltante — nunca como $0 (trampa #3 de la base técnica).

type Pestania = "productos" | "promos" | "canales";

export default function ConfiguracionPage() {
  const showToast = useUI((s) => s.showToast);
  const admin = esAdmin(useSesion((s) => s.usuario));
  const [pestania, setPestania] = useState<Pestania>("productos");
  const [editing, setEditing] = useState<Product | null>(null);
  const [creando, setCreando] = useState(false);

  // Los archivados no vuelven: siguen en la base para que las ventas viejas
  // se entiendan, pero no se administran más
  const products = useLiveQuery(
    () => db.products.orderBy("sort_order").filter((p) => !p.archivado).toArray(),
    []
  );
  const canalesTodos = useLiveQuery(
    () => db.canales.orderBy("sort_order").toArray(),
    []
  );

  if (!admin) {
    return (
      <>
        <PageHeader title="Configuración" />
        <div className="p-4">
          <EmptyState
            title="Esta sección es del dueño"
            description="Los precios y el catálogo los administra la cuenta con rol de administrador."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Configuración"
        subtitle="Catálogo, promos, precios y canales"
        action={
          pestania === "productos" ? (
            <Button size="md" onClick={() => setCreando(true)}>
              <Plus size={16} /> Nuevo
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 p-4">
        <div
          className="grid grid-cols-3 gap-1 rounded-2xl bg-cream-200 p-1"
          role="tablist"
        >
          {(
            [
              { id: "productos", label: "Productos", icon: Tag },
              { id: "promos", label: "Promos", icon: Percent },
              { id: "canales", label: "Canales", icon: Store },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pestania === id}
              onClick={() => setPestania(id)}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold ${
                pestania === id
                  ? "bg-brand-900 text-ink-inverse"
                  : "text-ink-700"
              }`}
            >
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {pestania === "productos" ? (
          <>
            <p className="text-sm text-ink-700">
              Tocá un producto para ajustar precios, costo y mínimo.
            </p>
            <ul className="flex flex-col gap-2">
              {(products ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className={`flex w-full items-center justify-between gap-2 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3 text-left ${
                      p.is_active ? "" : "opacity-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink-950">
                        {p.name}
                      </p>
                      <p className="tnum text-xs text-ink-500">
                        {p.half_dozen_price != null
                          ? `½ ${formatARS(p.half_dozen_price)} · `
                          : ""}
                        {p.dozen_price != null
                          ? `doc ${formatARS(p.dozen_price)} · `
                          : ""}
                        {p.cost_per_unit != null
                          ? `costo ${formatARS(p.cost_per_unit)}`
                          : "costo no cargado"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!p.is_active ? <Badge tone="muted">Inactivo</Badge> : null}
                      {p.frozen_dozen_price != null ? (
                        <Badge tone="info">Congelada</Badge>
                      ) : null}
                      {p.cost_per_unit == null ? (
                        <Badge tone="warn">Falta costo</Badge>
                      ) : null}
                      <span className="tnum text-base font-bold text-ink-950">
                        {formatARS(p.unit_price)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : pestania === "promos" ? (
          <Promos
            products={products ?? []}
            canales={canalesTodos ?? []}
            showToast={showToast}
          />
        ) : (
          <Canales showToast={showToast} products={products ?? []} />
        )}
      </div>

      <EditProductSheet
        product={editing}
        onClose={() => setEditing(null)}
        showToast={showToast}
      />
      <NuevoProductoSheet
        open={creando}
        onOpenChange={setCreando}
        showToast={showToast}
      />
    </>
  );
}

// ── CANALES ──────────────────────────────────────────────────────────────────

function Canales({
  showToast,
  products,
}: {
  showToast: (m: string) => void;
  products: Product[];
}) {
  const canales = useLiveQuery(() => db.canales.orderBy("sort_order").toArray(), []);
  const [editando, setEditando] = useState<Canal | null>(null);
  const [precios, setPrecios] = useState<Canal | null>(null);

  return (
    <>
      <p className="text-sm text-ink-700">
        Cada canal cobra con su propia lista. El recargo se aplica sobre el
        precio base; si un producto necesita otro precio, se fija aparte.
      </p>

      <ul className="flex flex-col gap-2">
        {(canales ?? []).map((c) => (
          <li
            key={c.id}
            className="rounded-2xl border border-[var(--border-soft)] bg-surface-card p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-ink-950">
                  {c.nombre}
                  {c.es_default ? <Badge tone="brand">Por defecto</Badge> : null}
                  {!c.activo ? <Badge tone="muted">Inactivo</Badge> : null}
                </p>
                <p className="tnum text-xs text-ink-500">
                  {c.recargo_pct === 0
                    ? "Mismo precio que el base"
                    : `${c.recargo_pct > 0 ? "+" : ""}${c.recargo_pct}% sobre el base`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditando(c)}>
                  Editar
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setPrecios(c)}>
                  Precios
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Button
        variant="secondary"
        size="lg"
        onClick={() =>
          setEditando({
            id: "",
            nombre: "",
            recargo_pct: 0,
            es_default: false,
            activo: true,
            sort_order: 0,
            ubicacion_id: null,
          })
        }
      >
        <Plus size={16} /> Nuevo canal
      </Button>

      <EditarCanalSheet
        canal={editando}
        onClose={() => setEditando(null)}
        showToast={showToast}
      />
      <PreciosCanalSheet
        canal={precios}
        products={products}
        onClose={() => setPrecios(null)}
        showToast={showToast}
      />
    </>
  );
}

function EditarCanalSheet({
  canal,
  onClose,
  showToast,
}: {
  canal: Canal | null;
  onClose: () => void;
  showToast: (m: string) => void;
}) {
  const [nombre, setNombre] = useState<string | null>(null);
  const [recargo, setRecargo] = useState<string | null>(null);
  const [lugar, setLugar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ubicaciones = useLiveQuery(() => db.ubicaciones.orderBy("sort_order").toArray(), []);
  if (!canal) return null;

  const esNuevo = canal.id === "";
  const n = nombre ?? canal.nombre;
  const r = recargo ?? String(canal.recargo_pct);
  const u = lugar ?? canal.ubicacion_id ?? (ubicaciones ?? []).at(-1)?.id ?? null;

  const close = () => {
    setNombre(null);
    setRecargo(null);
    setLugar(null);
    onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && close()}
      title={esNuevo ? "Nuevo canal" : canal.nombre}
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Nombre
          </label>
          <input
            value={n}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: PedidosYa, Rappi, Mayorista"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Recargo sobre el precio base (%)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={r}
            onChange={(e) => setRecargo(e.target.value.replace(/[^\d.-]/g, ""))}
            className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-lg font-bold outline-none focus:border-brand-700"
          />
          <p className="mt-1 text-xs text-ink-500">
            0 = mismo precio que el foodtruck. Si en la app cobran comisión,
            este es el porcentaje que sube el precio de lista.
          </p>
        </div>
        {(ubicaciones ?? []).length > 1 ? (
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
              ¿De dónde sale la mercadería?
            </p>
            <div className="flex gap-2" role="radiogroup" aria-label="Lugar del canal">
              {(ubicaciones ?? []).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={u === x.id}
                  onClick={() => setLugar(x.id)}
                  className={`h-11 flex-1 rounded-xl text-sm font-bold ${
                    u === x.id
                      ? "bg-brand-900 text-ink-inverse"
                      : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                  }`}
                >
                  {x.nombre}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-500">
              Lo que se vende por este canal descuenta del stock de ese lugar.
            </p>
          </div>
        ) : null}

        {!canal.es_default ? (
          <Button
            variant="ghost"
            className={canal.activo ? "text-danger-600" : "text-success-600"}
            onClick={async () => {
              await upsertCanal({
                id: canal.id || undefined,
                nombre: n,
                recargo_pct: Number(r) || 0,
                activo: !canal.activo,
              });
              notifyOutboxChanged();
              showToast(canal.activo ? "Canal desactivado" : "Canal activado");
              close();
            }}
          >
            {canal.activo ? "Desactivar canal" : "Activar canal"}
          </Button>
        ) : null}

        <Button
          size="lg"
          disabled={busy || !n.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await upsertCanal({
                id: canal.id || undefined,
                nombre: n,
                recargo_pct: Number(r) || 0,
                ubicacion_id: u,
              });
              notifyOutboxChanged();
              showToast(esNuevo ? `Canal ${n} creado` : `${n} actualizado`);
              close();
            } finally {
              setBusy(false);
            }
          }}
        >
          {esNuevo ? "Crear canal" : "Guardar cambios"}
        </Button>
      </div>
    </Sheet>
  );
}

function PreciosCanalSheet({
  canal,
  products,
  onClose,
  showToast,
}: {
  canal: Canal | null;
  products: Product[];
  onClose: () => void;
  showToast: (m: string) => void;
}) {
  const [sel, setSel] = useState<Product | null>(null);
  const precios = useLiveQuery(
    async () =>
      canal ? db.canal_precios.where("canal_id").equals(canal.id).toArray() : [],
    [canal?.id]
  );
  const overrides = useMemo(
    () => new Map((precios ?? []).map((p) => [p.product_id, p])),
    [precios]
  );

  if (!canal) return null;

  return (
    <>
      <Sheet
        open={sel == null}
        onOpenChange={(o) => !o && onClose()}
        title={`Precios · ${canal.nombre}`}
      >
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-700">
            Sin precio propio se usa el base
            {canal.recargo_pct !== 0 ? ` con ${canal.recargo_pct}% de recargo` : ""}.
            Tocá un producto para fijarle uno distinto.
          </p>
          <ul className="flex max-h-[55dvh] flex-col gap-1.5 overflow-y-auto">
            {products
              .filter((p) => p.is_active)
              .map((p) => {
                const o = overrides.get(p.id);
                const t = tarifaDe(p, canal, o);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSel(p)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border-soft)] bg-surface-card px-3 py-2.5 text-left"
                    >
                      <span className="min-w-0 truncate text-sm font-bold text-ink-950">
                        {p.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {o ? <Badge tone="warn">Propio</Badge> : null}
                        <span className="tnum text-sm font-bold text-ink-950">
                          {formatARS(t.unidad)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      </Sheet>

      {sel ? (
        <PrecioProductoCanal
          canal={canal}
          product={sel}
          onClose={() => setSel(null)}
          showToast={showToast}
        />
      ) : null}
    </>
  );
}

function PrecioProductoCanal({
  canal,
  product,
  onClose,
  showToast,
}: {
  canal: Canal;
  product: Product;
  onClose: () => void;
  showToast: (m: string) => void;
}) {
  const existente = useLiveQuery(
    () => db.canal_precios.get([canal.id, product.id]),
    [canal.id, product.id]
  );
  const base = tarifaDe(product, canal, undefined);

  const [unit, setUnit] = useState<string | null>(null);
  const [media, setMedia] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const v = (
    local: string | null,
    guardado: number | null | undefined
  ): string => local ?? (guardado != null ? String(guardado) : "");

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${product.name} en ${canal.nombre}`}
    >
      <div className="flex flex-col gap-3">
        <p className="tnum rounded-xl bg-cream-100 px-3 py-2 text-xs text-ink-700">
          Con el precio base
          {canal.recargo_pct !== 0 ? ` y ${canal.recargo_pct}% de recargo` : ""}{" "}
          quedaría: unidad {formatARS(base.unidad)}
          {base.media != null ? ` · ½ ${formatARS(base.media)}` : ""}
          {base.docena != null ? ` · doc ${formatARS(base.docena)}` : ""}
        </p>

        <MoneyInput
          label="Precio unitario propio (vacío = usar el base)"
          value={v(unit, existente?.unit_price)}
          onChange={setUnit}
        />
        {product.kind === "empanada" ? (
          <>
            <MoneyInput
              label="Media docena propia (vacío = usar el base)"
              value={v(media, existente?.half_dozen_price)}
              onChange={setMedia}
            />
            <MoneyInput
              label="Docena propia (vacío = usar el base)"
              value={v(doc, existente?.dozen_price)}
              onChange={setDoc}
            />
          </>
        ) : null}

        <Button
          size="lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const num = (x: string) => (x === "" ? null : parseMoney(x));
              await setCanalPrecio({
                canal_id: canal.id,
                product_id: product.id,
                unit_price: num(v(unit, existente?.unit_price)),
                half_dozen_price: num(v(media, existente?.half_dozen_price)),
                dozen_price: num(v(doc, existente?.dozen_price)),
                frozen_dozen_price: existente?.frozen_dozen_price ?? null,
              });
              notifyOutboxChanged();
              showToast(`${product.name} actualizado en ${canal.nombre}`);
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          Guardar
        </Button>
      </div>
    </Sheet>
  );
}

// ── PRODUCTOS ────────────────────────────────────────────────────────────────

function NuevoProductoSheet({
  open,
  onOpenChange,
  showToast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  showToast: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProductKind>("bebida");
  const [unit, setUnit] = useState("");
  const [media, setMedia] = useState("");
  const [doc, setDoc] = useState("");
  const [cost, setCost] = useState("");
  const [min, setMin] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setKind("bebida");
    setUnit("");
    setMedia("");
    setDoc("");
    setCost("");
    setMin("");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Nuevo producto">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Nombre
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Gaseosa 1,5 L"
            autoFocus
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
            Tipo
          </p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo">
            {(
              [
                ["empanada", "Empanada"],
                ["bebida", "Bebida"],
                ["otro", "Otro"],
              ] as [ProductKind, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={kind === id}
                onClick={() => setKind(id)}
                className={`h-11 rounded-xl text-sm font-bold ${
                  kind === id
                    ? "bg-brand-900 text-ink-inverse"
                    : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <MoneyInput label="Precio unitario" value={unit} onChange={setUnit} />
        {kind === "empanada" ? (
          <>
            <MoneyInput
              label="Media docena (opcional)"
              value={media}
              onChange={setMedia}
            />
            <MoneyInput label="Docena (opcional)" value={doc} onChange={setDoc} />
          </>
        ) : null}
        <MoneyInput
          label="Costo por unidad (vacío = no cargado)"
          value={cost}
          onChange={setCost}
        />
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Alerta de mínimo (vacío = sin alerta)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={min}
            onChange={(e) => setMin(e.target.value.replace(/[^\d]/g, ""))}
            className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-lg font-bold outline-none focus:border-brand-700"
          />
          <p className="mt-1 text-xs text-ink-500">
            Cuando queden estas unidades o menos, aparece el aviso en Control y
            en Stock.
          </p>
        </div>

        <Button
          size="lg"
          disabled={busy || !name.trim() || parseMoney(unit) <= 0}
          onClick={async () => {
            setBusy(true);
            try {
              await createProduct({
                name,
                kind,
                unit_price: parseMoney(unit),
                half_dozen_price: media === "" ? null : parseMoney(media),
                dozen_price: doc === "" ? null : parseMoney(doc),
                cost_per_unit: cost === "" ? null : parseMoney(cost),
                min_qty: min === "" ? null : Number(min),
              });
              notifyOutboxChanged();
              showToast(`${name.trim()} agregado al catálogo`);
              reset();
              onOpenChange(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          Crear producto
        </Button>
      </div>
    </Sheet>
  );
}

function EditProductSheet({
  product,
  onClose,
  showToast,
}: {
  product: Product | null;
  onClose: () => void;
  showToast: (m: string) => void;
}) {
  const [unitRaw, setUnitRaw] = useState<string | null>(null);
  const [mediaRaw, setMediaRaw] = useState<string | null>(null);
  const [dozenRaw, setDozenRaw] = useState<string | null>(null);
  const [frozenRaw, setFrozenRaw] = useState<string | null>(null);
  const [costRaw, setCostRaw] = useState<string | null>(null);
  const [minRaw, setMinRaw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!product) return null;

  const val = (local: string | null, saved: number | null) =>
    local ?? (saved != null ? String(saved) : "");
  const unit = unitRaw ?? String(product.unit_price || "");
  const media = val(mediaRaw, product.half_dozen_price);
  const dozen = val(dozenRaw, product.dozen_price);
  const frozen = val(frozenRaw, product.frozen_dozen_price);
  const cost = val(costRaw, product.cost_per_unit);
  const min = val(minRaw, product.min_qty);

  const close = () => {
    setUnitRaw(null);
    setMediaRaw(null);
    setDozenRaw(null);
    setFrozenRaw(null);
    setCostRaw(null);
    setMinRaw(null);
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && close()} title={product.name}>
      <div className="flex flex-col gap-3">
        <MoneyInput label="Precio unitario" value={unit} onChange={setUnitRaw} />
        {product.kind === "empanada" ? (
          <>
            <MoneyInput
              label="Media docena (vacío = sin ese tramo)"
              value={media}
              onChange={setMediaRaw}
              hint="Con este precio cargado, 6 empanadas dejan de cobrarse por unidad."
            />
            <MoneyInput
              label="Docena (vacío = sin ese tramo)"
              value={dozen}
              onChange={setDozenRaw}
            />
            <MoneyInput
              label="Docena congelada (vacío = no se vende congelada)"
              value={frozen}
              onChange={setFrozenRaw}
            />
          </>
        ) : null}
        <MoneyInput
          label="Costo por unidad (vacío = no cargado)"
          value={cost}
          onChange={setCostRaw}
          hint="Con el costo cargado, el margen deja de ser parcial."
        />
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Mínimo operativo (vacío = sin mínimo)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={min}
            onChange={(e) => setMinRaw(e.target.value.replace(/[^\d]/g, ""))}
            className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-lg font-bold outline-none focus:border-brand-700"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className={product.is_active ? "text-danger-600" : "text-success-600"}
            onClick={async () => {
              await updateProduct(product.id, { is_active: !product.is_active });
              notifyOutboxChanged();
              showToast(
                product.is_active ? "Producto desactivado" : "Producto activado"
              );
              close();
            }}
          >
            {product.is_active ? "Desactivar" : "Activar"}
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={busy || parseMoney(unit) <= 0}
            onClick={async () => {
              setBusy(true);
              try {
                await updateProduct(product.id, {
                  unit_price: parseMoney(unit),
                  half_dozen_price: media === "" ? null : parseMoney(media),
                  dozen_price: dozen === "" ? null : parseMoney(dozen),
                  frozen_dozen_price: frozen === "" ? null : parseMoney(frozen),
                  cost_per_unit: cost === "" ? null : parseMoney(cost),
                  min_qty: min === "" ? null : Number(min),
                });
                notifyOutboxChanged();
                showToast(`${product.name} actualizado`);
                close();
              } finally {
                setBusy(false);
              }
            }}
          >
            Guardar cambios
          </Button>
        </div>

        <div className="repulgue" aria-hidden />

        <Button
          variant="ghost"
          className="text-danger-600"
          disabled={busy}
          onClick={async () => {
            const aviso = `¿Sacar "${product.name}" del catálogo? Deja de aparecer en todos lados; las ventas viejas lo siguen mostrando.`;
            if (!window.confirm(aviso)) return;
            setBusy(true);
            try {
              await deleteProduct(product.id);
              notifyOutboxChanged();
              showToast(`${product.name} salió del catálogo`);
              close();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trash2 size={16} />
          Eliminar producto
        </Button>
      </div>
    </Sheet>
  );
}
