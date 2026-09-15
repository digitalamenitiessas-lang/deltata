"use client";

/**
 * Notificaciones push del lado del navegador.
 *
 * Tres realidades distintas:
 * - Android y compu (Chrome, Edge, Firefox, Safari de Mac): se activan con un
 *   toque y listo.
 * - iPhone/iPad: Apple sólo permite push si Del Tata está instalada en la
 *   pantalla de inicio (iOS 16.4 o más nuevo). En Safari común no existe la
 *   opción, así que primero hay que explicar cómo instalarla.
 * - Si la persona tocó "Bloquear", el navegador ya no vuelve a preguntar: se
 *   destraba desde los ajustes del sitio, no desde la app.
 */

export type EstadoPush =
  | "cargando"
  | "no-soportado"
  | "ios-instalar"
  | "sin-configurar"
  | "bloqueado"
  | "apagado"
  | "activo";

export function esIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // El iPad con iPadOS se presenta como Mac: se lo reconoce por la pantalla táctil
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function instalada(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** Para el texto: "este celular" o "esta compu". */
export function esCelular(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches)
  );
}

const soportaPush = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

let clavePublica: Promise<string | null> | null = null;

/** La clave VAPID del servidor, una vez por sesión de la app. */
function obtenerClave(): Promise<string | null> {
  if (!clavePublica) {
    clavePublica = fetch("/api/push")
      .then((r) => (r.ok ? r.json() : { publicKey: null }))
      .then((j: { publicKey?: string | null }) => j.publicKey ?? null)
      .catch(() => null);
    // Si falló (sin señal), que el próximo intento vuelva a preguntar
    void clavePublica.then((c) => {
      if (!c) clavePublica = null;
    });
  }
  return clavePublica;
}

async function registro(): Promise<ServiceWorkerRegistration> {
  // El layout lo registra en producción; acá se asegura también en local
  const reg =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  return reg;
}

export async function estadoPush(): Promise<EstadoPush> {
  if (esIOS() && !instalada()) return "ios-instalar";
  if (!soportaPush()) return "no-soportado";
  if (Notification.permission === "denied") return "bloqueado";

  const reg = await navigator.serviceWorker.getRegistration("/");
  const sus = await reg?.pushManager.getSubscription();
  if (sus && Notification.permission === "granted") return "activo";

  return (await obtenerClave()) ? "apagado" : "sin-configurar";
}

const aBytes = (b64url: string): Uint8Array<ArrayBuffer> => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const mismaClave = (sus: PushSubscription, clave: Uint8Array): boolean => {
  const actual = sus.options.applicationServerKey;
  if (!actual) return false;
  const a = new Uint8Array(actual);
  return a.length === clave.length && a.every((v, i) => v === clave[i]);
};

export type ResultadoActivar =
  | { ok: true; prueba: boolean }
  | { ok: false; motivo: string };

/**
 * Pide permiso, suscribe este navegador y le manda un aviso de prueba.
 * Tiene que llamarse directo desde el toque del botón: el iPhone sólo deja
 * pedir permiso como respuesta a un gesto de la persona.
 */
export async function activarPush(): Promise<ResultadoActivar> {
  if (esIOS() && !instalada()) {
    return { ok: false, motivo: "En el iPhone primero hay que agregar Del Tata a la pantalla de inicio." };
  }
  if (!soportaPush()) {
    return { ok: false, motivo: "Este navegador no puede recibir notificaciones." };
  }

  // Primero el permiso, antes de cualquier espera: si no, iOS lo rechaza
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    return {
      ok: false,
      motivo:
        permiso === "denied"
          ? "Quedaron bloqueadas. Se habilitan desde los ajustes del sitio en el navegador."
          : "No se dio el permiso. Podés volver a intentarlo cuando quieras.",
    };
  }

  try {
    const clave = await obtenerClave();
    if (!clave) {
      return { ok: false, motivo: "Falta configurar las notificaciones en el servidor." };
    }
    const reg = await registro();
    const bytes = aBytes(clave);

    let sus = await reg.pushManager.getSubscription();
    // Si el servidor cambió de clave, la suscripción vieja ya no sirve
    if (sus && !mismaClave(sus, bytes)) {
      await sus.unsubscribe();
      sus = null;
    }
    sus ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    });

    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sus.toJSON(), prueba: true }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; prueba?: string; error?: string };
    if (!res.ok) {
      return { ok: false, motivo: j.error ?? "No se pudo anotar este dispositivo. Probá de nuevo con señal." };
    }
    return { ok: true, prueba: j.prueba === "ok" };
  } catch {
    return { ok: false, motivo: "No se pudo activar. Revisá la señal y probá de nuevo." };
  }
}

export async function desactivarPush(): Promise<void> {
  if (!soportaPush()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sus = await reg?.pushManager.getSubscription();
  if (!sus) return;
  const endpoint = sus.endpoint;
  await sus.unsubscribe();
  await fetch("/api/push", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

let yaSincronizada = false;

/**
 * Si este navegador tiene los avisos activos, se lo recuerda al servidor una
 * vez por apertura de la app. La verdad está en el navegador: si del lado del
 * servidor la suscripción se perdió (un rechazo pasajero, un cambio de base),
 * se repara sola en vez de dejar al dueño creyendo que le llegan.
 */
export async function sincronizarSuscripcion(): Promise<void> {
  if (yaSincronizada || !soportaPush() || !navigator.onLine) return;
  yaSincronizada = true;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sus = await reg?.pushManager.getSubscription();
    if (!sus || Notification.permission !== "granted") return;
    await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sus.toJSON() }),
    });
  } catch {
    yaSincronizada = false;
  }
}

/** Vuelve a mandar el aviso de prueba a este dispositivo. */
export async function probarPush(): Promise<boolean> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sus = await reg?.pushManager.getSubscription();
  if (!sus) return false;
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sus.toJSON(), prueba: true }),
  }).catch(() => null);
  if (!res?.ok) return false;
  const j = (await res.json().catch(() => ({}))) as { prueba?: string };
  return j.prueba === "ok";
}
