# Configuración de Backups Automáticos Horarios

## Paso 1: Desplegar la Edge Function

Ve a tu proyecto Supabase y ejecuta:

```bash
supabase functions deploy backup-database
```

O desde el panel de Supabase: Functions → Create Function → `backup-database`

## Paso 2: Configurar Variables de Entorno

En el panel de Supabase → Settings → Edge Functions secrets, agrega:
- `SUPABASE_URL`: Tu URL de Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: Tu clave de servicio
- `DATABASE_URL`: Tu URL de base de datos PostgreSQL

## Paso 3: Crear Trigger Horario (Cron)

Ve a Database → Extensions y habilita `pg_cron` si no está habilitado.

Luego ejecuta esta query en el SQL Editor:

```sql
-- Crear tabla para tracking de backups
CREATE TABLE IF NOT EXISTS backup_logs (
  id SERIAL PRIMARY KEY,
  executed_at TIMESTAMP DEFAULT NOW(),
  status TEXT,
  filename TEXT,
  error_message TEXT
);

-- Crear función que llama a la Edge Function
CREATE OR REPLACE FUNCTION trigger_backup()
RETURNS void AS $$
BEGIN
  -- Llamar a la Edge Function (requiere acceso a la URL pública)
  PERFORM http_post(
    'https://<tu-project>.supabase.co/functions/v1/backup-database',
    '{}'::jsonb,
    'Bearer <tu-service-role-key>'
  );
END;
$$ LANGUAGE plpgsql;

-- Habilitar extensión http si no está
CREATE EXTENSION IF NOT EXISTS http;

-- Crear job cron que se ejecute cada hora
SELECT cron.schedule('backup_hourly', '0 * * * *', 'SELECT trigger_backup()');
```

## Paso 4: Verificar Backups

Los backups se guardarán en Storage → backups/

Cada backup tendrá un nombre como: `backup_2024-01-15_09-30.sql`

## Paso 5: Recuperar un Backup (si es necesario)

Para restaurar desde un backup:

```bash
# Descargar el backup desde Supabase Storage
supabase storage download backups/backup_FECHA.sql

# Restaurar a tu base de datos
psql $DATABASE_URL < backup_FECHA.sql
```

## Notas Importantes

- ✅ Los backups se ejecutan cada hora
- ✅ Solo se mantienen los últimos 7 días (ahorra espacio)
- ✅ Cada backup es un archivo SQL completo
- ✅ Puedes descargar cualquier backup desde el panel de Supabase
- ⚠️ Requiere que `pg_cron` esté habilitado
- ⚠️ Primeros 7 días son gratis, luego según tu plan de Supabase

## Alternativa: Usar pg_dump directamente

Si prefieres un backup local en tu máquina, ejecuta esto cada hora:

```bash
pg_dump $DATABASE_URL --format=plain | gzip > backups/backup_$(date +%Y%m%d_%H%M%S).sql.gz
```
