// Back orders (2026-11-23): una orden retenida porque falta mercancia.
//
// `ordenes.back_order` es null en una orden normal; en una retenida guarda la
// lista de productos que se estan esperando. El producto esperado puede ser una
// linea de la misma orden o uno que ni siquiera entro en ella (no habia stock
// para agregarlo): por eso se guarda aparte de `lineas`.
import { type Almacen, almacenInfo, almacenPrincipal } from "./almacenes";

export interface BackOrderItem {
  prodId: string;
  prodNom: string;
  sku?: string;
  /** Cuantas unidades quiere el cliente (informativo). */
  qty: number;
}

export const esBackOrder = (o: { estado?: string; back_order?: BackOrderItem[] | null }) =>
  !!o.back_order?.length && o.estado !== "Completed";

export interface ProductoStock {
  id: string;
  stock?: number;
  reservado?: number;
  almacen?: string;
}

export interface EstadoEspera {
  listo: boolean;
  label: string;
}

/**
 * Ya llego lo que se esperaba?
 *
 * `qtyEnOrden` es lo que la propia orden ya tiene reservado de ese producto (0
 * si no es una linea suya): esas unidades cuentan dentro de `reservado`, asi
 * que si la orden lo incluye basta con que el stock cubra las reservas.
 *
 * Devuelve null si el almacen no lleva stock (no hay nada contra que medir) o
 * si el producto ya no existe.
 */
export function estadoEspera(
  item: BackOrderItem,
  prod: ProductoStock | undefined,
  almacenes: Almacen[],
  qtyEnOrden: number,
): EstadoEspera | null {
  if (!prod) return null;
  if (!almacenInfo(almacenes, prod.almacen || almacenPrincipal(almacenes)).lleva_stock) return null;
  const libre = Number(prod.stock || 0) - Number(prod.reservado || 0);
  const paraEstaOrden = libre + qtyEnOrden;
  const necesita = qtyEnOrden > 0 ? qtyEnOrden : item.qty;
  if (paraEstaOrden >= necesita) return { listo: true, label: "✓ In stock" };
  return { listo: false, label: paraEstaOrden > 0 ? `Only ${paraEstaOrden} in stock` : "Out of stock" };
}
