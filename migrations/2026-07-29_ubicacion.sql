-- Ubicacion del producto dentro del almacen (2026-07-29)
-- Texto libre con la nomenclatura del negocio (A-01, "Estante 3", "Pasillo B").
-- Ordena y agrupa la hoja de conteo fisico para contar caminando los estantes.
alter table productos add column if not exists ubicacion text;
