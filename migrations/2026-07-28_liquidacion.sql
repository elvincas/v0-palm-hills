-- Clearance / liquidación de productos (2026-07-28)
-- Marca un producto como "en liquidación" y, opcionalmente, el precio especial
-- que se aplica al agregarlo a una orden. Alimenta el grupo "Clearance" de las
-- sugerencias en New Order y el filtro de Inventario.
alter table productos add column if not exists liquidacion boolean not null default false;
alter table productos add column if not exists precio_liquidacion numeric;
