-- Versionado de fotos para que la app solo descargue fotos nuevas/cambiadas.
-- Motivo: re-descargar ~160MB de fotos base64 en cada apertura agotaba el
-- Disk IO Budget de Supabase y dejaba la base inaccesible (email 2026-07-13).
-- Aplicada en produccion el 2026-07-13 via Management API.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS foto_v integer NOT NULL DEFAULT 1;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS foto_local_v integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_foto_v() RETURNS trigger AS $fn$
BEGIN
  IF NEW.foto IS DISTINCT FROM OLD.foto THEN
    NEW.foto_v := COALESCE(OLD.foto_v, 0) + 1;
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prod_foto_v ON productos;
CREATE TRIGGER trg_prod_foto_v BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION bump_foto_v();

CREATE OR REPLACE FUNCTION bump_foto_local_v() RETURNS trigger AS $fn$
BEGIN
  IF NEW.foto_local IS DISTINCT FROM OLD.foto_local THEN
    NEW.foto_local_v := COALESCE(OLD.foto_local_v, 0) + 1;
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cli_foto_v ON clientes;
CREATE TRIGGER trg_cli_foto_v BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION bump_foto_local_v();
