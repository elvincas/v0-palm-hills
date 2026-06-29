-- Migración: teléfonos múltiples, fax, notas de visita y tabla todos
-- Ejecutar en Supabase SQL Editor

-- 1. Teléfonos adicionales en clientes (array JSONB de {rol, num})
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefonos JSONB DEFAULT '[]';

-- 2. Fax del establecimiento
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fax TEXT;

-- 3. Notas de visita (array JSONB de {id, fecha, texto, ts})
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS notas_visita JSONB DEFAULT '[]';

-- 4. Tabla de to-dos generados desde notas de visita
CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID,
  cliente_nom TEXT,
  texto TEXT NOT NULL,
  completado BOOLEAN DEFAULT FALSE,
  completado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: mismos permisos que las demás tablas (ajustar según tu configuración)
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "todos_all" ON todos FOR ALL USING (true) WITH CHECK (true);
