"use client";

import * as React from "react";

// ── Idioma ES/EN (2026-07-27) ──
// Mismo criterio que el tema oscuro: preferencia POR DISPOSITIVO (localStorage,
// no Supabase). Diccionario plano: la CLAVE es el texto en inglés tal cual está
// escrito en el UI (el inglés es el idioma base de la app, pedido 2026-07-03) y
// el valor su traducción al español. Cobertura incremental: una clave que no
// esté en el diccionario simplemente se muestra en inglés — nunca rompe nada.
// Los textos con partes dinámicas se arman concatenando claves chicas, no con
// plantillas (ej. t("Sales goal") + " · " + mes).

export type Lang = "en" | "es";

const STORAGE_KEY = "ph_lang";

const ES: Record<string, string> = {
  // ── Navegación / tabs ──
  "Home": "Inicio",
  "Calendar": "Calendario",
  "Invoices": "Facturas",
  "Clients": "Clientes",
  "Inventory": "Inventario",
  "Orders": "Órdenes",
  "P&L": "P&L",
  "Purchases": "Compras",
  "Improvements": "Mejoras",
  "Salespeople": "Vendedores",
  "Warehouses": "Almacenes",
  "Payroll": "Nómina",
  "Users": "Usuarios",
  "Manage Users": "Usuarios",
  "Settings": "Ajustes",
  "Appearance": "Apariencia",
  "Company Profile": "Perfil de Empresa",
  "Document Templates": "Plantillas de Documentos",
  "Loading data...": "Cargando datos...",

  // ── Comunes ──
  "Save": "Guardar",
  "Cancel": "Cancelar",
  "Delete": "Eliminar",
  "Edit": "Editar",
  "Close": "Cerrar",
  "Add": "Agregar",
  "Search": "Buscar",
  "Done": "Listo",
  "All": "Todos",
  "Total": "Total",
  "View": "Ver",
  "View only": "Solo lectura",
  "days": "días",
  "items": "artículos",
  "Show": "Mostrar",
  "Hide": "Ocultar",

  // ── Home / widgets ──
  "Sales goal": "Meta de ventas",
  "Change": "Cambiar",
  "+ Set goal": "+ Fijar meta",
  "Goal reached!": "¡Meta alcanzada!",
  "Almost there!": "¡Ya casi!",
  "On track": "En camino",
  "Getting started": "Arrancando",
  "Remaining": "Faltan",
  "of": "de",
  'Tap "+ Set goal" for your target': 'Toca "+ Fijar meta" para tu objetivo',
  "Target amount ($)": "Monto objetivo ($)",
  "Save goal": "Guardar meta",
  "Sales this month": "Ventas del mes",
  "Low stock": "Stock bajo",
  "To-do": "Pendientes",
  "pending": "pendientes",
  "Recent activity": "Actividad reciente",
  "No activity": "Sin actividad",
  "Top Products": "Top Productos",
  "Top Clients": "Top Clientes",
  "Last 3 months · by revenue": "Últimos 3 meses · por venta",
  "Last 6 months · volume + payment (30-day terms)": "Últimos 6 meses · volumen + pago (crédito 30 días)",
  "No invoices yet": "Aún no hay facturas",
  "Not enough invoice data yet.": "Aún no hay suficientes facturas.",
  "Product": "Producto",
  "Qty": "Cant.",
  "Revenue": "Venta",
  "Client": "Cliente",
  "Score": "Puntaje",
  "Volume": "Volumen",
  "Remitos pending to send": "Remitos pendientes por enviar",
  "Key metrics": "Métricas clave",
  "Pays COD ⚡": "Paga contra entrega ⚡",
  "No payments yet": "Sin pagos aún",
  "Pays in ~": "Paga en ~",
  "paid": "pagado",
  "No pending remitos": "Sin remitos pendientes",
  "Edit email": "Editar correo",
  "Set email": "Fijar correo",
  "Send to:": "Enviar a:",
  "View Remito": "Ver Remito",
  "Sent": "Enviado",
  "Confirm this remito was sent?": "¿Confirmas que este remito ya se envió?",
  "more": "más",

  // ── Widget editor ──
  "Edit widgets": "Editar widgets",
  "Done editing": "Terminar edición",
  "Hidden widgets": "Widgets ocultos",
  "Move up": "Subir",
  "Move down": "Bajar",
  "Add widget": "Agregar widget",

  // ── Daily Briefing ──
  "Good morning": "Buenos días",
  "Good afternoon": "Buenas tardes",
  "Good evening": "Buenas noches",
  "things need you today": "cosas requieren tu atención hoy",
  "thing needs you today": "cosa requiere tu atención hoy",
  "All clear for today": "Todo en orden por hoy",
  "deliveries today": "entregas hoy",
  "delivery today": "entrega hoy",
  "invoices overdue 30+ days": "facturas vencidas 30+ días",
  "invoice overdue 30+ days": "factura vencida 30+ días",
  "oldest": "la más vieja",
  "products below minimum": "productos bajo mínimo",
  "product below minimum": "producto bajo mínimo",
  "visits today": "visitas hoy",
  "visit today": "visita hoy",
  "Sales today": "Ventas de hoy",
  "Outstanding": "Por cobrar",
  "Collect": "Cobrar",
  "Reorder": "Reordenar",
  "Route": "Ruta",
  "Daily Briefing": "Resumen del Día",

  // ── Collections ──
  "Collections": "Cobranza",
  "outstanding": "por cobrar",
  "clients": "clientes",
  "client": "cliente",
  "overdue": "vencidas",
  "current": "al día",
  "Remind": "Recordar",
  "Promise": "Promesa",
  "Promised": "Prometido",
  "No pending balances": "Sin saldos pendientes",
  "Aging report": "Reporte de antigüedad",
  "Payment promise date:": "Fecha prometida de pago:",
  "Promise saved to calendar": "Promesa guardada en el calendario",
  "This client has no phone number saved": "Este cliente no tiene teléfono guardado",
  "Hello": "Hola",
  "friendly reminder from": "recordatorio amistoso de",
  "your pending balance is": "su saldo pendiente es",
  "Invoices:": "Facturas:",
  "Thank you!": "¡Gracias!",

  // ── Today's Route ──
  "Today's Route": "Ruta de Hoy",
  "stops": "paradas",
  "stop": "parada",
  "No visits scheduled today": "Sin visitas programadas hoy",
  "Deliver": "Entregar",
  "Take order": "Tomar pedido",
  "Visit": "Visita",
  "Check in": "Registrar visita",
  "Visited": "Visitado",
  "Map": "Mapa",
  "Note": "Nota",

  // ── Smart Reorder ──
  "Suggested Purchase": "Compra Sugerida",
  "Based on minimums + 30-day sales": "Según mínimos + ventas de 30 días",
  "Stock": "Stock",
  "Buy": "Comprar",
  "Share order": "Compartir pedido",
  "No products need reordering": "Ningún producto necesita reorden",
  "Order copied — paste it to your supplier": "Pedido copiado — pégaselo a tu proveedor",
  "sells": "vende",
  "/mo": "/mes",
  "left": "quedan",
  "min": "mín",
  "Purchase order": "Pedido de compra",
  "suggested by sales & minimums": "sugerido por ventas y mínimos",

  // ── Payroll ──
  "Employees": "Empleados",
  "Add employee": "Agregar empleado",
  "Employee": "Empleado",
  "Name": "Nombre",
  "Position": "Puesto",
  "Pay type": "Tipo de pago",
  "Hourly": "Por hora",
  "Salary": "Salario",
  "Commission": "Comisión",
  "Rate": "Tarifa",
  "per hour": "por hora",
  "Deductions": "Deducciones",
  "Period": "Período",
  "Weekly": "Semanal",
  "Biweekly": "Quincenal",
  "Monthly": "Mensual",
  "Active": "Activo",
  "Inactive": "Inactivo",
  "Run payroll": "Pagar nómina",
  "Pay period": "Período de pago",
  "From": "Desde",
  "To": "Hasta",
  "Hours": "Horas",
  "Amount": "Monto",
  "Total payroll": "Total nómina",
  "History": "Historial",
  "No payroll payments yet": "Aún no hay pagos de nómina",
  "Delete this employee?": "¿Eliminar este empleado?",
  "Each payment is saved as a 'Payroll' expense in the P&L": "Cada pago se registra como gasto 'Payroll' en el P&L",
  "For sales commissions see the Salespeople report": "Para comisiones de venta usa el reporte de Vendedores",
  "Payroll registered": "Nómina registrada",
  "This year": "Este año",

  // ── Tax Package ──
  "Tax Package": "Paquete de Impuestos",
  "For your accountant": "Para tu contador",
  "Quarter": "Trimestre",
  "Year": "Año",
  "Revenue (invoiced)": "Ingresos (facturado)",
  "Cost of goods sold": "Costo de mercancía (COGS)",
  "Gross profit": "Utilidad bruta",
  "Sales commissions": "Comisiones de venta",
  "Operating expenses": "Gastos operativos",
  "Net income": "Utilidad neta",
  "Cash collected": "Cobrado en caja",
  "Inventory purchases": "Compras de inventario",
  "Expenses paid": "Gastos pagados",
  "Net cash flow": "Flujo de caja neto",
  "Export Excel": "Exportar Excel",
  "Income Statement": "Estado de Resultados",
  "Cash Flow": "Flujo de Caja",
  "Expenses detail": "Detalle de gastos",
  "Category": "Categoría",
  "Description": "Descripción",
  "Date": "Fecha",
  "Paid": "Pagado",
  "Pending": "Pendiente",

  // ── Appearance / idioma ──
  "Choose how the app looks on this device.": "Elige cómo se ve la app en este dispositivo.",
  "Light": "Claro",
  "Dark": "Oscuro",
  "The current look": "El aspecto actual",
  "Dark background, neon green accent": "Fondo oscuro, acento verde neón",
  "Language": "Idioma",
  "English": "English",
  "Spanish": "Español",
  "Applies to the app on this device only.": "Aplica solo a la app en este dispositivo.",
};

// Suscriptores para re-render inmediato de todos los componentes que usan
// useLang() al cambiar el idioma (mismo enfoque de evento propio que otras
// preferencias de dispositivo del proyecto).
let listeners: Array<() => void> = [];

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    return (localStorage.getItem(STORAGE_KEY) as Lang | null) || "en";
  } catch {
    return "en";
  }
}

function setLangGlobal(l: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch { /* storage no disponible */ }
  for (const fn of listeners) fn();
}

export function useLang() {
  const [lang, setLangState] = React.useState<Lang>("en");

  React.useLayoutEffect(() => {
    setLangState(getLang());
    const fn = () => setLangState(getLang());
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((f) => f !== fn);
    };
  }, []);

  const setLang = React.useCallback((l: Lang) => setLangGlobal(l), []);

  const t = React.useCallback(
    (s: string) => (lang === "es" ? ES[s] || s : s),
    [lang]
  );

  return { lang, setLang, t };
}
