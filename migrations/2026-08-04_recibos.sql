-- Recibos de pago (2026-08-04)
-- El pago ya se registraba dentro de facturas.pagos (jsonb); esto agrega el
-- DOCUMENTO que el cliente se lleva, con numeracion propia desde 7001.
--
-- `lineas` es un array desde el dia uno aunque hoy la UI escriba una sola
-- entrada: asi el recibo multi-factura (un cobro de $500 que salda 3 facturas)
-- no necesita volver a tocar el esquema.
--
-- `pendientes`/`total_pendiente` son un SNAPSHOT del estado de cuenta al
-- momento de emitir: un documento entregado no puede cambiar despues porque el
-- cliente pago otra factura. Reimprimir un recibo viejo da el mismo papel.

create table if not exists public.recibos (
  id uuid primary key default gen_random_uuid(),
  num integer not null,
  cli text not null,
  cliente_id uuid references public.clientes(id) on delete set null,
  fecha date not null,
  monto numeric not null default 0,
  metodo text,
  nota text,
  -- [{factura_id, factura_num, fecha, balance_antes, aplicado}]
  lineas jsonb not null default '[]'::jsonb,
  -- [{num, fecha, saldo}] — facturas que siguen abiertas tras este pago
  pendientes jsonb not null default '[]'::jsonb,
  total_pendiente numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists recibos_num_idx on public.recibos (num desc);
create index if not exists recibos_cli_idx on public.recibos (cli);

alter table public.recibos enable row level security;

-- OJO (ver CLAUDE.md, incidente 2026-07-24): tiene que existir al menos una
-- policy PERMISSIVE por comando o Postgres deniega todo, incluido al admin.
-- Mismo patron permisivo que facturas/remitos: el recibo se emite en el mismo
-- flujo que registrar el pago, no esta restringido a admin.
drop policy if exists recibos_select_authenticated on public.recibos;
drop policy if exists recibos_insert_authenticated on public.recibos;
drop policy if exists recibos_update_authenticated on public.recibos;
drop policy if exists recibos_delete_authenticated on public.recibos;

create policy recibos_select_authenticated on public.recibos
  for select to authenticated using (true);
create policy recibos_insert_authenticated on public.recibos
  for insert to authenticated with check (true);
create policy recibos_update_authenticated on public.recibos
  for update to authenticated using (true) with check (true);
create policy recibos_delete_authenticated on public.recibos
  for delete to authenticated using (true);

-- Mensaje al cliente del recibo (Document Templates), igual que los otros 5 docs
alter table public.empresa add column if not exists mensaje_recibo text;
