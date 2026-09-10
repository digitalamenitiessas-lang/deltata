-- Del Tata — Usuarios, roles y auditoría (2026-08-04)
-- Hasta acá cualquiera con la URL podía escribir. Ahora toda operación exige
-- sesión y queda firmada por su autor.

-- ── PERFILES ────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nombre text not null,
  rol text not null default 'atiende' check (rol in ('admin', 'atiende')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Cada uno lee su propio perfil; el admin lee todos.
create policy "perfil propio" on profiles
  for select using (auth.uid() = id);

create or replace function es_admin(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = uid and rol = 'admin' and activo
  );
$$;

create policy "admin ve todos los perfiles" on profiles
  for select using (es_admin(auth.uid()));

-- ── AUDITORÍA ───────────────────────────────────────────────────────────────
-- Append-only: nadie edita ni borra. Es el rastro que mira el dueño.
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  ocurrido_en timestamptz not null,
  registrado_en timestamptz not null default now(),
  user_id uuid references auth.users(id),
  user_email text,
  accion text not null,
  entidad text not null,
  entidad_id text,
  resumen text not null,
  monto numeric,
  unidades numeric,
  datos jsonb,
  dispositivo text
);

create index if not exists idx_audit_fecha on audit_log(ocurrido_en desc);
create index if not exists idx_audit_user on audit_log(user_id, ocurrido_en desc);
create index if not exists idx_audit_accion on audit_log(accion, ocurrido_en desc);

alter table audit_log enable row level security;

-- Sólo el admin puede leer la auditoría. Nadie puede modificarla.
create policy "solo admin lee auditoria" on audit_log
  for select using (es_admin(auth.uid()));

-- ── AUTORÍA EN LAS TABLAS OPERATIVAS ────────────────────────────────────────
alter table sales             add column if not exists user_id uuid references auth.users(id);
alter table cash_sessions     add column if not exists opened_by_id uuid references auth.users(id);
alter table cash_sessions     add column if not exists closed_by_id uuid references auth.users(id);
alter table expenses          add column if not exists user_id uuid references auth.users(id);
alter table stock_movements   add column if not exists user_id uuid references auth.users(id);
alter table stock_counts      add column if not exists user_id uuid references auth.users(id);
alter table account_movements add column if not exists user_id uuid references auth.users(id);
alter table products          add column if not exists updated_by uuid references auth.users(id);

-- ── REGISTRO DE AUDITORÍA ───────────────────────────────────────────────────
create or replace function log_audit(
  p_user_id uuid,
  p_email text,
  p_accion text,
  p_entidad text,
  p_entidad_id text,
  p_resumen text,
  p_ocurrido timestamptz,
  p_monto numeric default null,
  p_unidades numeric default null,
  p_datos jsonb default null,
  p_dispositivo text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (
    ocurrido_en, user_id, user_email, accion, entidad, entidad_id,
    resumen, monto, unidades, datos, dispositivo
  ) values (
    coalesce(p_ocurrido, now()), p_user_id, p_email, p_accion, p_entidad,
    p_entidad_id, p_resumen, p_monto, p_unidades, p_datos, p_dispositivo
  );
end $$;

-- ── CAMBIOS DE PRECIO Y COSTO: se auditan solos ─────────────────────────────
-- Es la maniobra más fácil de esconder, así que la registra la base, no la app.
create or replace function audit_producto() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select email into v_email from profiles where id = new.updated_by;

  if new.unit_price is distinct from old.unit_price then
    perform log_audit(new.updated_by, v_email, 'cambio_precio', 'products', new.id::text,
      format('%s: precio %s → %s', new.name, old.unit_price, new.unit_price),
      now(), new.unit_price, null,
      jsonb_build_object('antes', old.unit_price, 'despues', new.unit_price), null);
  end if;

  if new.cost_per_unit is distinct from old.cost_per_unit then
    perform log_audit(new.updated_by, v_email, 'cambio_costo', 'products', new.id::text,
      format('%s: costo %s → %s', new.name,
             coalesce(old.cost_per_unit::text,'sin cargar'),
             coalesce(new.cost_per_unit::text,'sin cargar')),
      now(), new.cost_per_unit, null,
      jsonb_build_object('antes', old.cost_per_unit, 'despues', new.cost_per_unit), null);
  end if;

  if new.is_active is distinct from old.is_active then
    perform log_audit(new.updated_by, v_email,
      case when new.is_active then 'alta_producto' else 'baja_producto' end,
      'products', new.id::text,
      format('%s %s', new.name, case when new.is_active then 'reactivado' else 'dado de baja' end),
      now(), null, null, null, null);
  end if;

  return new;
end $$;

drop trigger if exists trg_audit_producto on products;
create trigger trg_audit_producto after update on products
for each row execute function audit_producto();
