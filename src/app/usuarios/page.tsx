"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, User, Plus } from "lucide-react";
import { useSesion, esAdmin } from "@/stores/sesion";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useUI } from "@/stores/ui";

interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: "admin" | "atiende";
  activo: boolean;
  created_at: string;
}

export default function UsuariosPage() {
  const usuario = useSesion((s) => s.usuario);
  const admin = esAdmin(usuario);
  const showToast = useUI((s) => s.showToast);

  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [yo, setYo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/usuarios");
      if (res.status === 403) return setError("Sólo el dueño administra usuarios.");
      if (!res.ok) return setError("No pudimos traer los usuarios. Necesita conexión.");
      const d = await res.json();
      setUsuarios(d.usuarios);
      setYo(d.yo);
    } catch {
      setError("Sin conexión. Los usuarios se administran en línea.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (admin) void cargar();
  }, [admin, cargar]);

  if (!admin) {
    return (
      <>
        <PageHeader title="Usuarios" />
        <div className="p-4">
          <EmptyState
            title="Esta sección es del dueño"
            description="Sólo las cuentas con rol de administrador pueden ver y administrar los usuarios."
          />
        </div>
      </>
    );
  }

  const duenios = (usuarios ?? []).filter((u) => u.rol === "admin");
  const empleados = (usuarios ?? []).filter((u) => u.rol === "atiende");

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Quién entra y qué puede hacer"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={() => void cargar()}>
              <RefreshCw size={16} className={cargando ? "animate-spin" : ""} />
            </Button>
            <Button size="md" onClick={() => setCreando(true)}>
              <Plus size={16} /> Nuevo
            </Button>
          </div>
        }
      />

      <div className="mx-auto flex max-w-2xl flex-col gap-5 p-4">
        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-[#f8e5e4] px-3 py-2 text-sm font-bold text-danger-600"
          >
            {error}
          </p>
        ) : null}

        <Grupo
          titulo="Dueños"
          descripcion="Ven todo y administran precios, catálogo, canales y usuarios."
          icono={<ShieldCheck size={16} className="text-brand-900" aria-hidden />}
          usuarios={duenios}
          yo={yo}
          onEditar={setEditando}
        />

        <Grupo
          titulo="Empleados"
          descripcion="Venden, manejan la caja, cuentan stock y registran mermas con motivo. No pueden ajustar stock ni cuentas, ni tocar precios."
          icono={<User size={16} className="text-ink-700" aria-hidden />}
          usuarios={empleados}
          yo={yo}
          onEditar={setEditando}
        />

        <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-5">
          <h2 className="text-sm font-bold text-ink-950">
            Qué no puede hacer un empleado
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-700">
            {[
              "Ajustar el stock a mano (sí puede registrar merma con motivo)",
              "Ajustar el saldo de una cuenta corriente",
              "Poner descuentos por fuera de los precios de media docena y docena",
              "Cargar entradas de mercadería o cambiar costos",
              "Tocar precios, productos o canales de venta",
              "Ver el panel de control ni la auditoría",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-danger-600" aria-hidden>
                  ✕
                </span>
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            Todo esto se rechaza en el servidor, no sólo se esconde el botón. Y
            cada operación que sí puede hacer queda firmada con su nombre en la
            auditoría.
          </p>
        </section>
      </div>

      <NuevoUsuario
        open={creando}
        onOpenChange={setCreando}
        onCreado={() => {
          void cargar();
          setCreando(false);
        }}
        showToast={showToast}
      />

      <EditarUsuario
        usuario={editando}
        esYo={editando?.id === yo}
        onClose={() => setEditando(null)}
        onGuardado={() => {
          void cargar();
          setEditando(null);
        }}
        showToast={showToast}
      />
    </>
  );
}

function NuevoUsuario({
  open,
  onOpenChange,
  onCreado,
  showToast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreado: () => void;
  showToast: (m: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<"admin" | "atiende">("atiende");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, nombre, rol, password: pass }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error ?? "No se pudo crear.");
      showToast(`${nombre.trim()} ya puede entrar`);
      setEmail("");
      setNombre("");
      setRol("atiende");
      setPass("");
      onCreado();
    } catch {
      setError("Sin conexión. Los usuarios se crean en línea.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Nuevo usuario">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Correo
          </label>
          <input
            type="email"
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="usuario3@deltata.com"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          <p className="mt-1 text-xs text-ink-500">
            No hace falta que la casilla exista: es sólo para entrar.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Nombre
          </label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Juan"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          <p className="mt-1 text-xs text-ink-500">
            Es el que aparece en cada venta, cierre y movimiento.
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
            Rol
          </p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rol">
            {(
              [
                ["atiende", "Empleado"],
                ["admin", "Dueño"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={rol === id}
                onClick={() => setRol(id)}
                className={`h-11 rounded-xl text-sm font-bold ${
                  rol === id
                    ? "bg-brand-900 text-ink-inverse"
                    : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {rol === "admin" ? (
            <p className="mt-1 text-xs text-warning-600">
              Un dueño ve todo y puede cambiar precios, usuarios y contraseñas.
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Contraseña
          </label>
          <input
            type="text"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            autoComplete="off"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          <p className="mt-1 text-xs text-ink-500">
            Se la pasás a mano. Después la podés cambiar desde acá.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-[#f8e5e4] px-3 py-2 text-sm font-bold text-danger-600"
          >
            {error}
          </p>
        ) : null}

        <Button
          size="lg"
          disabled={busy || !email.trim() || !nombre.trim() || pass.length < 6}
          onClick={() => void crear()}
        >
          {busy ? "Creando…" : "Crear usuario"}
        </Button>
      </div>
    </Sheet>
  );
}

function Grupo({
  titulo,
  descripcion,
  icono,
  usuarios,
  yo,
  onEditar,
}: {
  titulo: string;
  descripcion: string;
  icono: React.ReactNode;
  usuarios: Usuario[];
  yo: string | null;
  onEditar: (u: Usuario) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-2">
        {icono}
        <h2 className="font-[family-name:var(--font-fraunces)] text-xl font-bold text-ink-950">
          {titulo}
        </h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-700">{descripcion}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {usuarios.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => onEditar(u)}
              className={`flex w-full items-center justify-between gap-2 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3 text-left ${
                u.activo ? "" : "opacity-55"
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink-950">
                  {u.nombre}
                  {u.id === yo ? (
                    <span className="ml-2 font-normal text-ink-500">(vos)</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-ink-500">{u.email}</p>
              </div>
              {!u.activo ? <Badge tone="danger">De baja</Badge> : null}
            </button>
          </li>
        ))}
        {usuarios.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-[var(--border-strong)] px-4 py-3 text-sm text-ink-500">
            Todavía no hay.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function EditarUsuario({
  usuario,
  esYo,
  onClose,
  onGuardado,
  showToast,
}: {
  usuario: Usuario | null;
  esYo: boolean;
  onClose: () => void;
  onGuardado: () => void;
  showToast: (m: string) => void;
}) {
  const [nombre, setNombre] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!usuario) return null;
  const n = nombre ?? usuario.nombre;

  const guardar = async (cambios: Record<string, unknown>, mensaje: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/usuarios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: usuario.id, ...cambios }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error ?? "No se pudo guardar.");
      showToast(mensaje);
      setPass("");
      setNombre(null);
      onGuardado();
    } catch {
      setError("Sin conexión.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={usuario.email}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Nombre
          </label>
          <input
            value={n}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Juan"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          <p className="mt-1 text-xs text-ink-500">
            Es el nombre que aparece en cada venta, cierre y movimiento.
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
            Rol
          </p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rol">
            {(
              [
                ["atiende", "Empleado"],
                ["admin", "Dueño"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={usuario.rol === id}
                disabled={busy || esYo}
                onClick={() =>
                  guardar({ rol: id }, `${usuario.nombre} ahora es ${label.toLowerCase()}`)
                }
                className={`h-11 rounded-xl text-sm font-bold disabled:opacity-50 ${
                  usuario.rol === id
                    ? "bg-brand-900 text-ink-inverse"
                    : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {esYo ? (
            <p className="mt-1 text-xs text-ink-500">
              No podés cambiarte el rol a vos mismo.
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
            Cambiar contraseña
          </label>
          <input
            type="text"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            autoComplete="off"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          <p className="mt-1 text-xs text-ink-500">
            Se la pasás a mano. Queda registrado en la auditoría que la
            cambiaste.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-[#f8e5e4] px-3 py-2 text-sm font-bold text-danger-600"
          >
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={busy || esYo}
            className={usuario.activo ? "text-danger-600" : "text-success-600"}
            onClick={() =>
              guardar(
                { activo: !usuario.activo },
                usuario.activo
                  ? `${usuario.nombre} ya no puede entrar`
                  : `${usuario.nombre} puede entrar de nuevo`
              )
            }
          >
            {usuario.activo ? "Dar de baja" : "Reactivar"}
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={busy || (!n.trim() && !pass)}
            onClick={() =>
              guardar(
                {
                  nombre: n.trim() || undefined,
                  password: pass || undefined,
                },
                pass ? "Contraseña actualizada" : "Usuario actualizado"
              )
            }
          >
            Guardar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
