// Helper de fecha de entrega: los dias de entrega ya no son un patron
// recurrente (antes localStorage + dia de la semana), sino fechas puntuales
// marcadas a mano en el calendario (tabla eventos_calendario, tipo "delivery").
// Cada componente trae su propia lista de fechas disponibles (ya ordenadas)
// y este helper solo elige la primera que sea hoy o futura.

const toYMD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Primera fecha disponible que sea hoy o futura; si no hay ninguna, hoy.
export function proximaFechaEntrega(fechasDisponibles: string[], now: Date = new Date()): string {
  const hoy = toYMD(now);
  const futura = fechasDisponibles.find((f) => f >= hoy);
  return futura ?? hoy;
}
