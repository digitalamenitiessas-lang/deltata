-- Del Tata — Notificaciones push (2026-09-15)
--
-- El dueño no está siempre en el foodtruck. Lo que antes tenía que ir a
-- buscar a Auditoría ahora le llega al celular (o a la compu): cierres de
-- caja con su diferencia, mermas, gastos, conteos que no cuadran y ventas
-- que el servidor marcó para revisar.
--
-- Una fila por navegador que aceptó recibir avisos. Se usa Web Push estándar
-- con claves VAPID: no hay cuenta de Google ni de Apple de por medio, y el
-- mensaje viaja cifrado de punta a punta hasta el teléfono.
--
-- Igual que el resto de las tablas: RLS habilitada y sin políticas. Sólo el
-- servidor (service_role) la lee y la escribe, así nadie puede anotar el
-- celular de otro ni ver a quién le llegan los avisos.

create table if not exists push_suscripciones (
  -- La dirección del servicio de push (Google, Apple, Mozilla, Microsoft).
  -- Es única por navegador: si el mismo teléfono se vuelve a suscribir, pisa.
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  user_id uuid not null references profiles(id) on delete cascade,
  dispositivo text,
  creada_en timestamptz not null default now(),
  ultimo_envio timestamptz,
  -- Envíos fallidos seguidos. Un 404/410 borra la fila en el acto; esto es
  -- para los errores pasajeros, que no alcanzan para darla por muerta.
  fallos int not null default 0
);

create index if not exists idx_push_usuario on push_suscripciones(user_id);

alter table push_suscripciones enable row level security;

comment on table push_suscripciones is
  'Navegadores que reciben notificaciones push. Sólo la escribe el servidor.';

-- ── REINTENTOS SIN DUPLICADOS ───────────────────────────────────────────────
-- Si se corta la señal antes de la respuesta, el dispositivo reintenta la
-- tanda entera. sync_op ya no duplica las ventas; ahora /api/sync mira si la
-- operación ya está en el rastro antes de volver a registrarla (y de volver a
-- avisar). Este índice hace que esa consulta no recorra toda la tabla.
create index if not exists idx_audit_entidad on audit_log(entidad_id, accion);
