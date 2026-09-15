import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

/**
 * Web Push sin librerías: cifrado del mensaje (RFC 8291, aes128gcm) y firma
 * del servidor con VAPID (RFC 8292). Es poco código y así no sumamos una
 * dependencia al repo público para algo que node:crypto ya trae.
 *
 * Sólo corre en el servidor: la clave privada nunca llega al navegador.
 */

export interface Suscripcion {
  endpoint: string;
  /** clave pública del navegador (P-256, sin comprimir, base64url) */
  p256dh: string;
  /** secreto de 16 bytes del navegador (base64url) */
  auth: string;
}

export interface ClavesVapid {
  /** P-256 sin comprimir (65 bytes), base64url: la misma que usa el navegador */
  publica: string;
  /** escalar privado (32 bytes), base64url */
  privada: string;
  /** "mailto:…" o "https://…": a quién avisa el servicio de push si hay abuso */
  sujeto: string;
}

const deB64 = (s: string) => Buffer.from(s, "base64url");
const aB64 = (b: Buffer) => b.toString("base64url");
const expandir = (ikm: Buffer, sal: Buffer, info: Buffer, largo: number) =>
  Buffer.from(hkdfSync("sha256", ikm, sal, info, largo));

/**
 * El cuerpo cifrado tal como lo espera el servicio de push.
 * `fijo` existe sólo para probar contra los vectores del RFC.
 */
export function cifrar(
  mensaje: Buffer,
  sus: Pick<Suscripcion, "p256dh" | "auth">,
  fijo?: { sal: Buffer; privadaEfimera: Buffer }
): Buffer {
  const publicaNavegador = deB64(sus.p256dh);
  const secreto = deB64(sus.auth);

  const ecdh = createECDH("prime256v1");
  if (fijo) ecdh.setPrivateKey(fijo.privadaEfimera);
  else ecdh.generateKeys();
  const publicaServidor = ecdh.getPublicKey();
  const compartido = ecdh.computeSecret(publicaNavegador);

  const sal = fijo?.sal ?? randomBytes(16);
  const ikm = expandir(
    compartido,
    secreto,
    Buffer.concat([Buffer.from("WebPush: info\0"), publicaNavegador, publicaServidor]),
    32
  );
  const cek = expandir(ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expandir(ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cifrador = createCipheriv("aes-128-gcm", cek, nonce);
  // Un solo registro: el mensaje + el delimitador 0x02, sin relleno
  const cuerpo = Buffer.concat([
    cifrador.update(Buffer.concat([mensaje, Buffer.from([2])])),
    cifrador.final(),
    cifrador.getAuthTag(),
  ]);

  const tamRegistro = Buffer.alloc(4);
  tamRegistro.writeUInt32BE(4096);
  return Buffer.concat([
    sal,
    tamRegistro,
    Buffer.from([publicaServidor.length]),
    publicaServidor,
    cuerpo,
  ]);
}

/** Encabezado Authorization de VAPID para el servicio de push de `endpoint`. */
export function autorizacionVapid(
  endpoint: string,
  claves: ClavesVapid,
  ahora = Date.now()
): string {
  const publica = deB64(claves.publica);
  const clave = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: claves.privada,
      x: aB64(publica.subarray(1, 33)),
      y: aB64(publica.subarray(33, 65)),
    },
    format: "jwk",
  });

  const cabecera = aB64(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const reclamos = aB64(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        // El máximo que aceptan los servicios es 24 h
        exp: Math.floor(ahora / 1000) + 12 * 60 * 60,
        sub: claves.sujeto,
      })
    )
  );
  const firma = sign("sha256", Buffer.from(`${cabecera}.${reclamos}`), {
    key: clave,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${cabecera}.${reclamos}.${aB64(firma)}, k=${claves.publica}`;
}

/**
 * Sólo los servicios de push reales. El servidor hace un POST a la dirección
 * que manda el navegador: sin esta lista, cualquiera con usuario podría
 * hacerlo pegarle a una dirección interna.
 */
const SERVICIOS = [
  "fcm.googleapis.com", // Chrome, Android, Edge nuevo
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari e iPhone
  "notify.windows.com", // Edge viejo (subdominios)
];

export function endpointValido(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return false;
    return SERVICIOS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export type ResultadoEnvio = "ok" | "vencida" | "error";

/**
 * Manda un aviso. "vencida" = el navegador ya no la acepta (la desinstalaron,
 * revocaron el permiso): hay que borrarla para no insistir.
 */
export async function enviarPush(
  sus: Suscripcion,
  mensaje: object,
  claves: ClavesVapid,
  opciones: { ttlSegundos?: number; urgencia?: "normal" | "high"; tema?: string } = {}
): Promise<{ resultado: ResultadoEnvio; status?: number }> {
  if (!endpointValido(sus.endpoint)) return { resultado: "vencida" };
  try {
    const res = await fetch(sus.endpoint, {
      method: "POST",
      headers: {
        Authorization: autorizacionVapid(sus.endpoint, claves),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opciones.ttlSegundos ?? 24 * 60 * 60),
        Urgency: opciones.urgencia ?? "normal",
        // Mismo tema = el aviso nuevo reemplaza al viejo si todavía no llegó
        ...(opciones.tema ? { Topic: opciones.tema.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
      },
      body: new Uint8Array(cifrar(Buffer.from(JSON.stringify(mensaje)), sus)),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404 || res.status === 410) return { resultado: "vencida", status: res.status };
    return { resultado: res.ok ? "ok" : "error", status: res.status };
  } catch {
    return { resultado: "error" };
  }
}

/** Un par de claves VAPID nuevo (para configurar el servidor una vez). */
export function generarClavesVapid(): { publica: string; privada: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publica: aB64(ecdh.getPublicKey()), privada: aB64(ecdh.getPrivateKey()) };
}

/** Las claves del entorno, o null si todavía no se configuraron. */
export function clavesDelEntorno(): ClavesVapid | null {
  const publica = process.env.VAPID_PUBLIC_KEY?.trim();
  const privada = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publica || !privada) return null;
  return {
    publica,
    privada,
    sujeto: process.env.VAPID_SUBJECT?.trim() || "https://app.deltataempanadas.com.ar",
  };
}
