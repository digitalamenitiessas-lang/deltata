import type { Rol } from "@/stores/sesion";

/**
 * Ayuda contextual: el "?" de cada pantalla.
 *
 * Cada pantalla explica tres cosas, en este orden: para qué sirve, qué hacer
 * paso a paso y qué tener en cuenta. Y la ubica en el recorrido del día, para
 * que quien arranca sepa qué viene antes y qué viene después.
 *
 * El contenido depende del rol. Al empleado no se le explica cómo hacer lo que
 * no puede hacer: se le dice que eso lo hace el dueño, y por qué. Así la ayuda
 * no promete un botón que después no aparece.
 */

export type EtapaId =
  | "preparar"
  | "abrir"
  | "vender"
  | "durante"
  | "cerrar"
  | "semana"
  | "revisar";

export interface Etapa {
  id: EtapaId;
  titulo: string;
  cuando: string;
  href: string;
  soloDueno?: boolean;
}

/** El recorrido: de la puesta a punto al control, en el orden en que pasa. */
export const RECORRIDO: Etapa[] = [
  {
    id: "preparar",
    titulo: "Dejar el sistema a punto",
    cuando: "Una vez, y cada vez que cambian precios o productos",
    href: "/configuracion",
    soloDueno: true,
  },
  {
    id: "abrir",
    titulo: "Abrir la caja",
    cuando: "Al empezar el turno, en cada lugar",
    href: "/caja",
  },
  {
    id: "vender",
    titulo: "Vender",
    cuando: "Todo el turno",
    href: "/vender",
  },
  {
    id: "durante",
    titulo: "Gastos, mermas y cobros",
    cuando: "Cuando pasan, en el momento",
    href: "/gastos",
  },
  {
    id: "cerrar",
    titulo: "Cerrar la caja a ciegas",
    cuando: "Al terminar el turno",
    href: "/caja",
  },
  {
    id: "semana",
    titulo: "Mercadería y conteo",
    cuando: "Jue a sáb entra mercadería · domingo a la noche se cuenta",
    href: "/stock",
  },
  {
    id: "revisar",
    titulo: "Revisar los números",
    cuando: "Cada día y cada semana",
    href: "/control",
    soloDueno: true,
  },
];

export interface Paso {
  t: string;
  d?: string;
  /** sólo para el dueño; al empleado no se le muestra */
  soloDueno?: boolean;
  /** sólo para el empleado */
  soloEmpleado?: boolean;
}

export interface Ayuda {
  titulo: string;
  queEs: string;
  pasos: Paso[];
  ojo?: Paso[];
  etapa?: EtapaId;
  /** para el empleado, cuando la pantalla entera es del dueño */
  esDelDueno?: boolean;
  ver?: { href: string; label: string }[];
}

const AYUDAS: Record<string, Ayuda> = {
  "/vender": {
    titulo: "Vender",
    etapa: "vender",
    queEs:
      "Acá se registra cada venta. El precio lo calcula el sistema: media docena, docena y promos se aplican solas, y el stock se descuenta en el momento.",
    pasos: [
      {
        t: "Elegí el lugar",
        d: "Si hay más de un lugar activo aparecen arriba (Foodtruck, PedidosYa…). Cada uno cobra con su lista de precios y usa su propia caja.",
      },
      {
        t: "Elegí cómo se lleva",
        d: "Cocidas se venden por unidad; Congeladas, por docena. Son las mismas empanadas: cambia el precio, no el stock.",
      },
      {
        t: "¿Es un cliente conocido?",
        d: "Tocá ese botón y buscalo. Si ya vino varias veces te muestra lo que suele llevar, y con “Cargar lo de siempre” lo sumás al pedido de un toque.",
      },
      {
        t: "Armá el pedido",
        d: "Cada toque en un gusto suma una unidad (en congeladas, una docena). Con “−” restás. Mantené apretada la tarjeta para elegir una cantidad exacta.",
      },
      {
        t: "Revisá el total",
        d: "La barra verde de abajo muestra unidades, ahorro y total. “Ver pedido” abre el detalle: cómo se armó el precio, qué promo entró y si con unas pocas más conviene el tramo siguiente.",
      },
      {
        t: "Cobrá",
        d: "Tocá “Cobrar” y elegí el medio de pago. En efectivo podés escribir cuánto te dieron y te calcula el vuelto. En cuenta corriente hay que elegir el cliente.",
      },
      {
        t: "Confirmá y, si lo pide, mandale el recibo",
        d: "Aparece un aviso verde con la última venta. “Recibo” abre WhatsApp con el detalle ya escrito; el envío lo confirmás vos.",
      },
    ],
    ojo: [
      { t: "Sin caja abierta en ese lugar no se puede vender. Primero abrila desde Caja." },
      { t: "Sin internet se vende igual: la venta queda guardada en el teléfono y se sube sola cuando vuelve la señal." },
      {
        t: "Los descuentos a mano los autoriza el dueño. Los de media docena, docena y las promos se aplican solos: no hace falta hacer nada.",
        soloEmpleado: true,
      },
      {
        t: "En “Ver pedido” podés poner un descuento a mano. Queda registrado con tu nombre en Auditoría.",
        soloDueno: true,
      },
    ],
    ver: [
      { href: "/caja", label: "Caja" },
      { href: "/historial", label: "Reenviar un recibo" },
    ],
  },

  "/caja": {
    titulo: "Caja",
    etapa: "abrir",
    queEs:
      "Cada lugar (foodtruck, casa, PedidosYa) tiene su propia caja. Acá ves cuáles están abiertas, cuánto se vendió en cada una y cuánto efectivo debería haber.",
    pasos: [
      { t: "Al empezar", d: "Si la caja de tu lugar está cerrada, tocá “Abrir” en su tarjeta." },
      {
        t: "Durante el turno",
        d: "La tarjeta verde muestra lo vendido, cuántas ventas hubo y el efectivo esperado. Se actualiza sola con cada venta, gasto o cobro.",
      },
      { t: "Al terminar", d: "Tocá “Cerrar” en la tarjeta de ese lugar y seguí los dos pasos del cierre." },
      { t: "Cierres anteriores", d: "Abajo está la lista. Tocá uno para ver el detalle de ese cierre." },
    ],
    ojo: [
      {
        t: "Si aparece el aviso de cajas de otros días sin cerrar, cerralas con lo que haya y dejá una nota. Mientras sigan abiertas, sus ventas no entran en ningún arqueo.",
      },
      {
        t: "Las cajas van separadas a propósito: si compartieran arqueo, el faltante de un lugar taparía el sobrante del otro.",
      },
    ],
  },

  "/caja/abrir": {
    titulo: "Abrir la caja",
    etapa: "abrir",
    queEs:
      "Empieza el turno de un lugar. Lo que anotás acá es la base contra la que se compara el efectivo al cerrar.",
    pasos: [
      { t: "Elegí el lugar", d: "Si hay más de uno, tocá el que corresponde a esta caja." },
      {
        t: "Contá el cambio",
        d: "Contá la plata con la que arrancás y escribila en “Fondo inicial”. Si no hay cambio, dejá 0.",
      },
      { t: "Nota (opcional)", d: "Por ejemplo: “faltaban monedas”." },
      { t: "Tocá “Abrir caja”", d: "Te lleva directo a Vender." },
    ],
    ojo: [
      {
        t: "Si el fondo inicial está mal, el cierre va a dar diferencia aunque no falte nada. Contalo con cuidado.",
      },
    ],
  },

  "/caja/cerrar": {
    titulo: "Cerrar la caja",
    etapa: "cerrar",
    queEs:
      "El cierre a ciegas: primero contás el efectivo y recién después ves cuánto debería haber.",
    pasos: [
      { t: "Contá el efectivo", d: "Sacá toda la plata del cajón y contala." },
      {
        t: "Escribí lo que contaste",
        d: "Tocá “Confirmar conteo”. Todavía no ves cuánto debería haber: es a propósito.",
      },
      {
        t: "Revisá la comparación",
        d: "El sistema muestra el fondo inicial, las ventas en efectivo, los gastos, el esperado, lo contado y la diferencia. Abajo, el resto de los medios de pago del turno.",
      },
      {
        t: "Si hay diferencia grande, explicala",
        d: "Por encima del 1% del esperado (o $1.000) la nota es obligatoria.",
      },
      { t: "Tocá “Cerrar caja definitivamente”" },
    ],
    ojo: [
      {
        t: "¿Por qué a ciegas? Si ves el número antes, sin querer contás hasta llegar a él, y el conteo deja de detectar nada.",
      },
      { t: "El cierre no se puede editar después. Una corrección se registra como ajuste." },
      {
        t: "Si entre el conteo y el cierre entró una venta o un gasto, te avisa y te pide revisar: el esperado cambió.",
      },
    ],
  },

  "/caja/historial": {
    titulo: "Detalle de un cierre",
    etapa: "revisar",
    queEs:
      "Cómo cerró una caja: fondo inicial, esperado, contado, diferencia, la nota y cuánto entró por cada medio de pago.",
    pasos: [
      { t: "Mirá la diferencia", d: "Arriba de todo: si cerró exacto, con faltante o con sobrante." },
      { t: "Leé la nota", d: "Si la diferencia fue grande, ahí está la explicación de quien cerró." },
    ],
  },

  "/stock": {
    titulo: "Stock",
    etapa: "semana",
    queEs:
      "Cuánto hay de cada producto según el sistema y en qué estado está: normal, bajo, crítico, sin stock o nunca contado.",
    pasos: [
      { t: "Filtrá", d: "Por empanadas, bebidas, los críticos o los que nunca se contaron." },
      {
        t: "Tocá un producto para registrar una merma",
        d: "Lo que se quemó, se cayó o se venció. Pide la cantidad y el motivo.",
      },
      {
        t: "Entrada de mercadería",
        d: "Cuando llega mercadería (jueves a sábado), tocá el producto → “Entrada de mercadería” y cargá cuántas entraron.",
        soloDueno: true,
      },
      {
        t: "Ajustes y mínimos",
        d: "Desde el mismo producto podés ajustar el stock o cambiar el mínimo que dispara la alerta.",
        soloDueno: true,
      },
      { t: "“Contar”", d: "Abre el conteo físico a ciegas." },
      { t: "“Movimientos”", d: "Todo lo que entró y salió, con fecha y responsable." },
    ],
    ojo: [
      { t: "Cocidas y congeladas son el mismo stock: una venta de cualquiera de las dos descuenta del mismo número." },
      { t: "La merma exige motivo y queda destacada en Auditoría." },
      {
        t: "La entrada de mercadería y los ajustes los carga el dueño, porque son los números contra los que se compara el conteo.",
        soloEmpleado: true,
      },
      {
        t: "Un producto “nunca contado” no puede avisar faltantes: el sistema no sabe de qué número partir. Hacé el primer conteo.",
        soloDueno: true,
      },
    ],
    ver: [{ href: "/stock/conteo", label: "Conteo físico" }],
  },

  "/stock/conteo": {
    titulo: "Conteo físico",
    etapa: "semana",
    queEs:
      "Se cuenta lo que hay de verdad y se compara con lo que dice el sistema. Es a ciegas: no ves el número del sistema hasta confirmar el tuyo.",
    pasos: [
      { t: "Elegí el producto", d: "Andá de a uno, en el orden en que están en la heladera o el freezer." },
      { t: "Contá y escribí el número", d: "En unidades: una docena son 12." },
      {
        t: "Confirmá",
        d: "Recién ahí aparece lo que decía el sistema, la diferencia y cuánta plata representa.",
      },
      {
        t: "Si la diferencia es grande, explicala",
        d: "Desde 5 unidades de diferencia la nota es obligatoria.",
      },
    ],
    ojo: [
      { t: "Rutina: el domingo a la noche se cuenta todo." },
      {
        t: "El conteo pisa el stock del sistema con el número contado, y la diferencia queda registrada con tu nombre.",
      },
    ],
  },

  "/stock/movimientos": {
    titulo: "Movimientos de stock",
    etapa: "semana",
    queEs:
      "El libro de todo lo que entró y salió de cada producto: ventas, entradas, mermas, ajustes y conteos, con el saldo que quedó después de cada uno.",
    pasos: [
      { t: "Buscá el producto", d: "Seguí la línea de tiempo para ver cuándo empezó una diferencia." },
    ],
  },

  "/gastos": {
    titulo: "Gastos",
    etapa: "durante",
    queEs:
      "Todo lo que sale de plata: mercadería, gas, combustible, sueldos, mantenimiento.",
    pasos: [
      { t: "Tocá “Nuevo”" },
      { t: "Elegí la categoría", d: "Mercadería, combustible, gas, sueldos, mantenimiento u otros." },
      { t: "Escribí qué fue y cuánto salió" },
      {
        t: "Elegí cómo se pagó",
        d: "Si es en efectivo y hay más de una caja abierta, te pregunta de cuál salió la plata.",
      },
      {
        t: "Si es un sueldo, elegí a quién",
        d: "Así aparece en la ficha de esa persona en Empleados.",
        soloDueno: true,
      },
      {
        t: "Si es mercadería, podés cargar el stock",
        d: "Elegí el producto y cuántas unidades entraron. Si el costo por unidad cambió, decidí si se actualiza.",
        soloDueno: true,
      },
      { t: "Tocá “Registrar gasto”" },
    ],
    ojo: [
      {
        t: "Un gasto en efectivo con la caja abierta se descuenta del arqueo. Por eso al cerrar no aparece como plata faltante.",
      },
      { t: "Cada gasto queda con tu nombre en Auditoría." },
      {
        t: "El costo de los productos lo define el dueño: vos podés anotar el gasto, pero no cambiar el costo.",
        soloEmpleado: true,
      },
    ],
  },

  "/clientes": {
    titulo: "Clientes",
    etapa: "durante",
    queEs:
      "Las cuentas corrientes: quién debe, cuánto y desde cuándo. Y lo que suele llevar cada uno, para poder recomendarle.",
    pasos: [
      { t: "Buscá al cliente", d: "Tocá su nombre para ver el saldo, lo que suele llevar y el historial." },
      {
        t: "Cargá uno nuevo",
        d: "“Nuevo cliente”: nombre, teléfono (sirve para mandarle el recibo) y, si querés, un límite de crédito.",
      },
    ],
    ojo: [
      { t: "Si un cliente pasa su límite, el sistema avisa pero no frena. Fiar es una decisión de quien atiende." },
    ],
  },

  "/clientes/detalle": {
    titulo: "Ficha del cliente",
    etapa: "durante",
    queEs:
      "El saldo de su cuenta corriente, lo que suele llevar y cada venta y pago.",
    pasos: [
      {
        t: "Cuando viene a pagar",
        d: "Tocá “Registrar pago”, escribí cuánto y cómo pagó. Si es en efectivo con la caja abierta, entra en el arqueo.",
      },
      {
        t: "Para recomendarle",
        d: "“Suele llevar” muestra lo que repite, promediado por visita. Aparece recién cuando vino al menos dos veces.",
      },
    ],
    ojo: [
      {
        t: "Los ajustes de saldo (corregir una deuda) los hace el dueño. Vos registrás los pagos que te entregan.",
        soloEmpleado: true,
      },
    ],
  },

  "/historial": {
    titulo: "Historial",
    etapa: "revisar",
    queEs:
      "Lo que se registró desde este teléfono: ventas, aperturas y cierres, gastos, conteos y mermas, con hora y responsable.",
    pasos: [
      { t: "Buscá el evento", d: "Está ordenado del más nuevo al más viejo." },
      {
        t: "Reenviá un recibo",
        d: "En cada venta hay un botón de WhatsApp para mandarle el recibo al cliente, aunque haya sido hace días.",
      },
    ],
    ojo: [
      { t: "Muestra lo de este dispositivo. Lo de todos los teléfonos juntos está en Auditoría (dueño).", },
    ],
  },

  "/control": {
    titulo: "Control",
    etapa: "revisar",
    esDelDueno: true,
    queEs:
      "El resumen del día en segundos: cuánto se vendió, ticket promedio, margen y las situaciones que conviene mirar.",
    pasos: [
      { t: "Mirá los números del día", d: "Vendido, unidades, ticket promedio y margen." },
      {
        t: "Revisá el radar",
        d: "Hasta tres situaciones, las más graves primero: stock negativo o en cero, productos en el mínimo, cierres con diferencia, conteos que no cerraron, cajas de otros días abiertas. Cada una lleva a donde se resuelve.",
      },
      {
        t: "Completá “Poner en marcha”",
        d: "Mientras falten precios revisados, costos, mínimos o el primer conteo, el sistema no puede dar números confiables.",
      },
    ],
    ojo: [
      {
        t: "El margen es parcial mientras haya productos sin costo cargado. El sistema lo avisa en vez de mostrar un número inventado.",
      },
    ],
  },

  "/auditoria": {
    titulo: "Auditoría",
    etapa: "revisar",
    esDelDueno: true,
    queEs:
      "Todo lo que pasó en el sistema, desde cualquier teléfono, con quién lo hizo y cuándo. No se puede borrar ni editar.",
    pasos: [
      { t: "Filtrá", d: "Por tipo de acción o por persona." },
      {
        t: "Mirá primero lo destacado",
        d: "Mermas, ajustes, descuentos y cambios de precio: son los movimientos que pueden tapar un faltante.",
      },
      {
        t: "Ventas “a revisar”",
        d: "Si una venta declaró un descuento de promo que no se pudo verificar, aparece marcada con ⚠.",
      },
    ],
  },

  "/usuarios": {
    titulo: "Usuarios",
    etapa: "preparar",
    esDelDueno: true,
    queEs:
      "Quién puede entrar al sistema y con qué rol: dueño (todo) o empleado (vender, abrir y cerrar caja, contar, mermas, gastos y cobros).",
    pasos: [
      {
        t: "Crear un usuario",
        d: "“Nuevo”: correo, nombre, rol y contraseña (mínimo 6 caracteres). Pasale el correo y la contraseña a la persona.",
      },
      { t: "Cambiar nombre o rol", d: "Tocá la persona y editá." },
      { t: "Resetear una contraseña", d: "Desde la misma ficha. La persona entra con la nueva." },
      { t: "Dar de baja", d: "Queda sin acceso al instante, pero su historial se conserva." },
    ],
    ojo: [
      { t: "No podés sacarte tu propio rol de dueño, y siempre tiene que quedar al menos un dueño activo." },
      { t: "Todo cambio de usuario queda en Auditoría." },
    ],
  },

  "/empleados": {
    titulo: "Empleados",
    etapa: "revisar",
    esDelDueno: true,
    queEs:
      "Cuánto se le pagó a cada persona este mes y cuándo fue el último pago.",
    pasos: [
      {
        t: "Para cargar un pago",
        d: "Andá a Gastos → Nuevo → categoría Sueldos, y elegí a quién se le paga.",
      },
      { t: "Para ver el detalle", d: "Tocá la persona: aparecen todos sus pagos." },
    ],
    ojo: [
      {
        t: "No hay una planilla aparte a propósito: el pago es un gasto, así que si se paga en efectivo con la caja abierta ya descuenta del arqueo.",
      },
      { t: "Si aparece “pagos sin asignar”, son sueldos cargados sin decir a quién: no entran en ninguna ficha." },
    ],
  },

  "/configuracion": {
    titulo: "Configuración",
    etapa: "preparar",
    esDelDueno: true,
    queEs:
      "Todo lo que define cómo cobra el sistema: productos, precios, promos y lugares de venta.",
    pasos: [
      {
        t: "Productos",
        d: "Tocá uno para cambiar precio por unidad, media docena, docena, docena congelada, costo y el mínimo que dispara la alerta. “Nuevo” agrega un producto.",
      },
      {
        t: "Eliminar un producto",
        d: "Dentro de la ficha. Si nunca se vendió, se borra; si ya tiene ventas, sale del catálogo pero se conserva el histórico.",
      },
      {
        t: "Promos",
        d: "Combos (“6 empanadas + una bebida a $X”), % off o $ off. Podés limitarlas a ciertos días, a una franja horaria y a un lugar.",
      },
      {
        t: "Canales",
        d: "Los lugares de venta. Cada uno puede tener un recargo sobre el precio base o un precio propio por producto.",
      },
    ],
    ojo: [
      { t: "Un precio vacío significa “no hay ese tramo”, nunca $0." },
      {
        t: "Las promos se calculan sobre el precio que ya tiene el pedido con media docena y docena, y nunca suben el precio.",
      },
      { t: "Cada cambio de precio, promo o producto queda en Auditoría." },
    ],
  },

  "/guia": {
    titulo: "Guía",
    queEs: "La explicación completa de cada parte del sistema y del día a día.",
    pasos: [
      { t: "Leela una vez de punta a punta", d: "Después usá el “?” de cada pantalla cuando dudes." },
    ],
  },

  "/mas": {
    titulo: "Más",
    queEs: "El resto de las secciones, sincronizar a mano y cerrar sesión.",
    pasos: [
      {
        t: "Sincronizar ahora",
        d: "Normalmente se sincroniza solo. Usalo si querés forzarlo antes de cerrar sesión o de apagar el teléfono.",
      },
      {
        t: "Cerrar sesión",
        d: "Si quedan operaciones sin subir, te avisa antes. Se suben cuando alguien vuelva a entrar en ese teléfono.",
      },
      {
        t: "Instalar en el iPhone",
        d: "En Safari: Compartir → “Agregar a pantalla de inicio”. Instalada anda a pantalla completa y más rápido.",
      },
    ],
  },
};

/** La ayuda que corresponde a una ruta (las rutas con id caen en su ficha general). */
export function ayudaPara(pathname: string): Ayuda | null {
  if (AYUDAS[pathname]) return AYUDAS[pathname];
  if (pathname.startsWith("/clientes/")) return AYUDAS["/clientes/detalle"];
  if (pathname.startsWith("/caja/historial/")) return AYUDAS["/caja/historial"];
  const base = Object.keys(AYUDAS)
    .filter((k) => pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? AYUDAS[base] : null;
}

/** Filtra lo que corresponde a cada rol. */
export function paraRol<T extends Paso>(items: T[] | undefined, rol: Rol | undefined): T[] {
  const dueno = rol === "admin";
  return (items ?? []).filter((p) => (dueno ? !p.soloEmpleado : !p.soloDueno));
}

export function recorridoPara(rol: Rol | undefined): Etapa[] {
  return RECORRIDO.filter((e) => rol === "admin" || !e.soloDueno);
}
