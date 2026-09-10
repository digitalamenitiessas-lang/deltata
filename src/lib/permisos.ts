import type { Rol } from "@/stores/sesion";

/**
 * Qué puede hacer cada rol.
 *
 * El criterio no es "confiar o no confiar": es que quien maneja la plata no
 * pueda, además, modificar el número contra el que se lo compara. Un empleado
 * puede generar obligaciones (vender: la plata tiene que aparecer) y contar a
 * ciegas, pero no puede bajar lo que se le espera.
 *
 * Todo esto se valida TAMBIÉN en el servidor. Esconder un botón no es seguridad.
 */
export type Permiso =
  // Operación diaria
  | "vender"
  | "abrir_caja"
  | "cerrar_caja"
  | "conteo_stock"
  | "registrar_merma"
  | "cobrar_cuenta"
  | "crear_cliente"
  | "registrar_gasto"
  // Lo que permite tapar un faltante
  | "ajustar_stock"
  | "ajustar_cuenta"
  | "descuento_manual"
  | "entrada_mercaderia"
  | "cambiar_costo"
  // Administración
  | "configurar_catalogo"
  | "configurar_promos"
  | "configurar_canales"
  | "gestionar_usuarios"
  | "ver_control"
  | "ver_auditoria";

const DEL_QUE_ATIENDE: Permiso[] = [
  "vender",
  "abrir_caja",
  "cerrar_caja",
  "conteo_stock",
  // La merma es necesaria (se queman, se caen) pero queda auditada y
  // destacada: exige motivo y el dueño la ve resaltada.
  "registrar_merma",
  "cobrar_cuenta",
  "crear_cliente",
  // Puede anotar un gasto operativo, pero queda marcado para revisión porque
  // un gasto inventado baja el efectivo esperado del arqueo.
  "registrar_gasto",
];

export function puede(rol: Rol | undefined, permiso: Permiso): boolean {
  if (rol === "admin") return true;
  if (rol === "atiende") return DEL_QUE_ATIENDE.includes(permiso);
  return false;
}

/** Explicación para mostrar cuando algo está bloqueado. */
export const MOTIVO_BLOQUEO: Partial<Record<Permiso, string>> = {
  ajustar_stock:
    "Los ajustes de stock los hace el dueño. Si falta mercadería, registrala como merma con el motivo o hacé un conteo.",
  ajustar_cuenta:
    "Los ajustes de cuenta corriente los hace el dueño. Podés registrar el pago que te entregan.",
  descuento_manual:
    "Los descuentos los autoriza el dueño. El precio por media docena y docena ya se aplica solo.",
  entrada_mercaderia:
    "La entrada de mercadería la carga el dueño, porque también define el costo.",
  cambiar_costo: "Los costos los define el dueño.",
  configurar_catalogo: "Los precios y el catálogo los administra el dueño.",
  configurar_promos:
    "Las promos las define el dueño. Las que están vigentes se aplican solas cuando el pedido las cumple.",
  configurar_canales: "Los canales de venta los administra el dueño.",
  gestionar_usuarios: "Los usuarios los administra el dueño.",
  ver_control: "El panel de control es del dueño.",
  ver_auditoria: "La auditoría es del dueño.",
};
