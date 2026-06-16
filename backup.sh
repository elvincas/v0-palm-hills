#!/bin/bash

# Script de backup local horario
# Uso: chmod +x backup.sh && ./backup.sh

# Variables
DB_URL="${DATABASE_URL:-}"
BACKUP_DIR="./backups"
MAX_AGE_DAYS=7

# Crear directorio si no existe
mkdir -p "$BACKUP_DIR"

if [ -z "$DB_URL" ]; then
  echo "Error: DATABASE_URL no configurada"
  exit 1
fi

# Crear backup con timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"

echo "[$(date)] Iniciando backup..."

# Hacer backup con compresión
pg_dump "$DB_URL" --format=plain | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date)] ✓ Backup completado: $BACKUP_FILE ($SIZE)"
else
  echo "[$(date)] ✗ Error al crear backup"
  exit 1
fi

# Limpiar backups antiguos (más de 7 días)
echo "[$(date)] Limpiando backups antiguos..."
find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +$MAX_AGE_DAYS -delete

echo "[$(date)] Backup finalizado exitosamente"
