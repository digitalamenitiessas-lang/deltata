import { NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSesion, type Sesion } from "@/lib/auth/server";
import { avisoPara, avisarADuenos, type Aviso } from "@/lib/avisos";

export const dynamic = "force-dynamic";

interface IncomingOp {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
}

/**
 * Operaciones que sólo puede ejecutar el dueño.
 * El criterio: quien maneja la plata no puede además bajar el número contra
 * el que se lo compara.
 */
const SOLO_ADMIN = new Set([
  "upsert_product",
  "delete_product",
  "upsert_canal",
  "upsert_canal_precio",
  "upsert_promo",
  "delete_promo",
]);

/**
 * Restricciones dentro de una operación que el empleado sí puede hacer.
 * Devuelve el motivo del rechazo, o null si está permitida.
 */
function vetarPorRol(
  kind: string,
  p: Record<string, unknown>,
  rol: string
): string | null {
  if (rol === "admin") return null;

  if (kind === "stock_move") {
    const tipo = String(p.type);
    if (tipo === "ajuste") {
      return "Los ajustes de stock los hace el dueño. Registrá una merma con el motivo o hacé un conteo.";
    }
    if (tipo === "compra" || tipo === "produccion") {
      return "La entrada de mercadería la carga el dueño.";
    }
    if (tipo === "merma" && !String(p.reason ?? "").trim()) {
      return "La merma necesita un motivo.";
    }
  }

  if (kind === "customer_payment" && p.type === "ajuste") {
    return "Los ajustes de cuenta corriente los hace el dueño.";
  }

  if (kind === "sale") {
    // El ahorro por tramos y el de las promos los calcula el sistema a partir
    // de reglas que definió el dueño; un descuento por encima de eso es una
    // decisión comercial que autoriza el dueño en el momento.
    const desc = Number(p.discount ?? 0);
    const porTramos = Number(p.ahorro_tramos ?? 0);
    const porPromos = Number(p.ahorro_promos ?? 0);
    if (desc - porTramos - porPromos > 0.5) {
      return "Los descuentos los autoriza el dueño.";
    }
  }

  if (kind === "expense" && p.new_cost !== "" && p.new_cost != null) {
    return "Los costos los define el dueño.";
  }

  return null;
}

interface PromoClaim {
  promo_id: string;
  nombre: string;
  veces: number;
  ahorro: number;
}

/**
 * El descuento por promo no se puede inventar.
 *
 * El precio lo calcula el dispositivo (tiene que poder vender sin señal), así
 * que el servidor no recalcula el pedido: verifica que el descuento se apoye
 * en una promo REAL y ACTIVA —que sólo el dueño puede crear— y que el pedido
 * dé para las veces que se declara.
 *
 * Qué devuelve: un motivo de rechazo, o `sospecha` cuando algo no cierra pero
 * la venta tiene que entrar igual. **Una venta ya cobrada nunca se rechaza por
 * no poder verificarla**: si la promo se borró mientras la venta esperaba
 * señal, frenar la cola no devuelve la plata, sólo esconde la venta. Se acepta
 * y se marca fuerte en la auditoría, que es donde el dueño lo va a ver.
 */
async function vetarPromos(
  supabase: ReturnType<typeof supabaseAdmin>,
  p: Record<string, unknown>
): Promise<{ error?: string; sospecha?: string }> {
  const claims = (Array.isArray(p.promos) ? p.promos : []) as PromoClaim[];
  const declarado = Number(p.ahorro_promos ?? 0);

  if (claims.length === 0) {
    return declarado > 0.5
      ? { sospecha: "descuento de promo sin promo que lo respalde" }
      : {};
  }

  const suma = claims.reduce((a, c) => a + Number(c.ahorro ?? 0), 0);
  if (Math.abs(suma - declarado) > 1) {
    return { error: "El descuento de promo no coincide con las promos aplicadas." };
  }

  const { data: promos, error } = await supabase
    .from("promos")
    .select("id, tipo, activo, valor, empanadas_qty, bebida_product_id, bebida_qty")
    .in("id", claims.map((c) => c.promo_id));
  if (error) return {}; // sin poder verificar no se bloquea una venta ya cobrada

  const porId = new Map((promos ?? []).map((x) => [x.id, x]));
  const subtotal = Number(p.subtotal ?? 0);

  // Unidades por producto y por categoría, para verificar los combos
  const items = (Array.isArray(p.items) ? p.items : []) as Record<string, unknown>[];
  const ids = [...new Set(items.map((i) => String(i.product_id)))];
  const { data: prods } = await supabase
    .from("products")
    .select("id, kind")
    .in("id", ids);
  const kindDe = new Map((prods ?? []).map((x) => [x.id, x.kind]));

  const unidadesDe = (filtro: (id: string) => boolean) =>
    items
      .filter((i) => filtro(String(i.product_id)))
      .reduce((a, i) => a + Number(i.qty ?? 0), 0);

  const sospechas: string[] = [];

  for (const c of claims) {
    const promo = porId.get(c.promo_id);
    // Carrera con un borrado, no manipulación: la venta entra marcada.
    if (!promo) {
      sospechas.push(`la promo "${c.nombre}" ya no existe`);
      continue;
    }
    if (!promo.activo) sospechas.push(`la promo "${c.nombre}" está desactivada`);

    const ahorro = Number(c.ahorro ?? 0);
    const veces = Math.max(1, Number(c.veces ?? 1));

    // Estos sí se rechazan: los números no cierran contra la promo real
    if (promo.tipo === "porcentaje") {
      const techo = (Number(promo.valor ?? 0) / 100) * subtotal + 1;
      if (ahorro > techo) {
        return { error: `La promo "${c.nombre}" descuenta de más.` };
      }
    } else if (promo.tipo === "monto") {
      if (ahorro > Number(promo.valor ?? 0) + 1) {
        return { error: `La promo "${c.nombre}" descuenta de más.` };
      }
    } else {
      // Combo: el pedido tiene que dar para las veces que se declaran
      const empanadas = unidadesDe((id) => kindDe.get(id) === "empanada");
      const bebidas = unidadesDe((id) =>
        promo.bebida_product_id
          ? id === promo.bebida_product_id
          : kindDe.get(id) === "bebida"
      );
      const necesitaEmp = Number(promo.empanadas_qty ?? 0) * veces;
      const necesitaBeb = Number(promo.bebida_qty ?? 1) * veces;
      if (empanadas < necesitaEmp || bebidas < necesitaBeb) {
        return {
          error: `La promo "${c.nombre}" se aplicó más veces de las que da el pedido.`,
        };
      }
    }
  }

  return sospechas.length > 0 ? { sospecha: sospechas.join("; ") } : {};
}

/**
 * Operaciones que nacen con un id propio y pasan una sola vez: si su id ya
 * está en el rastro, es un reintento. (Guardar un cliente no entra: editarlo
 * después reusa el mismo id y es un movimiento nuevo de verdad.)
 */
const OPERACIONES_UNICAS = new Set([
  "sale",
  "expense",
  "stock_move",
  "stock_count",
  "customer_payment",
  "open_cash",
  "close_cash",
]);

async function yaAuditada(
  supabase: ReturnType<typeof supabaseAdmin>,
  kind: string,
  accion: string,
  id: unknown
): Promise<boolean> {
  if (!OPERACIONES_UNICAS.has(kind) || id == null || id === "") return false;
  // Una venta puede entrar como "venta" y reintentarse como "venta_a_revisar"
  // (por ejemplo, si la promo se borró en el medio): es la misma venta.
  const acciones = kind === "sale" ? ["venta", "venta_a_revisar"] : [accion];
  const { data, error } = await supabase
    .from("audit_log")
    .select("id")
    .eq("entidad_id", String(id))
    .in("accion", acciones)
    .limit(1);
  // Ante la duda se registra: mejor una línea repetida que una perdida
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/** Cómo se lee cada operación en el rastro de auditoría. */
function describir(
  kind: string,
  p: Record<string, unknown>,
  sospecha?: string
): { accion: string; entidad: string; resumen: string; monto?: number; unidades?: number } | null {
  const n = (v: unknown) => (v === "" || v == null ? undefined : Number(v));
  switch (kind) {
    case "open_cash":
      return {
        accion: "apertura_caja",
        entidad: "cash_sessions",
        resumen: `Abrió la caja con un fondo de $${n(p.opening_float) ?? 0}`,
        monto: n(p.opening_float),
      };
    case "close_cash":
      return {
        accion: "cierre_caja",
        entidad: "cash_sessions",
        resumen: `Cerró la caja · esperado $${n(p.expected_cash) ?? 0}, contado $${n(p.counted_cash) ?? 0}, diferencia $${n(p.difference) ?? 0}`,
        monto: n(p.difference),
      };
    case "sale": {
      const items = Array.isArray(p.items) ? p.items : [];
      const u = items.reduce(
        (a: number, i: Record<string, unknown>) => a + Number(i.qty ?? 0),
        0
      );
      const desc = n(p.discount);
      const promos = (Array.isArray(p.promos) ? p.promos : []) as PromoClaim[];
      const conPromos =
        promos.length > 0
          ? ` [promos: ${promos.map((x) => `${x.nombre} ×${x.veces} −$${x.ahorro}`).join(", ")}]`
          : "";
      return {
        accion: sospecha ? "venta_a_revisar" : "venta",
        entidad: "sales",
        resumen:
          `Vendió ${u} unidades por $${n(p.total) ?? 0} en ${p.payment_method}${desc ? ` (descuento $${desc})` : ""}${conPromos}` +
          (sospecha ? ` ⚠ REVISAR: ${sospecha}` : ""),
        monto: n(p.total),
        unidades: u,
      };
    }
    case "expense":
      return {
        accion: "gasto",
        entidad: "expenses",
        resumen: `Registró un gasto de $${n(p.amount) ?? 0}: ${p.description}${p.qty_purchased ? ` (entraron ${n(p.qty_purchased)} unidades)` : ""}`,
        monto: n(p.amount),
        unidades: n(p.qty_purchased),
      };
    case "stock_count":
      return {
        accion: "conteo",
        entidad: "stock_counts",
        resumen: `Contó físico: sistema ${n(p.system_qty)}, contado ${n(p.counted_qty)}, diferencia ${n(p.diff)}${p.note ? ` — ${p.note}` : ""}`,
        unidades: n(p.diff),
      };
    case "stock_move": {
      const tipo = String(p.type);
      return {
        accion: tipo === "merma" ? "merma" : tipo === "compra" ? "compra" : "ajuste_stock",
        entidad: "stock_movements",
        resumen: `${tipo}: ${n(p.qty)} unidades${p.reason ? ` — ${p.reason}` : ""}`,
        unidades: n(p.qty),
      };
    }
    case "customer_payment":
      return {
        accion: p.type === "ajuste" ? "ajuste_cuenta" : "cobro_cuenta",
        entidad: "account_movements",
        resumen: `${p.type === "ajuste" ? "Ajustó" : "Cobró"} $${Math.abs(n(p.amount) ?? 0)} de cuenta corriente en ${p.payment_method}`,
        monto: n(p.amount),
      };
    case "upsert_customer":
      return {
        accion: "alta_cliente",
        entidad: "customers",
        resumen: `Guardó el cliente ${p.name}`,
      };
    // upsert_product se audita solo desde la base (trigger), para que un
    // cambio de precio quede registrado aunque venga por otra vía.
    default:
      return null;
  }
}

/**
 * Procesa el outbox del cliente EN ORDEN. Exige sesión: sin usuario válido no
 * se escribe nada. Cada operación queda firmada por su autor y deja rastro.
 * Idempotente por local_uuid: reintentar nunca duplica.
 */
export async function POST(req: Request) {
  const sesion: Sesion | null = await getSesion();
  if (!sesion) {
    return NextResponse.json(
      { error: "Sesión no válida o expirada. Volvé a entrar." },
      { status: 401 }
    );
  }

  let body: { ops?: IncomingOp[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const ops = body.ops ?? [];
  if (!Array.isArray(ops) || ops.length === 0) {
    return NextResponse.json({ results: [] });
  }
  if (ops.length > 100) {
    return NextResponse.json({ error: "Lote demasiado grande" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const dispositivo = req.headers.get("user-agent")?.slice(0, 180) ?? null;
  const results: { id: number; ok: boolean; error?: string }[] = [];
  const avisos: Aviso[] = [];

  for (const op of ops) {
    // El rol se valida acá, en el servidor: ocultar el botón no alcanza.
    if (SOLO_ADMIN.has(op.kind) && sesion.rol !== "admin") {
      results.push({
        id: op.id,
        ok: false,
        error: "Esta operación la realiza el dueño.",
      });
      break;
    }
    const veto = vetarPorRol(op.kind, op.payload, sesion.rol);
    if (veto) {
      results.push({ id: op.id, ok: false, error: veto });
      break;
    }

    // El descuento por promo tiene que apoyarse en una promo real del dueño
    let sospecha: string | undefined;
    if (op.kind === "sale") {
      const revision = await vetarPromos(supabase, op.payload);
      if (revision.error) {
        results.push({ id: op.id, ok: false, error: revision.error });
        break;
      }
      sospecha = revision.sospecha;
    }

    // La autoría la pone el servidor con la sesión, no el cliente.
    const payload = {
      ...op.payload,
      user_id: sesion.userId,
      actor_email: sesion.email,
    };

    const { error } = await supabase.rpc("sync_op", {
      p_kind: op.kind,
      p: payload,
    });
    if (error) {
      results.push({ id: op.id, ok: false, error: error.message });
      break;
    }

    const d = describir(op.kind, op.payload, sospecha);
    // Si se cortó la señal antes de la respuesta, el dispositivo reintenta la
    // tanda entera. sync_op no duplica lo que ya entró; el rastro y los
    // avisos tampoco tienen que hacerlo.
    const repetida = d != null && (await yaAuditada(supabase, op.kind, d.accion, op.payload.id));
    if (d && !repetida) {
      await supabase.rpc("log_audit", {
        p_user_id: sesion.userId,
        p_email: sesion.email,
        p_accion: d.accion,
        p_entidad: d.entidad,
        p_entidad_id: String(op.payload.id ?? ""),
        p_resumen: d.resumen,
        p_ocurrido:
          (op.payload.sold_at as string) ??
          (op.payload.spent_at as string) ??
          (op.payload.moved_at as string) ??
          (op.payload.counted_at as string) ??
          (op.payload.opened_at as string) ??
          (op.payload.closed_at as string) ??
          new Date().toISOString(),
        p_monto: d.monto ?? null,
        p_unidades: d.unidades ?? null,
        p_datos: op.payload,
        p_dispositivo: dispositivo,
      });
    }

    results.push({ id: op.id, ok: true });

    if (!repetida) {
      const aviso = avisoPara(op.kind, op.payload, sesion.nombre, sospecha);
      if (aviso) avisos.push(aviso);
    }
  }

  // Los avisos salen cuando la respuesta ya se mandó: el dispositivo no
  // espera a Google ni a Apple para vaciar su cola.
  if (avisos.length > 0) after(() => avisarADuenos(avisos, sesion.userId));

  return NextResponse.json({ results });
}
