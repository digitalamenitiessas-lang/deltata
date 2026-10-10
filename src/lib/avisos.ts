import { supabaseAdmin } from "./supabase-server";
import { formatARS, formatARSSigned } from "./money";
import {
  clavesDelEntorno,
  enviarPush,
  type ClavesVapid,
  type Suscripcion,
} from "./webpush";

/**
 * Avisos push al dueño.
 *
 * Criterio: sólo lo que el dueño querría saber aunque no esté mirando, y que
 * hizo OTRA persona. Una venta común no avisa (serían cien por noche); un
 * cierre de caja, una merma o una venta que el servidor marcó, sí. Lo que
 * hace el propio dueño tampoco le avisa a él.
 */

export interface Aviso {
  titulo: string;
  cuerpo: string;
  /** a dónde lleva tocar el aviso */
  url: string;
  /** avisos con la misma etiqueta se reemplazan en vez de apilarse */
  tag?: string;
}

const hora = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Catamarca",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * La app vende sin señal: una merma de las 21:40 puede llegar al servidor a
 * las 23:00. En ese caso el aviso dice a qué hora pasó, no a qué hora llegó.
 */
function cuando(p: Record<string, unknown>): string {
  const iso = [p.closed_at, p.opened_at, p.moved_at, p.counted_at, p.spent_at, p.sold_at]
    .find((v) => typeof v === "string") as string | undefined;
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || Date.now() - t < 5 * 60 * 1000) return "";
  return ` · a las ${hora.format(t)}`;
}

const num = (v: unknown): number | null =>
  v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/** El aviso que corresponde a una operación ya guardada, o null. */
export function avisoPara(
  kind: string,
  p: Record<string, unknown>,
  quien: string,
  sospecha?: string
): Aviso | null {
  const extra = cuando(p);

  switch (kind) {
    case "open_cash":
      return {
        titulo: "Se abrió la caja",
        cuerpo: `${quien} · fondo ${formatARS(num(p.opening_float) ?? 0)}${extra}`,
        url: "/caja",
        tag: `caja-${String(p.id ?? "")}`,
      };

    case "close_cash": {
      const dif = num(p.difference);
      const esperado = num(p.expected_cash);
      const contado = num(p.counted_cash);
      return {
        titulo:
          dif == null
            ? "Se cerró la caja"
            : Math.abs(dif) < 1
              ? "Caja cerrada: cuadra"
              : `Caja cerrada con diferencia de ${formatARSSigned(dif)}`,
        cuerpo:
          `${quien}` +
          (esperado != null && contado != null
            ? ` · esperado ${formatARS(esperado)}, contado ${formatARS(contado)}`
            : "") +
          (sospecha ? ` · ⚠ ${sospecha}` : "") +
          extra,
        url: sospecha ? "/auditoria" : "/caja",
        tag: `caja-${String(p.id ?? "")}`,
      };
    }

    case "expense":
      return {
        titulo: sospecha
          ? `Gasto para revisar: ${formatARS(num(p.amount) ?? 0)}`
          : `Gasto de ${formatARS(num(p.amount) ?? 0)}`,
        cuerpo: `${quien}: ${String(p.description ?? "sin detalle")}${sospecha ? ` · ${sospecha}` : ""}${extra}`,
        url: sospecha ? "/auditoria" : "/gastos",
      };

    case "transfer_stock":
      return {
        titulo: `Traslado de ${Math.abs(num(p.qty) ?? 0)} unidades`,
        cuerpo: `${quien}: de ${String(p.desde_nombre ?? "?")} a ${String(p.hacia_nombre ?? "?")}${extra}`,
        url: "/stock/movimientos",
      };

    case "stock_move":
      if (p.type !== "merma") return null;
      return {
        titulo: `Merma de ${Math.abs(num(p.qty) ?? 0)} unidades`,
        cuerpo: `${quien}: ${String(p.reason ?? "sin motivo")}${extra}`,
        url: "/auditoria",
      };

    case "stock_count": {
      const dif = num(p.diff);
      if (dif == null || dif === 0) return null;
      return {
        titulo: `Conteo con diferencia de ${dif > 0 ? "+" : ""}${dif} unidades`,
        cuerpo: `${quien} · sistema ${num(p.system_qty) ?? "?"}, contado ${num(p.counted_qty) ?? "?"}${extra}`,
        url: "/stock",
      };
    }

    case "sale":
      if (!sospecha) return null;
      return {
        titulo: "Venta para revisar",
        cuerpo: `${quien} · ${formatARS(num(p.total) ?? 0)} · ${sospecha}${extra}`,
        url: "/auditoria",
      };

    default:
      return null;
  }
}

/** Si llegan muchos juntos (una tanda offline), va uno solo que los resume. */
function resumir(avisos: Aviso[]): Aviso[] {
  if (avisos.length <= 3) return avisos;
  return [
    {
      titulo: `${avisos.length} movimientos nuevos`,
      cuerpo: `${avisos
        .slice(0, 2)
        .map((a) => a.titulo)
        .join(" · ")} y ${avisos.length - 2} más`,
      url: "/auditoria",
      tag: "resumen",
    },
  ];
}

export interface FilaSuscripcion extends Suscripcion {
  user_id: string;
  fallos: number;
}

/**
 * Un 404/410 del servicio de push quiere decir "esta suscripción ya no
 * existe", pero en las pruebas Google lo devolvió de pasada para una que
 * estaba viva. Borrarla por eso dejaría al dueño sin avisos creyendo que los
 * tiene (su celular sigue diciendo "activas"). Se borra recién al tercer
 * rechazo seguido: una muerta de verdad sólo cuesta dos intentos de más.
 */
const RECHAZOS_ANTES_DE_BORRAR = 3;

async function entregar(
  filas: FilaSuscripcion[],
  avisos: Aviso[],
  claves: ClavesVapid
): Promise<{ ok: number; borradas: number; errores: number }> {
  const supabase = supabaseAdmin();
  const cuenta = { ok: 0, borradas: 0, errores: 0 };

  await Promise.all(
    filas.map(async (fila) => {
      let alguno = false;
      let vencida = false;
      for (const aviso of avisos) {
        const { resultado } = await enviarPush(fila, aviso, claves, {
          urgencia: "high",
          tema: aviso.tag,
        });
        if (resultado === "ok") alguno = true;
        if (resultado === "vencida") {
          vencida = true;
          break;
        }
      }

      if (alguno && !vencida) {
        cuenta.ok++;
        await supabase
          .from("push_suscripciones")
          .update({ ultimo_envio: new Date().toISOString(), fallos: 0 })
          .eq("endpoint", fila.endpoint);
        return;
      }
      const fallos = fila.fallos + 1;
      if (vencida && fallos >= RECHAZOS_ANTES_DE_BORRAR) {
        cuenta.borradas++;
        await supabase.from("push_suscripciones").delete().eq("endpoint", fila.endpoint);
      } else {
        cuenta.errores++;
        await supabase
          .from("push_suscripciones")
          .update({ fallos })
          .eq("endpoint", fila.endpoint);
      }
    })
  );
  return cuenta;
}

/**
 * Manda los avisos a todos los navegadores de los dueños activos, menos los
 * de quien hizo el movimiento. Nunca lanza: un aviso que no sale no puede
 * trabar la sincronización de una venta ya cobrada.
 */
export async function avisarADuenos(avisos: Aviso[], exceptoUserId?: string): Promise<void> {
  if (avisos.length === 0) return;
  const claves = clavesDelEntorno();
  if (!claves) return;
  try {
    const supabase = supabaseAdmin();
    const { data: duenos } = await supabase
      .from("profiles")
      .select("id")
      .eq("rol", "admin")
      .eq("activo", true);
    const ids = (duenos ?? []).map((d) => d.id).filter((id) => id !== exceptoUserId);
    if (ids.length === 0) return;

    const { data: filas } = await supabase
      .from("push_suscripciones")
      .select("endpoint, p256dh, auth, user_id, fallos")
      .in("user_id", ids);
    if (!filas || filas.length === 0) return;

    await entregar(filas as FilaSuscripcion[], resumir(avisos), claves);
  } catch (e) {
    console.error("avisos push:", e instanceof Error ? e.message : e);
  }
}

/**
 * El aviso de prueba, sólo a un navegador: confirma que la cadena funciona.
 * La persona está mirando el celular esperándolo, así que si el primer
 * intento falla se reintenta una vez antes de darlo por perdido.
 */
export async function avisoDePrueba(
  fila: FilaSuscripcion,
  claves: ClavesVapid
): Promise<"ok" | "error"> {
  const aviso: Aviso = {
    titulo: "Listo: los avisos llegan acá",
    cuerpo: "Te vamos a avisar cierres de caja, mermas, gastos y ventas para revisar.",
    url: "/auditoria",
    tag: "prueba",
  };
  for (let intento = 0; intento < 2; intento++) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 1500));
    const { ok } = await entregar([{ ...fila, fallos: intento }], [aviso], claves);
    if (ok) return "ok";
  }
  return "error";
}
