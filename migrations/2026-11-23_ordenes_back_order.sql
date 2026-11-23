-- Back orders (2026-11-23): una orden retenida porque falta mercancia.
-- null = orden normal. Si no, la lista de productos que se estan esperando:
-- [{ "prodId": "...", "prodNom": "...", "sku": "...", "qty": 12 }]
alter table ordenes add column if not exists back_order jsonb;
