"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Share, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSesion, esAdmin } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import {
  activarPush,
  desactivarPush,
  esCelular,
  estadoPush,
  probarPush,
  sincronizarSuscripcion,
  type EstadoPush,
} from "@/lib/push-cliente";

/**
 * Notificaciones push del dueño: una campana debajo del encabezado que
 * sugiere activarlas en este celular o esta compu, y un panel en "Más" para
 * probarlas o apagarlas. Los avisos son del dueño, así que al que atiende no
 * se le ofrece nada: no le llegaría ninguno.
 */

const CLAVE_DESCARTE = "del-tata-avisos-descartado";
const DIAS_SIN_INSISTIR = 14;

function descartadoHacePoco(): boolean {
  try {
    const v = Number(localStorage.getItem(CLAVE_DESCARTE) ?? 0);
    return Date.now() - v < DIAS_SIN_INSISTIR * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function descartar() {
  try {
    localStorage.setItem(CLAVE_DESCARTE, String(Date.now()));
  } catch {
    // sin almacenamiento: vuelve a aparecer la próxima vez, no es grave
  }
}

function useEstadoPush(habilitado: boolean) {
  const [estado, setEstado] = useState<EstadoPush>("cargando");
  const refrescar = useCallback(async () => {
    try {
      const e = await estadoPush();
      setEstado(e);
      if (e === "activo") void sincronizarSuscripcion();
    } catch {
      setEstado("no-soportado");
    }
  }, []);
  useEffect(() => {
    // Al que atiende no le llega ningún aviso: ni se pregunta
    if (habilitado) void refrescar();
  }, [habilitado, refrescar]);
  return { estado, refrescar };
}

const dondeTexto = () => (esCelular() ? "este celular" : "esta compu");

function useActivar(refrescar: () => Promise<void>) {
  const showToast = useUI((s) => s.showToast);
  const [ocupado, setOcupado] = useState(false);
  const activar = async () => {
    setOcupado(true);
    const r = await activarPush();
    setOcupado(false);
    showToast(
      r.ok
        ? r.prueba
          ? `Notificaciones activadas en ${dondeTexto()}. Te mandamos una de prueba.`
          : `Notificaciones activadas en ${dondeTexto()}.`
        : r.motivo
    );
    await refrescar();
  };
  return { activar, ocupado };
}

/** La campana debajo del encabezado. Sólo aparece si hay algo para hacer. */
export function AvisoNotificaciones() {
  const admin = esAdmin(useSesion((s) => s.usuario));
  const { estado, refrescar } = useEstadoPush(admin);
  const { activar, ocupado } = useActivar(refrescar);
  const [oculto, setOculto] = useState(true);

  useEffect(() => {
    setOculto(descartadoHacePoco());
  }, []);

  if (!admin || oculto) return null;
  if (estado !== "apagado" && estado !== "ios-instalar") return null;

  const cerrar = () => {
    descartar();
    setOculto(true);
  };

  return (
    <div className="px-4 pt-3">
      <div
        role="region"
        aria-label="Activar notificaciones"
        className="flex items-start gap-3 rounded-2xl border border-brand-700 bg-brand-050 p-3"
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-900 text-ink-inverse">
          <BellRing size={18} aria-hidden />
        </span>

        {estado === "ios-instalar" ? (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-950">
              Recibí los avisos en el iPhone
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-700">
              Apple sólo los permite con la app instalada. Tocá{" "}
              <Share size={12} className="inline align-[-1px]" aria-label="Compartir" />{" "}
              <b>Compartir</b> → <b>“Agregar a inicio”</b>, abrí Del Tata desde
              ese ícono y tocá “Activar” en la campana.
            </p>
            <button
              type="button"
              onClick={cerrar}
              className="mt-2 text-xs font-bold text-brand-900 underline"
            >
              Entendido
            </button>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-950">
              Activá las notificaciones en {dondeTexto()}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-700">
              Te avisan los cierres de caja, las mermas, los gastos y las ventas
              para revisar, aunque no tengas la app abierta.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button size="md" onClick={() => void activar()} disabled={ocupado}>
                <Bell size={16} aria-hidden />
                {ocupado ? "Activando…" : "Activar"}
              </Button>
              <button
                type="button"
                onClick={cerrar}
                className="h-11 px-2 text-xs font-bold text-ink-700"
              >
                Ahora no
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={cerrar}
          aria-label="Cerrar aviso de notificaciones"
          className="-m-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Panel completo, para "Más": ver el estado, probar o apagar. */
export function PanelNotificaciones() {
  const admin = esAdmin(useSesion((s) => s.usuario));
  const showToast = useUI((s) => s.showToast);
  const { estado, refrescar } = useEstadoPush(admin);
  const { activar, ocupado } = useActivar(refrescar);
  const [probando, setProbando] = useState(false);

  if (!admin || estado === "cargando") return null;

  const Icono = estado === "activo" ? BellRing : estado === "bloqueado" ? BellOff : Bell;
  const donde = dondeTexto();

  const texto: Record<Exclude<EstadoPush, "cargando">, string> = {
    activo: `Activas en ${donde}. Te llegan los cierres de caja, las mermas, los gastos y las ventas para revisar que haga otra persona.`,
    apagado: `Apagadas en ${donde}. Activalas para enterarte de los cierres de caja, las mermas y las ventas para revisar sin abrir la app.`,
    "ios-instalar":
      "En el iPhone, Apple sólo permite avisos con la app instalada: Compartir → “Agregar a inicio”, y después activalas desde ahí.",
    bloqueado:
      "Están bloqueadas en este navegador. Se destraban desde los ajustes del sitio (el candado al lado de la dirección, o Ajustes → Notificaciones en el celular).",
    "sin-configurar":
      "Todavía no están configuradas en el servidor. Hace falta cargar las claves VAPID en Vercel.",
    "no-soportado": "Este navegador no puede recibir notificaciones. Probá con Chrome, Edge, Firefox o Safari.",
  };

  return (
    <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
      <div className="flex items-center gap-2">
        <Icono size={18} className="text-brand-900" aria-hidden />
        <h2 className="text-sm font-bold text-ink-950">Notificaciones</h2>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-700">{texto[estado]}</p>

      {estado === "apagado" ? (
        <Button className="mt-3" size="md" onClick={() => void activar()} disabled={ocupado}>
          <Bell size={16} aria-hidden />
          {ocupado ? "Activando…" : `Activar en ${donde}`}
        </Button>
      ) : null}

      {estado === "activo" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="md"
            disabled={probando}
            onClick={async () => {
              setProbando(true);
              const ok = await probarPush();
              setProbando(false);
              showToast(ok ? "Listo: tendría que llegarte una ahora." : "No salió. Revisá la señal y probá de nuevo.");
            }}
          >
            {probando ? "Mandando…" : "Mandar una de prueba"}
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="text-danger-600"
            onClick={async () => {
              await desactivarPush();
              showToast(`Notificaciones apagadas en ${donde}.`);
              await refrescar();
            }}
          >
            <BellOff size={16} aria-hidden />
            Apagar
          </Button>
        </div>
      ) : null}
    </section>
  );
}
