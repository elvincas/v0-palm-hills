// Logica de dias de entrega y regla de corte, compartida entre el calendario y la creacion de ordenes.
// Regla: el corte para un dia de entrega configurado es el dia anterior a las 12:00 PM.
// Ordenes creadas despues de ese corte se asignan al siguiente dia de entrega disponible.

export const DELIVERY_DAYS_KEY = "ph_delivery_days";

export const DIAS_SEMANA = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function getDeliveryDays(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DELIVERY_DAYS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setDeliveryDays(days: number[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DELIVERY_DAYS_KEY, JSON.stringify(days));
}

const toYMD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Calcula la proxima fecha de entrega valida segun los dias configurados y la regla de corte
// (dia anterior a las 12:00 PM). Si no hay dias configurados, devuelve la fecha de hoy.
export function nextDeliveryDate(deliveryDays: number[], now: Date = new Date()): string {
  if (!deliveryDays.length) return toYMD(now);
  for (let i = 0; i <= 14; i++) {
    const candidato = new Date(now);
    candidato.setHours(0, 0, 0, 0);
    candidato.setDate(now.getDate() + i);
    if (!deliveryDays.includes(candidato.getDay())) continue;
    const corte = new Date(candidato);
    corte.setDate(candidato.getDate() - 1);
    corte.setHours(12, 0, 0, 0);
    if (now <= corte) return toYMD(candidato);
  }
  return toYMD(now);
}
