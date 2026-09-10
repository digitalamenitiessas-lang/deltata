"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { recordExpense, getOpenSessions } from "@/lib/ops";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { formatARS } from "@/lib/money";
import { useSesion } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { EXPENSE_CATEGORIES, PAYMENT_LABELS, type PaymentMethod } from "@/types";

const CATEGORY_LABELS: Record<string, string> = {
  mercaderia: "Mercadería",
  combustible: "Combustible",
  gas: "Gas",
  sueldos: "Sueldos",
  mantenimiento: "Mantenimiento",
  otros: "Otros",
};

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default function GastosPage() {
  const profileName = useSesion((s) => s.usuario?.nombre ?? "");
  const showToast = useUI((s) => s.showToast);
  const [open, setOpen] = useState(false);

  const expenses = useLiveQuery(
    () => db.expenses.orderBy("spent_at").reverse().limit(100).toArray(),
    []
  );

  const monthTotal = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return (expenses ?? [])
      .filter((e) => e.spent_at >= monthStart)
      .reduce((acc, e) => acc + e.amount, 0);
  }, [expenses]);

  return (
    <>
      <PageHeader
        title="Gastos"
        action={
          <Button size="md" onClick={() => setOpen(true)}>
            <Plus size={16} /> Nuevo
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
          <p className="text-xs text-ink-700">Gastado este mes</p>
          <p className="tnum text-3xl font-bold text-ink-950">{formatARS(monthTotal)}</p>
        </section>

        {expenses === undefined ? (
          <div aria-busy />
        ) : expenses.length === 0 ? (
          <EmptyState
            title="Todavía no registraste gastos"
            description="Los gastos en efectivo con caja abierta descuentan del arqueo automáticamente — así al cerrar no “falta plata”."
            action={<Button onClick={() => setOpen(true)}>Registrar un gasto</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {expenses.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink-950">{e.description}</p>
                  <p className="text-xs text-ink-500">
                    {dateFmt.format(new Date(e.spent_at))} ·{" "}
                    {CATEGORY_LABELS[e.category] ?? e.category} ·{" "}
                    {PAYMENT_LABELS[e.payment_method as PaymentMethod] ?? e.payment_method}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {e.cash_session_id ? <Badge tone="warn">De caja</Badge> : null}
                  <span className="tnum text-base font-bold text-ink-950">
                    −{formatARS(e.amount)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewExpenseSheet
        open={open}
        onOpenChange={setOpen}
        profileName={profileName}
        showToast={showToast}
      />
    </>
  );
}

function NewExpenseSheet({
  open,
  onOpenChange,
  profileName,
  showToast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profileName: string;
  showToast: (m: string) => void;
}) {
  const [category, setCategory] = useState<string>("mercaderia");
  const [description, setDescription] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [supplier, setSupplier] = useState("");
  const [productId, setProductId] = useState("");
  const [qtyRaw, setQtyRaw] = useState("");
  const [updateCost, setUpdateCost] = useState<boolean | null>(null);
  const [empleadoId, setEmpleadoId] = useState("");
  const [cajaId, setCajaId] = useState("");
  const [busy, setBusy] = useState(false);

  const products = useLiveQuery(() => db.products.orderBy("sort_order").toArray(), []);
  const empleados = useLiveQuery(() => db.empleados.orderBy("nombre").toArray(), []);
  // Con una caja por lugar hay que decir de cuál sale la plata: si no, el
  // gasto descontaría del arqueo equivocado.
  const cajas = useLiveQuery(() => getOpenSessions(), []);
  const canales = useLiveQuery(() => db.canales.toArray(), []);
  const hasOpenSession = (cajas ?? []).length > 0;
  const cajaElegida =
    (cajas ?? []).find((c) => c.id === cajaId) ?? (cajas ?? [])[0] ?? null;
  const nombreCanal = (id: string | null) =>
    (canales ?? []).find((c) => c.id === id)?.nombre ?? "Caja";

  const amount = parseMoney(amountRaw);
  const qty = Number(qtyRaw.replace(/[^\d]/g, "")) || 0;
  const isMerchandise = category === "mercaderia";
  const esSueldo = category === "sueldos";
  const newUnitCost =
    isMerchandise && productId && qty > 0 && amount > 0
      ? Math.round((amount / qty) * 100) / 100
      : null;

  const reset = () => {
    setDescription("");
    setAmountRaw("");
    setSupplier("");
    setProductId("");
    setQtyRaw("");
    setUpdateCost(null);
    setEmpleadoId("");
  };

  const submit = async () => {
    setBusy(true);
    try {
      await recordExpense({
        category,
        description: description.trim(),
        amount,
        payment_method: method,
        product_id: isMerchandise && productId ? productId : undefined,
        qty_purchased: isMerchandise && productId && qty > 0 ? qty : undefined,
        new_cost: updateCost && newUnitCost != null ? newUnitCost : null,
        supplier: supplier.trim() || undefined,
        empleado_id: esSueldo && empleadoId ? empleadoId : null,
        cash_session_id:
          method === "efectivo" && cajaElegida ? cajaElegida.id : null,
        created_by: profileName,
      });
      notifyOutboxChanged();
      showToast(`Gasto registrado · ${formatARS(amount)}`);
      reset();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Nuevo gasto">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Categoría">
          {EXPENSE_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              onClick={() => setCategory(c)}
              className={`h-11 rounded-full px-4 text-sm font-bold ${
                category === c
                  ? "bg-brand-900 text-ink-inverse"
                  : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
              }`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Descripción
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={isMerchandise ? "Ej: 500 empanadas crudas" : "Ej: garrafa"}
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
        </div>

        <MoneyInput label="Monto" value={amountRaw} onChange={setAmountRaw} />

        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
            Medio de pago
          </p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Medio de pago">
            {(["efectivo", "transferencia", "tarjeta", "qr"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={`h-11 rounded-xl text-sm font-bold ${
                  method === m
                    ? "bg-brand-900 text-ink-inverse"
                    : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                }`}
              >
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
          {method === "efectivo" && hasOpenSession ? (
            (cajas ?? []).length > 1 ? (
              <div className="mt-2 rounded-xl bg-[#f7ecd8] p-3">
                <p className="mb-1.5 text-xs font-bold text-warning-600">
                  ¿De qué caja sale la plata?
                </p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Caja">
                  {(cajas ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={cajaElegida?.id === c.id}
                      onClick={() => setCajaId(c.id)}
                      className={`h-10 rounded-lg px-3 text-xs font-bold ${
                        cajaElegida?.id === c.id
                          ? "bg-brand-900 text-ink-inverse"
                          : "border border-[var(--border-strong)] bg-surface-card text-ink-700"
                      }`}
                    >
                      {nombreCanal(c.canal_id)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-2 rounded-xl bg-[#f7ecd8] px-3 py-2 text-xs font-bold text-warning-600">
                Este gasto descontará efectivo de la caja de{" "}
                {nombreCanal(cajaElegida?.canal_id ?? null)}.
              </p>
            )
          ) : null}
        </div>

        {/* Un sueldo ya es un gasto: lo único que falta es a quién se le pagó.
            Así el pago cuadra con la caja sin llevar un segundo número. */}
        {esSueldo ? (
          <div>
            <label
              htmlFor="gasto-empleado"
              className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700"
            >
              ¿A quién se le paga?
            </label>
            <select
              id="gasto-empleado"
              value={empleadoId}
              onChange={(e) => setEmpleadoId(e.target.value)}
              className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
            >
              <option value="">Sin asignar</option>
              {(empleados ?? [])
                .filter((e) => e.activo)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-ink-500">
              Con esto, el pago aparece en la ficha de esa persona.
            </p>
          </div>
        ) : null}

        {isMerchandise ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border-soft)] bg-cream-100 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-700">
              ¿Entra stock? (opcional)
            </p>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              aria-label="Producto comprado"
              className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none"
            >
              <option value="">Sin producto asociado</option>
              {(products ?? [])
                .filter((p) => p.is_active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            {productId ? (
              <input
                type="text"
                inputMode="numeric"
                value={qtyRaw}
                onChange={(e) => setQtyRaw(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Cantidad comprada (unidades)"
                aria-label="Cantidad comprada"
                className="tnum h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm font-bold outline-none"
              />
            ) : null}
            {newUnitCost != null ? (
              <div className="rounded-xl bg-surface-card p-3">
                <p className="text-sm text-ink-950">
                  Compraste {qty} unidades por {formatARS(amount)}.
                  <br />
                  Nuevo costo unitario calculado:{" "}
                  <span className="tnum font-bold">{formatARS(newUnitCost)}</span>
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUpdateCost(true)}
                    className={`h-11 rounded-xl text-xs font-bold ${
                      updateCost === true
                        ? "bg-brand-900 text-ink-inverse"
                        : "border border-[var(--border-strong)] text-ink-700"
                    }`}
                  >
                    Actualizar costo
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpdateCost(false)}
                    className={`h-11 rounded-xl text-xs font-bold ${
                      updateCost === false
                        ? "bg-brand-900 text-ink-inverse"
                        : "border border-[var(--border-strong)] text-ink-700"
                    }`}
                  >
                    Mantener costo actual
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Proveedor (opcional)
          </label>
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
        </div>

        <Button
          size="lg"
          disabled={
            busy ||
            description.trim() === "" ||
            amount <= 0 ||
            (newUnitCost != null && updateCost === null)
          }
          onClick={() => void submit()}
        >
          {busy ? "Registrando…" : `Registrar gasto · ${formatARS(amount)}`}
        </Button>
        {newUnitCost != null && updateCost === null ? (
          <p className="text-center text-xs font-bold text-warning-600">
            Decidí si el costo unitario se actualiza o se mantiene.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
