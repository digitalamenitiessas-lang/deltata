# Del Tata — Sistema de gestión

Ventas, caja y stock del foodtruck **Del Tata — Empanadas Tucumanas**. PWA
offline-first: la venta nunca espera al servidor.

## Cómo funciona

- **Local primero**: toda operación (venta, apertura/cierre de caja, gasto,
  conteo, merma) se escribe en IndexedDB (Dexie) y se encola en un *outbox*
  dentro de la misma transacción.
- **Sincronización**: el outbox se empuja FIFO a `/api/sync`, que ejecuta el
  RPC `sync_op` en Supabase. Idempotente por UUID: reintentar jamás duplica.
- **Stock como ledger**: cada movimiento guarda `balance_after`; un trigger
  mantiene `products.current_qty` en el servidor.
- **Seguridad**: RLS habilitada sin políticas — solo el server (service role)
  escribe. La clave vive en `.env.local` / variables de Vercel, nunca en el
  cliente.

## Reglas de negocio clave (ver los MD en la carpeta padre)

- Sin caja abierta no se vende.
- Cierre de caja y conteo de stock **a ciegas**: primero lo físico, después el
  esperado. Diferencias grandes exigen nota.
- El cierre es inmutable; las correcciones son ajustes.
- `qty` siempre en unidades (la docena existe solo en la UI, como descuento).
- Costo o mínimo sin cargar se muestra como "no cargado", nunca como `$0`.

## Desarrollo

```bash
npm install
npm run dev
```

Variables en `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Migraciones SQL en `supabase/migrations/` (aplicadas al proyecto
`rjqvpbdoqozvtlgoezpt`).

## Local + foodtruck (desde 2026-10)

- **Lugares (`ubicaciones`)**: Local y Foodtruck tienen stock propio
  (`stock_ubicacion`). Cada canal dice de qué lugar sale la mercadería; cada
  equipo se ubica en un lugar (Más → "¿Dónde está este equipo?").
- **Conteos que no se pisan**: el ajuste se calcula contra el momento del
  conteo. Una venta offline anterior que llega después queda "absorbida".
- **Cola que no se traba**: una operación rechazada (rol, datos) sale a
  "rechazadas" y a la Auditoría; las ventas nunca se rechazan, se marcan.
- **Historial de todos los equipos**: `/api/historial` (incremental).
- **Pedidos** para llevar y delivery (`/pedidos`), y conciliación de QR y
  posnet al cerrar la caja.

## Pendientes conocidos

- Precios del seed son de referencia: ajustarlos en **Configuración**.
- Notificaciones push: faltan las claves VAPID en Vercel (Production).
- Lotes/vencimientos, anomalías avanzadas y capa de IA: fases siguientes del
  roadmap (los datos ya quedan registrados para alimentarlas).
