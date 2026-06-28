-- Create remitos (Pickup Receipts for Castillo) table
CREATE TABLE IF NOT EXISTS remitos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  num INTEGER NOT NULL UNIQUE,
  orden_id UUID NOT NULL,
  orden_num INTEGER NOT NULL,
  cli TEXT NOT NULL,
  fecha TEXT NOT NULL,
  lineas JSONB DEFAULT '[]'::jsonb,
  enviado BOOLEAN DEFAULT FALSE,
  fecha_envio TEXT,
  total DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS remitos_orden_id_idx ON remitos(orden_id);
CREATE INDEX IF NOT EXISTS remitos_cli_idx ON remitos(cli);
CREATE INDEX IF NOT EXISTS remitos_enviado_idx ON remitos(enviado);
CREATE INDEX IF NOT EXISTS remitos_fecha_idx ON remitos(fecha);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_remitos_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS remitos_update_timestamp ON remitos;
CREATE TRIGGER remitos_update_timestamp
  BEFORE UPDATE ON remitos
  FOR EACH ROW
  EXECUTE FUNCTION update_remitos_timestamp();
