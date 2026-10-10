// Tipos de dominio. Regla de oro: qty SIEMPRE en unidades (una docena = 12).

export type ProductKind = "empanada" | "bebida" | "otro";

/**
 * Cómo se lleva el producto. Son las mismas empanadas y el mismo stock:
 * "cocida" sale suelta del horno, "congelada" se vende por docena.
 */
export type Presentacion = "cocida" | "congelada";

export const UNIDADES_POR_DOCENA = 12;
export const UNIDADES_POR_MEDIA_DOCENA = 6;

export type PaymentMethod =
  | "efectivo"
  | "transferencia"
  | "qr"
  | "tarjeta"
  | "cuenta_corriente";

export type StockMovementType =
  | "compra"
  | "venta"
  | "merma"
  | "ajuste"
  | "produccion"
  | "conteo"
  /** mercadería que pasa de un lugar al otro (sale de uno, entra al otro) */
  | "traslado";

export interface Product {
  id: string;
  name: string;
  kind: ProductKind;
  unit_price: number;
  /** precio de la media docena (6); null = no hay ese tramo */
  half_dozen_price: number | null;
  dozen_price: number | null;
  /** precio de la docena congelada; null = ese gusto no se vende congelado */
  frozen_dozen_price: number | null;
  /** null = costo no cargado (distinto de 0) */
  cost_per_unit: number | null;
  current_qty: number;
  /** null = sin mínimo definido (distinto de 0) */
  min_qty: number | null;
  sort_order: number;
  is_active: boolean;
  /** dado de baja: no se borra nunca (otro equipo pudo venderlo sin señal) */
  archivado?: boolean;
  updated_at: string;
}

/**
 * Un lugar con mercadería propia: el local y el foodtruck tienen cada uno su
 * congelador. Contar uno no puede "borrar" lo que hay en el otro.
 */
export interface Ubicacion {
  id: string;
  nombre: string;
  activo: boolean;
  sort_order: number;
}

/** Cuánto hay de un producto en un lugar. */
export interface StockUbic {
  product_id: string;
  ubicacion_id: string;
  qty: number;
}

export interface Canal {
  id: string;
  nombre: string;
  /** recargo sobre el precio base; 0 = mismo precio que el foodtruck */
  recargo_pct: number;
  es_default: boolean;
  activo: boolean;
  sort_order: number;
  /** de qué lugar sale la mercadería que se vende por este canal */
  ubicacion_id: string | null;
}

/** Precio propio de un producto en un canal. null en un campo = usar el base. */
export interface CanalPrecio {
  canal_id: string;
  product_id: string;
  unit_price: number | null;
  half_dozen_price: number | null;
  dozen_price: number | null;
  frozen_dozen_price: number | null;
}

/**
 * Promoción que arma el dueño y después se aplica sola.
 *
 * - `combo`: N empanadas + M de una bebida a `precio_fijo` (el pedido de la
 *   reunión: "promociones con descuentos y vínculos con bebida").
 * - `porcentaje` / `monto`: descuento sobre un producto, una categoría o todo
 *   el pedido.
 *
 * La vigencia importa: el foodtruck abre jueves a la noche y de viernes a
 * domingo, así que una promo tiene que poder correr sólo esos días y sólo en
 * esa franja.
 */
export type PromoTipo = "combo" | "porcentaje" | "monto";

export interface Promo {
  id: string;
  nombre: string;
  tipo: PromoTipo;
  /** combo: cuántas empanadas entran */
  empanadas_qty: number | null;
  /** combo: qué bebida; null = cualquier bebida del pedido */
  bebida_product_id: string | null;
  bebida_qty: number | null;
  /** combo: cuánto sale todo junto */
  precio_fijo: number | null;
  /** porcentaje (0-100) o monto en pesos */
  valor: number | null;
  /** descuento acotado a un producto; null = no acota por producto */
  product_id: string | null;
  /** descuento acotado a una categoría; null = no acota por categoría */
  kind: ProductKind | null;
  /** mínimo de unidades del alcance para que se dispare */
  minimo_unidades: number | null;
  /** 0 = domingo … 6 = sábado; null = todos los días */
  dias: number[] | null;
  /** "20:00"; null = sin límite. Si hasta < desde, la franja cruza la medianoche */
  desde: string | null;
  hasta: string | null;
  /** null = todos los canales */
  canal_id: string | null;
  activo: boolean;
  sort_order: number;
}

/** Una promo efectivamente aplicada a un pedido. */
export interface PromoAplicada {
  promo_id: string;
  nombre: string;
  veces: number;
  ahorro: number;
}

export interface SaleItem {
  product_id: string;
  product_name: string;
  /** siempre en unidades: una docena congelada son 12 */
  qty: number;
  unit_price: number;
  line_total: number;
  presentacion: Presentacion;
}

export interface Sale {
  id: string;
  sold_at: string;
  cash_session_id: string;
  /** por qué canal entró la venta (foodtruck, PedidosYa, …) */
  canal_id: string | null;
  payment_method: PaymentMethod;
  customer_id: string | null;
  subtotal: number;
  /** descuento total = ahorro por docena + promos + descuento manual */
  discount: number;
  /** la parte del descuento que puso una promo automática */
  promo_discount: number;
  /** qué promos entraron, congeladas con su nombre del momento */
  promos: PromoAplicada[];
  total: number;
  cash_received: number | null;
  sold_by: string;
  note: string | null;
  items: SaleItem[];
}

export interface CashSession {
  id: string;
  /**
   * Por qué lugar se abrió. Cada canal lleva su propia caja: si la casa y el
   * foodtruck compartieran arqueo, el descuadre de uno taparía el del otro.
   * null = cajas viejas, de cuando había una sola.
   */
  canal_id: string | null;
  opened_at: string;
  opened_by: string;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  note: string | null;
  status: "abierta" | "cerrada";
  /** QR y posnet: lo del sistema contra lo que informa Mercado Pago / el posnet */
  conciliacion?: Conciliacion | null;
  /** la cerró el dueño sin contar (una caja que quedó abierta) */
  sin_arqueo?: boolean;
}

export interface ConciliacionMedio {
  sistema: number;
  informado: number;
}

export type Conciliacion = Partial<Record<"qr" | "tarjeta" | "transferencia", ConciliacionMedio>>;

export interface Expense {
  id: string;
  spent_at: string;
  category: string;
  description: string;
  amount: number;
  payment_method: PaymentMethod;
  cash_session_id: string | null;
  product_id: string | null;
  qty_purchased: number | null;
  new_cost: number | null;
  supplier: string | null;
  /** a quién se le pagó, cuando el gasto es un sueldo o un adelanto */
  empleado_id: string | null;
  created_by: string;
}

/** Quién trabaja acá. Sólo lo necesario para atribuir un sueldo. */
export interface Empleado {
  id: string;
  nombre: string;
  rol: "admin" | "atiende";
  activo: boolean;
}

/**
 * Lo que suele llevar un cliente, para poder recomendarle.
 * Sale de una vista en la base: mira TODO el histórico, no sólo lo que se
 * vendió desde este celular.
 */
export interface ClienteGusto {
  customer_id: string;
  product_id: string;
  product_name: string;
  unidades: number;
  veces: number;
  ultima_vez: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  type: StockMovementType;
  qty: number;
  reason: string | null;
  ref_id: string | null;
  balance_after: number;
  moved_at: string;
  created_by: string;
  /** en qué lugar; null = movimientos viejos (eran del foodtruck) */
  ubicacion_id?: string | null;
  /** llegó después de un conteo posterior, que ya lo había medido */
  absorbido?: boolean;
}

export interface StockCount {
  id: string;
  counted_at: string;
  product_id: string;
  system_qty: number;
  counted_qty: number;
  diff: number;
  note: string | null;
  counted_by: string;
  ubicacion_id?: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  credit_limit: number | null;
  is_active: boolean;
}

export interface AccountMovement {
  id: string;
  customer_id: string;
  type: "venta" | "pago" | "ajuste";
  /** + suma deuda, − la baja */
  amount: number;
  balance_after: number;
  sale_id: string | null;
  payment_method: PaymentMethod | null;
  /** pago en efectivo con caja abierta: afecta el arqueo de esa sesión */
  cash_session_id: string | null;
  note: string | null;
  moved_at: string;
  created_by: string;
}

export type SyncOpKind =
  | "open_cash"
  | "close_cash"
  | "sale"
  | "expense"
  | "stock_count"
  | "stock_move"
  | "upsert_customer"
  | "customer_payment"
  | "upsert_product"
  | "delete_product"
  | "upsert_canal"
  | "upsert_canal_precio"
  | "upsert_promo"
  | "delete_promo"
  | "force_close_cash"
  | "transfer_stock"
  | "upsert_pedido";

export interface OutboxOp {
  id?: number;
  kind: SyncOpKind;
  /** id de la entidad principal, para mostrar estado por entidad */
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
  tries: number;
  last_error: string | null;
  /** quién la hizo: si cambia el usuario del equipo, se ve de quién era */
  autor?: string;
}

/** Una operación que el servidor rechazó para siempre: sale de la cola. */
export interface OpRechazada {
  id?: number;
  kind: SyncOpKind;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
  rechazada_en: string;
  motivo: string;
  autor?: string;
}

export type PedidoEstado = "pendiente" | "preparando" | "listo" | "entregado" | "cancelado";

export interface PedidoLinea {
  product_id: string;
  product_name: string;
  qty: number;
  presentacion: Presentacion;
  line_total: number;
}

/**
 * Pedido para llevar o delivery. Se cobra cuando se paga (al tomarlo o al
 * entregarlo): recién ahí es una venta y descuenta stock.
 */
export interface Pedido {
  id: string;
  creado_en: string;
  creado_por: string;
  canal_id: string | null;
  cliente_nombre: string;
  telefono: string | null;
  tipo: "retira" | "delivery";
  direccion: string | null;
  /** hora prometida; null = cuanto antes */
  para_cuando: string | null;
  estado: PedidoEstado;
  /** lo pedido, con la misma clave que el carrito ("productId:presentacion") */
  cantidades: Record<string, number>;
  lineas: PedidoLinea[];
  total: number;
  nota: string | null;
  sale_id: string | null;
  pagado: boolean;
  /** reloj del último cambio: entre dos equipos gana el más nuevo */
  cambiado_en: string;
}

export const EXPENSE_CATEGORIES = [
  "mercaderia",
  "combustible",
  "gas",
  "sueldos",
  "mantenimiento",
  "otros",
] as const;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  qr: "QR / Mercado Pago",
  tarjeta: "Posnet (tarjeta)",
  cuenta_corriente: "Cuenta corriente",
};
