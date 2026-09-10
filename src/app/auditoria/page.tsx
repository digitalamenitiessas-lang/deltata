"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { useSesion, esAdmin } from "@/stores/sesion";
import { formatARS, formatUnits } from "@/lib/money";
import { PageHeader } from "@/components/shell/AppShell";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

interface Evento {
  id: number;
  ocurrido_en: string;
  registrado_en: string;
  user_email: string | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  resumen: string;
  monto: number | null;
  unidades: number | null;
  dispositivo: string | null;
}

interface Perfil {
  email: string;
  nombre: string;
  rol: string;
  activo: boolean;
}

const ACCIONES: Record<string, { label: string; tone: BadgeTone }> = {
  venta: { label: "Venta", tone: "brand" },
  apertura_caja: { label: "Apertura de caja", tone: "info" },
  cierre_caja: { label: "Cierre de caja", tone: "warn" },
  gasto: { label: "Gasto", tone: "muted" },
  compra: { label: "Compra", tone: "ok" },
  merma: { label: "Merma", tone: "danger" },
  ajuste_stock: { label: "Ajuste de stock", tone: "danger" },
  conteo: { label: "Conteo físico", tone: "info" },
  cambio_precio: { label: "Cambio de precio", tone: "warn" },
  cambio_costo: { label: "Cambio de costo", tone: "warn" },
  baja_producto: { label: "Baja de producto", tone: "danger" },
  alta_producto: { label: "Alta de producto", tone: "ok" },
  cobro_cuenta: { label: "Cobro cta. cte.", tone: "ok" },
  ajuste_cuenta: { label: "Ajuste cta. cte.", tone: "danger" },
  alta_cliente: { label: "Alta de cliente", tone: "muted" },
};

// Lo que el dueño mira primero: lo que puede tapar un faltante.
const SENSIBLES = new Set([
  "merma",
  "ajuste_stock",
  "cambio_precio",
  "cambio_costo",
  "baja_producto",
  "ajuste_cuenta",
]);

const fecha = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const RANGOS = [
  { id: "hoy", label: "Hoy" },
  { id: "7", label: "7 días" },
  { id: "30", label: "30 días" },
  { id: "todo", label: "Todo" },
] as const;

export default function AuditoriaPage() {
  const usuario = useSesion((s) => s.usuario);
  const admin = esAdmin(usuario);

  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [accion, setAccion] = useState("todas");
  const [quien, setQuien] = useState("todos");
  const [rango, setRango] = useState<(typeof RANGOS)[number]["id"]>("7");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const p = new URLSearchParams({ accion, usuario: quien });
      if (rango !== "todo") {
        const d = new Date();
        if (rango === "hoy") d.setHours(0, 0, 0, 0);
        else d.setDate(d.getDate() - Number(rango));
        p.set("desde", d.toISOString());
      }
      const res = await fetch(`/api/auditoria?${p}`);
      if (res.status === 403) {
        setError("Sólo el dueño puede ver la auditoría.");
        return;
      }
      if (!res.ok) {
        setError(
          "No pudimos traer la auditoría. Necesita conexión: el rastro vive en el servidor."
        );
        return;
      }
      const data = await res.json();
      setEventos(data.eventos);
      setUsuarios(data.usuarios);
    } catch {
      setError("Sin conexión. La auditoría se consulta en línea.");
    } finally {
      setCargando(false);
    }
  }, [accion, quien, rango]);

  useEffect(() => {
    if (admin) void cargar();
  }, [admin, cargar]);

  if (!admin) {
    return (
      <>
        <PageHeader title="Auditoría" />
        <div className="p-4">
          <EmptyState
            title="Esta sección es del dueño"
            description="Sólo la cuenta con rol de administrador puede ver el rastro de operaciones."
          />
        </div>
      </>
    );
  }

  const sensibles = (eventos ?? []).filter((e) => SENSIBLES.has(e.accion));

  return (
    <>
      <PageHeader
        title="Auditoría"
        subtitle="Todo lo que pasó, quién lo hizo y cuándo"
        action={
          <Button variant="secondary" size="md" onClick={() => void cargar()}>
            <RefreshCw size={16} className={cargando ? "animate-spin" : ""} />
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-4">
        {/* Filtros */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 overflow-x-auto">
            {RANGOS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRango(r.id)}
                className={`h-11 shrink-0 rounded-full px-4 text-sm font-bold ${
                  rango === r.id
                    ? "bg-brand-900 text-ink-inverse"
                    : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={accion}
              onChange={(e) => setAccion(e.target.value)}
              aria-label="Filtrar por tipo"
              className="h-12 rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none"
            >
              <option value="todas">Todas las acciones</option>
              {Object.entries(ACCIONES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>

            <select
              value={quien}
              onChange={(e) => setQuien(e.target.value)}
              aria-label="Filtrar por usuario"
              className="h-12 rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none"
            >
              <option value="todos">Todos los usuarios</option>
              {usuarios.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Lo que conviene mirar primero */}
        {sensibles.length > 0 ? (
          <section className="rounded-3xl border border-warning-600/40 bg-[#f7ecd8] p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-warning-600" aria-hidden />
              <h2 className="text-sm font-bold text-ink-950">
                {sensibles.length}{" "}
                {sensibles.length === 1 ? "movimiento" : "movimientos"} para
                mirar de cerca
              </h2>
            </div>
            <p className="mt-1 text-xs text-ink-700">
              Mermas, ajustes de stock o cuenta, cambios de precio o costo y
              bajas de producto: son las operaciones que pueden tapar una
              diferencia.
            </p>
          </section>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-[#f8e5e4] px-3 py-2 text-sm font-bold text-danger-600"
          >
            {error}
          </p>
        ) : null}

        {eventos === null && !error ? (
          <div className="p-4" aria-busy />
        ) : eventos && eventos.length === 0 ? (
          <EmptyState
            title="No hay movimientos en este período"
            description="Probá ampliar el rango o quitar los filtros."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {(eventos ?? []).map((e) => {
              const meta = ACCIONES[e.accion] ?? {
                label: e.accion,
                tone: "muted" as BadgeTone,
              };
              const desfasado =
                Math.abs(
                  new Date(e.registrado_en).getTime() -
                    new Date(e.ocurrido_en).getTime()
                ) > 120_000;
              return (
                <li
                  key={e.id}
                  className={`rounded-2xl border bg-surface-card px-4 py-3 ${
                    SENSIBLES.has(e.accion)
                      ? "border-warning-600/45"
                      : "border-[var(--border-soft)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="text-xs text-ink-500">
                      {fecha.format(new Date(e.ocurrido_en))}
                    </span>
                    <span className="text-xs font-bold text-ink-700">
                      {usuarios.find((u) => u.email === e.user_email)?.nombre ??
                        e.user_email ??
                        "sin identificar"}
                    </span>
                  </div>

                  <p className="tnum mt-1.5 text-sm font-bold text-ink-950">
                    {e.resumen}
                  </p>

                  <div className="tnum mt-1 flex flex-wrap gap-x-4 text-xs text-ink-500">
                    {e.monto != null ? (
                      <span>Monto: {formatARS(e.monto)}</span>
                    ) : null}
                    {e.unidades != null ? (
                      <span>Unidades: {formatUnits(e.unidades)}</span>
                    ) : null}
                    {desfasado ? (
                      <span className="font-bold text-warning-600">
                        Se sincronizó {fecha.format(new Date(e.registrado_en))}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="pb-4 text-center text-xs text-ink-500">
          El rastro no se puede editar ni borrar desde la app. Los cambios de
          precio y costo los registra la base de datos por su cuenta.
        </p>
      </div>
    </>
  );
}
