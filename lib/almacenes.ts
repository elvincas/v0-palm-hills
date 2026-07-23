// Almacen: generico, configurable (2026-07-23) — reemplaza el enum fijo
// "palmhills"|"castillo". `id` es el slug que ya se guarda en productos y en
// las lineas de factura/orden/compra (sin migracion de datos: los valores
// existentes YA son "palmhills"/"castillo", solo se les agrega metadata).
// `lleva_stock` decide si el almacen trackea stock en vivo (como Palm Hills)
// o es de paso/consignacion y genera remito al pickear (como Castillo).
export interface Almacen {
  id: string;
  nombre: string;
  icono: string;
  lleva_stock: boolean;
  orden: number;
  activo: boolean;
}

// Info de un almacen por su slug (con fallback seguro si no se encuentra —
// dato legacy o borrado — para que nada explote mientras `almacenes` carga
// o si un producto quedo con un slug que ya no existe).
export const almacenInfo = (almacenes: Almacen[], id?: string | null): Almacen => {
  const found = almacenes.find((a) => a.id === id);
  if (found) return found;
  return { id: id || "palmhills", nombre: id || "Warehouse", icono: "📦", lleva_stock: true, orden: 999, activo: true };
};

// El almacen "por defecto" cuando un producto/linea no tiene almacen asignado
// (antes era el string literal "palmhills" a secas): el activo con menor
// `orden`, o "palmhills" como ultimo fallback si la tabla viniera vacia.
export const almacenPrincipal = (almacenes: Almacen[]): string => {
  const activos = almacenes.filter((a) => a.activo).sort((a, b) => a.orden - b.orden);
  return activos[0]?.id || "palmhills";
};
