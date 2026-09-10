"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { HandCoins, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { formatARS } from "@/lib/money";
import { useSesion, esAdmin } from "@/stores/sesion";
import { PageHeader } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sheet } from "@/components/ui/Sheet";
import type { Expense } from "@/types";

/**
 * Pago de empleados.
 *
 * No lleva un ledger propio: un sueldo YA es un gasto, y como gasto en
 * efectivo con la caja abierta descuenta del arqueo solo. Esta pantalla es una
 * lectura de esos mismos gastos agrupados por persona. Un segundo registro
 * aparte podría diferir del primero, y entonces habría dos verdades.
 */

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const mesFmt = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

export default function EmpleadosPage() {
  const admin = esAdmin(useSesion((s) => s.usuario));
  const [detalle, setDetalle] = useState<string | null>(null);

  const empleados = useLiveQuery(() => db.empleados.orderBy("nombre").toArray(), []);
  const sueldos = useLiveQuery(
    async () =>
      (await db.expenses.where("category").equals("sueldos").toArray()).sort(
        (a, b) => b.spent_at.localeCompare(a.spent_at)
      ),
    []
  );

  const inicioMes = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1).toISOString();
  }, []);

  const porEmpleado = useMemo(() => {
    const mapa = new Map<string, { mes: number; total: number; ultimo: string | null }>();
    for (const s of sueldos ?? []) {
      if (!s.empleado_id) continue;
      const actual = mapa.get(s.empleado_id) ?? { mes: 0, total: 0, ultimo: null };
      actual.total += s.amount;
      if (s.spent_at >= inicioMes) actual.mes += s.amount;
      if (!actual.ultimo || s.spent_at > actual.ultimo) actual.ultimo = s.spent_at;
      mapa.set(s.empleado_id, actual);
    }
    return mapa;
  }, [sueldos, inicioMes]);

  // Sueldos pagados sin decir a quién: no se puede controlar lo que no tiene nombre
  const sinAsignar = useMemo(
    () => (sueldos ?? []).filter((s) => !s.empleado_id),
    [sueldos]
  );

  if (!admin) {
    return (
      <>
        <PageHeader title="Empleados" />
        <div className="p-4">
          <EmptyState
            title="Esta sección es del dueño"
            description="Los pagos al personal los administra la cuenta con rol de administrador."
          />
        </div>
      </>
    );
  }

  const activos = (empleados ?? []).filter((e) => e.activo);

  return (
    <>
      <PageHeader
        title="Empleados"
        subtitle={`Pagos de ${mesFmt.format(new Date())}`}
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-ink-700">
          Cada pago se carga desde{" "}
          <Link href="/gastos" className="font-bold text-brand-900 underline">
            Gastos
          </Link>{" "}
          con la categoría Sueldos, eligiendo a quién se le paga. Si se paga en
          efectivo con la caja abierta, ya descuenta del arqueo.
        </p>

        {activos.length === 0 ? (
          <EmptyState
            title="No hay personal cargado"
            description="Las personas salen de las cuentas del sistema. Se dan de alta en la pantalla de Usuarios."
            action={
              <Link href="/usuarios">
                <Button>Ir a Usuarios</Button>
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {activos.map((e) => {
              const d = porEmpleado.get(e.id);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setDetalle(e.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-bold text-ink-950">
                        {e.nombre}
                        {e.rol === "admin" ? <Badge tone="brand">Dueño</Badge> : null}
                      </p>
                      <p className="text-xs text-ink-500">
                        {d?.ultimo
                          ? `Último pago: ${dateFmt.format(new Date(d.ultimo))}`
                          : "Sin pagos registrados"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tnum text-base font-bold text-ink-950">
                        {formatARS(d?.mes ?? 0)}
                      </p>
                      <p className="text-xs text-ink-500">este mes</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {sinAsignar.length > 0 ? (
          <div className="flex items-start gap-2 rounded-2xl border border-warning-600 bg-[#f7ecd8] p-4">
            <TriangleAlert
              size={18}
              className="mt-0.5 shrink-0 text-warning-600"
              aria-hidden
            />
            <div>
              <p className="text-sm font-bold text-ink-950">
                {sinAsignar.length === 1
                  ? "Hay un pago de sueldo sin asignar"
                  : `Hay ${sinAsignar.length} pagos de sueldo sin asignar`}
              </p>
              <p className="mt-0.5 text-xs text-ink-700">
                Suman {formatARS(sinAsignar.reduce((a, s) => a + s.amount, 0))} y no
                dicen a quién se le pagó, así que no entran en ninguna ficha.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <FichaEmpleado
        nombre={(empleados ?? []).find((e) => e.id === detalle)?.nombre ?? ""}
        pagos={(sueldos ?? []).filter((s) => s.empleado_id === detalle)}
        abierta={detalle != null}
        onClose={() => setDetalle(null)}
      />
    </>
  );
}

function FichaEmpleado({
  nombre,
  pagos,
  abierta,
  onClose,
}: {
  nombre: string;
  pagos: Expense[];
  abierta: boolean;
  onClose: () => void;
}) {
  if (!abierta) return null;
  const total = pagos.reduce((a, p) => a + p.amount, 0);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={nombre}>
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl bg-brand-900 p-4 text-ink-inverse">
          <p className="text-xs text-brand-100">Total pagado</p>
          <p className="tnum text-3xl font-bold">{formatARS(total)}</p>
          <p className="mt-1 text-xs text-brand-100">
            {pagos.length} {pagos.length === 1 ? "pago" : "pagos"} registrados
          </p>
        </div>

        {pagos.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-700">
            Todavía no hay pagos cargados para {nombre}.
          </p>
        ) : (
          <ul className="flex max-h-[45dvh] flex-col divide-y divide-[var(--border-soft)] overflow-y-auto">
            {pagos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink-950">
                    {p.description}
                  </p>
                  <p className="text-xs text-ink-500">
                    {dateFmt.format(new Date(p.spent_at))} · {p.payment_method}
                    {p.cash_session_id ? " · de caja" : ""}
                  </p>
                </div>
                <span className="tnum shrink-0 text-sm font-bold text-ink-950">
                  {formatARS(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Link href="/gastos" className="w-full">
          <Button size="lg" className="w-full">
            <HandCoins size={16} /> Registrar un pago
          </Button>
        </Link>
      </div>
    </Sheet>
  );
}
