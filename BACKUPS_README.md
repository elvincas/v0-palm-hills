# Sistema de Backups Automáticos - Palm Hills

Tu base de datos ahora tiene **3 opciones de backup automático** cada hora:

## Opción 1: GitHub Actions (RECOMENDADO ⭐)

**Ventajas:**
- Gratuito con GitHub Free
- Automático cada hora
- Backups almacenados 7 días
- Fácil de ver el historial
- Restauración sencilla

**Configuración:**
1. Ir a tu repo GitHub
2. Settings → Secrets and variables → Actions → New repository secret
3. Agregar: `DATABASE_URL` con tu URL de Supabase
4. El workflow se ejecutará automáticamente cada hora

**Historial de backups:** Actions → Backup Horario → Artifacts

---

## Opción 2: Script Local (Para tu máquina)

**Archivo:** `backup.sh`

**Uso:**
```bash
chmod +x backup.sh
./backup.sh  # Ejecutar manualmente

# O configurar cron para ejecutar cada hora:
# 0 * * * * /ruta/a/backup.sh >> backup.log 2>&1
```

---

## Opción 3: Supabase Edge Functions

**Archivo:** `supabase/functions/backup-database/index.ts`

**Configuración:**
Ver `BACKUP_SETUP.md` para instrucciones detalladas

---

## ¿Cómo restaurar un backup?

### Desde GitHub Actions:
1. Actions → Backup Horario → Click en una ejecución
2. Descargar artifact `database-backups`
3. Ejecutar: `gunzip backup_FECHA.sql.gz && psql $DATABASE_URL < backup_FECHA.sql`

### Desde carpeta local:
```bash
gunzip backup_FECHA.sql.gz
psql $DATABASE_URL < backup_FECHA.sql
```

---

## Monitoreo

Para verificar que los backups se ejecutan correctamente:

**GitHub Actions:**
- Ve a tu repo → Actions → "Backup Horario de Base de Datos"
- Verifica que todas las ejecuciones tengan ✓ verde

**Local:**
```bash
ls -lh backups/  # Ver archivos de backup
```

---

## Políticas de Retención

- **Backups locales:** Últimos 7 días (se eliminan automáticamente)
- **GitHub Artifacts:** 7 días gratuitos
- **Edge Function:** 7 días en Supabase Storage

---

## ¿Qué pasa si algo falla?

Si no ves un backup en 24 horas:

1. **GitHub Actions:** 
   - Ve a Actions y verifica los logs
   - Revisa que `DATABASE_URL` esté configurada en Secrets

2. **Script local:**
   - Verifica que `DATABASE_URL` esté en `.env`
   - Revisa el archivo `backup.log`

3. **Supabase Edge Function:**
   - Ve a Functions y verifica los logs
   - Revisa que `pg_cron` esté habilitado

---

## Próximas mejoras

- Integración con AWS S3 para respaldos en la nube
- Notificaciones por email si falla un backup
- Panel de monitoreo de backups en la app

**¡Tus datos ahora están seguros!** 🛡️
