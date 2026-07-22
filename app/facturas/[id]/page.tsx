"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import { Switch } from "@/components/ui/switch";

interface LineaFactura {
  prodNom: string;
  sku?: string;
  barcode?: string;
  qty: number;
  precio: number;
  precioOriginal?: number;
  precioCatalogo?: number;
  almacen?: "palmhills" | "castillo";
}

interface Pago {
  monto: number;
  fecha: string;
  nota?: string;
  metodo?: string; // Card | Bank Transfer | Zelle | Cash | Check
}

const METODOS_PAGO = ["Cash", "Zelle", "Check", "Card", "Bank Transfer"] as const;

interface Factura {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  estado: string;
  total: number;
  lineas?: LineaFactura[];
  pagos?: Pago[];
  orden_id?: string | null;
}

interface LineaOrdenRev {
  prodId: string;
  prodNom: string;
  barcode?: string;
  sku?: string;
  precio: number;
  precioFinal?: number;
  precioCatalogo?: number;
  qty: number;
  qtyEnviada?: number;
  picked?: boolean;
  almacen?: string;
}

interface Cliente {
  nom: string;
  codigo_cliente?: string;
  dir?: string;
  ciudad?: string;
  estado_dir?: string;
  tel?: string;
  email?: string;
}

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

const today = () => new Date().toISOString().split("T")[0];

// Pildoras planas estilo iOS: cada accion con su tinte suave (dorado, verde,
// azul, rojo) y la principal en verde solido.
const PILL_BASE = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full text-xs font-semibold border shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all whitespace-nowrap";
const PILL = `${PILL_BASE} bg-white text-[#4a6741] border-[#e3e7dd]`;
const PILL_SOLID = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full bg-[#4a6741] text-white text-xs font-semibold border border-[#4a6741] shadow-sm active:scale-[0.97] transition-all whitespace-nowrap";
// Botones del toolbar: todos identicos (flex-1), icono arriba y etiqueta abajo
const TAB_BTN = "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl border shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all";
const TAB_LBL = "text-[9px] font-bold leading-none truncate max-w-full px-0.5";
// Compat: usados por el modal de pago y estados de error
const GLASS_BTN = PILL;
const GLASS_BTN_PRIMARY = PILL_SOLID;

const Icon = ({ d, className }: { d: string; className?: string }) => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {d.split("|").map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const IC = {
  back: "M15 18l-6-6 6-6",
  plus: "M12 5v14|M5 12h14",
  check: "M20 6L9 17l-5-5",
  revert: "M9 14l-5-5 5-5|M4 9h10a6 6 0 0 1 0 12h-3",
  print: "M6 9V4h12v5|M6 13h12v8H6z|M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2",
  trash: "M3 6h18|M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
};

function EncabezadoFactura({ factura, cliente, page, totalPages }: { factura: Factura; cliente: Cliente | null; page?: number; totalPages?: number }) {
  return (
    <>
      <div className="px-6 sm:px-10 pt-4 pb-3 flex items-center justify-between gap-6 border-b-2 border-[#4a6741]">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Palm Hills" className="w-14 h-14 object-contain shrink-0" />
          <div>
            <div className="text-sm font-bold text-[#1a1a18] leading-tight">Palm Hills</div>
            <div className="text-[10px] text-gray-500">📞 (551) 248-3442 &nbsp;·&nbsp; ✉️ admin@palmhillsco.net</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-black tracking-wide text-[#4a6741] leading-tight">INVOICE</div>
          <div className="text-xs font-mono text-gray-600">#{String(factura.num).padStart(3, "0")}</div>
          {page !== undefined && totalPages !== undefined && (
            <div className="text-[9px] text-gray-400 mt-0.5">Page {page} of {totalPages}</div>
          )}
        </div>
      </div>
      <div className="px-6 sm:px-10 py-3 grid grid-cols-2 gap-6 bg-[#fafaf7]">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Bill to</div>
          <div className="text-xs font-bold text-[#1a1a18]">{cliente?.nom || factura.cli}</div>
          {cliente?.codigo_cliente && <div className="text-[10px] font-mono text-gray-500">#{cliente.codigo_cliente}</div>}
          {cliente?.dir && <div className="text-[10px] text-gray-600">{[cliente.dir, cliente.ciudad, cliente.estado_dir].filter(Boolean).join(", ")}</div>}
          {cliente?.tel && <div className="text-[10px] text-gray-600">📞 {cliente.tel}</div>}
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Date</div>
          <div className="text-xs font-medium text-[#1a1a18]">{fdate(factura.fecha)}</div>
          <div className="mt-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Status</div>
            {factura.estado === "Paid" ? (
              (() => {
                // Fecha y metodo del ultimo pago para mostrarlos en el documento
                const pagos = factura.pagos || [];
                const ultimo = pagos.length ? pagos.reduce((a, b) => (a.fecha >= b.fecha ? a : b)) : null;
                const metodos = Array.from(new Set(pagos.map((p) => p.metodo).filter(Boolean)));
                return (
                  <div>
                    <div className="text-xl font-black tracking-wide text-green-700 leading-tight">PAID</div>
                    {ultimo && (
                      <div className="text-[10px] font-semibold text-green-700">
                        {fdate(ultimo.fecha)}{metodos.length ? ` · ${metodos.join(" + ")}` : ""}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className={`text-xs font-bold ${factura.estado === "Partially Paid" ? "text-blue-700" : factura.estado === "Overdue" ? "text-red-600" : "text-amber-700"}`}>{factura.estado}</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}


// Fila de encabezados de columnas (data-m para el medidor de paginacion)
const FilaCols = () => (
  <tr className="text-left" data-m="cols">
    <th className="pt-4 pb-2 pl-6 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">Qty.</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">SKU</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">Description</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18] text-right">Price</th>
    <th className="pt-4 pb-2 pr-6 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18] text-right">Amount</th>
  </tr>
);

// precioComparado: el precio "de antes" a tachar. Con el switch de descuento
// de lista encendido se usa el precio de catalogo puro (revela el descuento de
// lista completo); apagado, se usa precioOriginal (solo el ajuste manual, el
// comportamiento historico donde el precio de lista se ve como precio normal).
const precioComparado = (l: LineaFactura, mostrarDescuentoLista: boolean) =>
  mostrarDescuentoLista ? l.precioCatalogo ?? l.precioOriginal : l.precioOriginal;

const FilaProducto = ({ l, i, mostrarDescuentoLista }: { l: LineaFactura; i: number; mostrarDescuentoLista: boolean }) => {
  const comparado = precioComparado(l, mostrarDescuentoLista);
  const tieneDescuento = comparado !== undefined && comparado !== l.precio;
  return (
    <tr className={i % 2 === 0 ? "bg-white" : "bg-[#e3e9da]"} data-m="row">
      <td className="py-2 pl-6 text-gray-700 text-xs">{l.qty}</td>
      <td className="py-2 text-gray-400 font-mono text-[9px]">{l.sku || "—"}</td>
      <td className="py-2 text-gray-800 text-[10px] uppercase">{l.prodNom}</td>
      <td className="py-2 text-right text-xs">
        {tieneDescuento ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-gray-400 line-through text-[11px]">{fmt(comparado!)}</span>
            <span className="text-[#4a6741] font-bold">{fmt(l.precio)}</span>
          </div>
        ) : (
          <span className="text-gray-700">{fmt(l.precio)}</span>
        )}
      </td>
      <td className="py-2 pr-6 text-right text-xs">
        {tieneDescuento ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-gray-400 line-through text-[11px]">{fmt(l.qty * comparado!)}</span>
            <span className="text-[#4a6741] font-bold">{fmt(l.qty * l.precio)}</span>
          </div>
        ) : (
          <span className="text-gray-800 font-medium">{fmt(l.qty * l.precio)}</span>
        )}
      </td>
    </tr>
  );
};

const BloqueTotales = ({ subtotal, descuento, total, totalPagado, saldo }: { subtotal: number; descuento: number; total: number; totalPagado: number; saldo: number }) => (
  <div className="px-6 pb-4" data-m="totals">
    <div className="flex justify-end mt-4">
      <div className="w-full sm:w-64">
        <div className="flex justify-between py-1.5 text-sm text-gray-600">
          <span>Subtotal</span><span>{fmt(subtotal)}</span>
        </div>
        {descuento > 0.01 && (
          <div className="flex justify-between py-1.5 text-sm text-[#4a6741] font-medium">
            <span>Discount</span><span>-{fmt(descuento)}</span>
          </div>
        )}
        <div className="flex justify-between items-center py-2.5 mt-1 border-t-2 border-[#4a6741]">
          <span className="text-base font-bold text-[#1a1a18]">Total</span>
          <span className="text-xl font-black text-[#4a6741]">{fmt(total)}</span>
        </div>
        {totalPagado > 0 && (
          <>
            <div className="flex justify-between py-1.5 text-sm text-green-700">
              <span>Paid</span><span>-{fmt(totalPagado)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-gray-200 mt-1">
              <span className="text-sm font-bold text-[#1a1a18]">Balance Due</span>
              <span className={`text-base font-black ${saldo <= 0 ? "text-green-700" : "text-amber-700"}`}>{fmt(Math.max(0, saldo))}</span>
            </div>
          </>
        )}
      </div>
    </div>
  </div>
);

const BloqueFirma = () => (
  <div data-m="firma">
    <div className="px-6 py-3 border-t border-gray-200">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mb-2">Delivery confirmation</div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div><div className="border-b border-gray-400 h-4 w-28" /><div className="text-[9px] text-gray-500 mt-0.5">Order received signature</div></div>
        <div><div className="border-b border-gray-400 h-4 w-20" /><div className="text-[9px] text-gray-500 mt-0.5">Date</div></div>
        <div><div className="border-b border-gray-400 h-4 w-40" /><div className="text-[9px] text-gray-500 mt-0.5">Name of recipient</div></div>
      </div>
    </div>
    <div className="px-6 py-6 border-t border-gray-200 text-center">
      <p className="text-sm font-semibold text-[#4a6741] tracking-wide">Thank you for your purchase!</p>
    </div>
  </div>
);

export default function FacturaPage() {
  const params = useParams();
  const router = useRouter();
  const facturaId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [factura, setFactura] = useState<Factura | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [clienteListo, setClienteListo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(false);

  const [generandoPdf, setGenerandoPdf] = useState(false);
  // Si se ve el descuento de la lista de precios (catalogo -> precio de lista)
  // ademas del ajuste manual por linea. Decidido aqui (no en el pick) porque
  // es una decision comercial de quien envia/imprime, no de quien pickea.
  // Encendido por defecto.
  const [mostrarDescuentoLista, setMostrarDescuentoLista] = useState(true);

  // Descarga el PDF y abre el share sheet nativo (con Print/Save/AirDrop).
  // En la PWA instalada, window.open muestra el PDF sin barra de opciones.
  const abrirPdf = async () => {
    if (generandoPdf || !factura) return;
    setGenerandoPdf(true);
    try {
      const res = await fetch(`/api/facturas/${facturaId}/pdf?listDiscount=${mostrarDescuentoLista ? "1" : "0"}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `Invoice-${String(factura.num).padStart(4, "0")}.pdf`, { type: "application/pdf" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        window.open(URL.createObjectURL(blob), "_blank");
      }
    } catch (err) {
      // Cancelar el share sheet lanza AbortError: no es un error real
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        alert("Could not generate the PDF: " + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setGenerandoPdf(false);
    }
  };

  // Payment form
  const [showPagoForm, setShowPagoForm] = useState(false);
  const [pagoMonto, setPagoMonto] = useState("");
  const [pagoFecha, setPagoFecha] = useState(today());
  const [pagoNota, setPagoNota] = useState("");
  const [pagoMetodo, setPagoMetodo] = useState("");
  const [pagoFull, setPagoFull] = useState(false); // abierto desde "Paid" (saldo completo)
  const [savingPago, setSavingPago] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reverting, setReverting] = useState(false);
  // Facturas viejas (previas a este cambio) no tienen precioCatalogo guardado
  // por linea: se completa buscando el producto por SKU+almacen (o nombre).
  const [catalogoPorSku, setCatalogoPorSku] = useState<Record<string, number>>({});
  const [catalogoPorNom, setCatalogoPorNom] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setReadOnly(data.user?.user_metadata?.role === "visitante");
    });
    const load = async () => {
      const { data: f, error: fErr } = await supabase
        .from("facturas")
        .select("*")
        .eq("id", facturaId)
        .single();
      if (fErr || !f) {
        setError("Couldn't load this invoice.");
        setLoading(false);
        return;
      }
      setFactura(f as Factura);
      document.title = `Invoice-${String((f as Factura).num).padStart(3, "0")}`;
      // Mostrar la factura de inmediato; los datos del cliente llegan despues
      // sin bloquear el render (antes la pantalla quedaba en "Loading...").
      setLoading(false);

      const lineasFaltantes = ((f as Factura).lineas || []).filter((l) => l.precioCatalogo === undefined);
      if (lineasFaltantes.length) {
        const skus = Array.from(new Set(lineasFaltantes.map((l) => (l.sku || "").trim()).filter(Boolean)));
        const noms = Array.from(new Set(lineasFaltantes.map((l) => l.prodNom).filter(Boolean)));
        const [porSku, porNom] = await Promise.all([
          skus.length
            ? supabase.from("productos").select("sku, nom, almacen, precio").in("sku", skus)
            : Promise.resolve({ data: [] as never[] }),
          noms.length
            ? supabase.from("productos").select("sku, nom, almacen, precio").in("nom", noms)
            : Promise.resolve({ data: [] as never[] }),
        ]);
        const prods = [...(porSku.data || []), ...(porNom.data || [])] as {
          sku: string | null; nom: string; almacen: string | null; precio: number;
        }[];
        const bySku: Record<string, number> = {};
        const byNom: Record<string, number> = {};
        for (const p of prods) {
          if (p.sku) bySku[`${p.sku.trim().toLowerCase()}|${p.almacen || "palmhills"}`] = Number(p.precio);
          byNom[p.nom] = Number(p.precio);
        }
        setCatalogoPorSku(bySku);
        setCatalogoPorNom(byNom);
      }

      const { data: c } = await supabase
        .from("clientes")
        .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel, email")
        .eq("nom", (f as Factura).cli)
        .maybeSingle();
      if (c) setCliente(c as Cliente);
      setClienteListo(true);
    };
    load();
  }, [facturaId, supabase]);

  // Ajusta stock/reservado leyendo los valores actuales de la base; nunca deja
  // negativos y omite Castillo (no lleva stock en vivo). Misma logica que el
  // DataProvider, duplicada aqui porque esta pagina no vive dentro de el.
  const ajustarInventario = async (
    cambios: { prodId: string; deltaReservado?: number; deltaStock?: number }[]
  ) => {
    const efectivos = cambios.filter(
      (c) => c.prodId && ((c.deltaReservado || 0) !== 0 || (c.deltaStock || 0) !== 0)
    );
    if (!efectivos.length) return;
    const { data } = await supabase
      .from("productos")
      .select("id, stock, reservado, almacen")
      .in("id", efectivos.map((c) => c.prodId));
    if (!data) return;
    const porId = new Map(
      (data as { id: string; stock: number; reservado: number | null; almacen: string | null }[]).map((r) => [r.id, r])
    );
    await Promise.all(
      efectivos.flatMap((c) => {
        const row = porId.get(c.prodId);
        if (!row || (row.almacen || "palmhills") === "castillo") return [];
        return [
          supabase
            .from("productos")
            .update({
              stock: Math.max(0, Number(row.stock || 0) + (c.deltaStock || 0)),
              reservado: Math.max(0, Number(row.reservado || 0) + (c.deltaReservado || 0)),
            })
            .eq("id", row.id),
        ];
      })
    );
  };

  // Revierte la factura a una orden "In Progress" con todo pickeado, lista
  // para ajustar y volver a facturar. Devuelve al stock lo enviado y vuelve a
  // reservar lo pedido; elimina remitos pendientes de esa orden y la factura.
  const handleRevert = async () => {
    if (!factura || reverting) return;
    if (
      !confirm(
        `Revert invoice #${factura.num} back to an order? The invoice will be deleted (including its payments) and the order will appear in Orders with everything picked, ready to modify.`
      )
    )
      return;
    setReverting(true);
    try {
      let reabierta = false;

      // 1) Si la factura esta ligada a su orden original, reabrirla tal cual
      if (factura.orden_id) {
        const { data: orden } = await supabase
          .from("ordenes")
          .select("*")
          .eq("id", factura.orden_id)
          .maybeSingle();
        if (orden) {
          const lineas = ((orden.lineas || []) as LineaOrdenRev[]).map((l) => ({ ...l, picked: true }));
          const { error: updErr } = await supabase
            .from("ordenes")
            .update({ estado: "In Progress", lineas })
            .eq("id", orden.id);
          if (updErr) throw new Error(updErr.message);
          await ajustarInventario(
            lineas.map((l) => ({
              prodId: l.prodId,
              deltaStock: l.qtyEnviada ?? l.qty,
              deltaReservado: l.qty,
            }))
          );
          // El remito pendiente ya no aplica: se regenera al completar de nuevo
          await supabase.from("remitos").delete().eq("orden_id", orden.id).eq("enviado", false);
          reabierta = true;
        }
      }

      // 2) Sin orden ligada (facturas antiguas): reconstruir una orden nueva
      //    desde las lineas de la factura, resolviendo productos por SKU/nombre
      if (!reabierta) {
        const lineasF = factura.lineas || [];
        if (!lineasF.length) throw new Error("This invoice has no product lines to revert.");
        const skus = Array.from(new Set(lineasF.map((l) => (l.sku || "").trim()).filter(Boolean)));
        const noms = Array.from(new Set(lineasF.map((l) => l.prodNom).filter(Boolean)));
        const [porSku, porNom] = await Promise.all([
          skus.length
            ? supabase.from("productos").select("id, nom, sku, almacen").in("sku", skus)
            : Promise.resolve({ data: [] as never[] }),
          noms.length
            ? supabase.from("productos").select("id, nom, sku, almacen").in("nom", noms)
            : Promise.resolve({ data: [] as never[] }),
        ]);
        const prods = [...(porSku.data || []), ...(porNom.data || [])] as {
          id: string; nom: string; sku: string | null; almacen: string | null;
        }[];
        const buscar = (l: LineaFactura) =>
          prods.find(
            (p) =>
              l.sku &&
              (p.sku || "").trim().toLowerCase() === l.sku.trim().toLowerCase() &&
              (p.almacen || "palmhills") === (l.almacen || "palmhills")
          ) || prods.find((p) => p.nom === l.prodNom);
        const lineasOrden: LineaOrdenRev[] = [];
        let omitidas = 0;
        for (const l of lineasF) {
          const p = buscar(l);
          if (!p) { omitidas++; continue; }
          lineasOrden.push({
            prodId: p.id,
            prodNom: l.prodNom,
            barcode: l.barcode || "",
            sku: l.sku || "",
            precio: l.precioOriginal ?? l.precio,
            precioFinal: l.precio,
            precioCatalogo: l.precioCatalogo,
            qty: l.qty,
            qtyEnviada: l.qty,
            picked: true,
            almacen: l.almacen || p.almacen || "palmhills",
          });
        }
        if (!lineasOrden.length) throw new Error("None of the invoice products exist in inventory anymore.");
        const { data: maxRow } = await supabase
          .from("ordenes")
          .select("num")
          .order("num", { ascending: false })
          .limit(1);
        const num = (maxRow && maxRow.length ? Number(maxRow[0].num) || 0 : 0) + 1;
        const total = lineasOrden.reduce((a, l) => a + l.qty * (l.precioFinal ?? l.precio), 0);
        const { error: insErr } = await supabase.from("ordenes").insert({
          num,
          cli: factura.cli,
          fecha: factura.fecha,
          estado: "In Progress",
          total: +total.toFixed(2),
          lineas: lineasOrden,
        });
        if (insErr) throw new Error(insErr.message);
        await ajustarInventario(
          lineasOrden.map((l) => ({
            prodId: l.prodId,
            deltaStock: l.qtyEnviada ?? l.qty,
            deltaReservado: l.qty,
          }))
        );
        if (omitidas > 0) {
          alert(`${omitidas} product(s) from the invoice no longer exist in inventory and were skipped.`);
        }
      }

      // 3) Eliminar la factura y volver a la pestaña de ordenes
      const { error: delErr } = await supabase.from("facturas").delete().eq("id", facturaId);
      if (delErr) throw new Error(delErr.message);
      router.push("/?tab=ord");
    } catch (err) {
      alert(`Could not revert: ${err instanceof Error ? err.message : String(err)}`);
      setReverting(false);
    }
  };

  const handleDelete = async () => {
    if (!factura) return;
    if (!confirm(`Delete invoice #${factura.num}? This cannot be undone.`)) return;
    setDeleting(true);
    const { error } = await supabase.from("facturas").delete().eq("id", facturaId);
    if (error) { alert("Error deleting invoice: " + error.message); setDeleting(false); return; }
    router.push("/?tab=fact");
  };

  // "Paid" abre el mismo menu de pago con el saldo completo precargado, para
  // especificar metodo y fecha antes de marcar.
  const abrirMarkPaid = () => {
    if (!factura) return;
    const pagado = (factura.pagos || []).reduce((acc, p) => acc + p.monto, 0);
    const restante = +(factura.total - pagado).toFixed(2);
    setPagoMonto(restante > 0 ? String(restante) : "");
    setPagoFecha(today());
    setPagoNota("");
    setPagoMetodo("");
    setPagoFull(true);
    setShowPagoForm(true);
  };

  const abrirPayment = () => {
    setPagoMonto("");
    setPagoFecha(today());
    setPagoNota("");
    setPagoMetodo("");
    setPagoFull(false);
    setShowPagoForm(true);
  };

  const handleAddPago = async () => {
    if (!factura || savingPago) return;
    const monto = parseFloat(pagoMonto);
    if (!monto || monto <= 0) { alert("Enter a valid amount"); return; }
    setSavingPago(true);
    const newPago: Pago = {
      monto,
      fecha: pagoFecha,
      nota: pagoNota || (pagoFull ? "Marked as fully paid" : undefined),
      metodo: pagoMetodo || undefined,
    };
    const newPagos = [...(factura.pagos || []), newPago];
    const totalPagado = newPagos.reduce((acc, p) => acc + p.monto, 0);
    const newEstado = totalPagado >= factura.total ? "Paid" : "Partially Paid";
    const { error } = await supabase.from("facturas").update({ pagos: newPagos, estado: newEstado }).eq("id", facturaId);
    if (error) { alert("Error: " + error.message); setSavingPago(false); return; }
    setFactura(f => f ? { ...f, pagos: newPagos, estado: newEstado } : f);
    setPagoMonto("");
    setPagoFecha(today());
    setPagoNota("");
    setPagoMetodo("");
    setPagoFull(false);
    setShowPagoForm(false);
    setSavingPago(false);
  };

  const handleDeletePago = async (idx: number) => {
    if (!factura) return;
    if (!confirm("Remove this payment?")) return;
    const newPagos = (factura.pagos || []).filter((_, i) => i !== idx);
    const totalPagado = newPagos.reduce((acc, p) => acc + p.monto, 0);
    const newEstado = totalPagado >= factura.total ? "Paid" : totalPagado > 0 ? "Partially Paid" : "Pending";
    const { error } = await supabase.from("facturas").update({ pagos: newPagos, estado: newEstado }).eq("id", facturaId);
    if (error) { alert("Error: " + error.message); return; }
    setFactura(f => f ? { ...f, pagos: newPagos, estado: newEstado } : f);
  };

  const lineasOrdenadas = useMemo(() => {
    const arr = (factura?.lineas || []).map((l) => {
      if (l.precioCatalogo !== undefined) return l;
      const key = `${(l.sku || "").trim().toLowerCase()}|${l.almacen || "palmhills"}`;
      const precioCatalogo = catalogoPorSku[key] ?? catalogoPorNom[l.prodNom];
      return precioCatalogo !== undefined ? { ...l, precioCatalogo } : l;
    });
    arr.sort((a, b) => {
      const skuA = (a.sku || "").trim();
      const skuB = (b.sku || "").trim();
      if (!skuA && skuB) return 1;
      if (skuA && !skuB) return -1;
      return skuA.localeCompare(skuB, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
    });
    return arr;
  }, [factura, catalogoPorSku, catalogoPorNom]);

  // Paginacion por MEDICION real: WebKit (iOS) no repite <thead> al imprimir,
  // asi que se corta a mano — pero midiendo la altura renderizada de cada fila
  // en un contenedor oculto al ancho de impresion, no contando filas fijas.
  // Presupuesto: hoja Letter usable (10in) — A4 es mas alta, asi que cabe igual.
  const [chunks, setChunks] = useState<LineaFactura[][] | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!factura || !clienteListo) return;
    const el = measureRef.current;
    if (!el) return;
    const h = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.offsetHeight || 0;
    const headerH = h('[data-m="header"]') + h('[data-m="cols"]');
    const totalsH = h('[data-m="totals"]');
    const firmaH = h('[data-m="firma"]');
    const rowHs = Array.from(el.querySelectorAll('[data-m="row"]')).map((r) => (r as HTMLElement).offsetHeight);
    const PAGE_H = 10 * 96 - 30; // 10in usable en Letter, menos colchon
    const budget = Math.max(200, PAGE_H - headerH);
    const out: LineaFactura[][] = [];
    let cur: LineaFactura[] = [];
    let acc = 0;
    (factura.lineas ? lineasOrdenadas : []).forEach((l, i) => {
      const rh = rowHs[i] || 36;
      if (acc + rh > budget && cur.length) { out.push(cur); cur = []; acc = 0; }
      cur.push(l);
      acc += rh;
    });
    // La ultima pagina ademas lleva totales + firma; si no caben, van solos
    // en una hoja final (con su header).
    if (acc + totalsH + firmaH > budget && cur.length) { out.push(cur); cur = []; }
    out.push(cur);
    setChunks(out);
  }, [factura, clienteListo, lineasOrdenadas]);

  // Auto-print cuando se abre desde iOS PWA con ?print=1. Espera a que los
  // datos del cliente y la paginacion esten listos.
  useEffect(() => {
    if (!loading && factura && clienteListo && chunks) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("print") === "1") {
        setTimeout(() => window.print(), 400);
      }
    }
  }, [loading, factura, clienteListo, chunks]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground text-center">Loading invoice...</div>;
  }

  if (error || !factura) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <BackButton fallback="/?tab=fact" />
      </div>
    );
  }

  const pagos = factura.pagos || [];
  const totalPagado = pagos.reduce((acc, p) => acc + p.monto, 0);
  const saldo = factura.total - totalPagado;

  const lineas = lineasOrdenadas;
  // Solo tiene sentido ofrecer el switch si al menos una linea tiene un
  // precio de catalogo distinto al precio de lista/original ya guardado —
  // si no, no hay ningun descuento de lista que revelar.
  const hayDescuentoListaDisponible = lineas.some(
    (l) => l.precioCatalogo !== undefined && l.precioOriginal !== undefined && l.precioCatalogo !== l.precioOriginal
  );
  const subtotal = lineas.reduce((acc, l) => acc + l.qty * (precioComparado(l, mostrarDescuentoLista) ?? l.precio), 0);
  const descuento = subtotal - factura.total;
  const isPaid = factura.estado === "Paid";

  return (
    <div className="min-h-screen print:min-h-0 print:h-auto bg-[#f0efe9] print:bg-transparent">
      {/* Toolbar */}
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        {/* Una sola fila simetrica: botones identicos flex-1 (icono arriba,
            etiqueta abajo) que llenan todo el ancho, estilo tab bar de iOS. */}
        <div
          className="max-w-3xl mx-auto px-4 sm:px-8 py-2.5 flex items-stretch gap-1.5"
          style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
        >
          <button onClick={() => (window.history.length > 1 ? router.back() : router.push("/?tab=fact"))} className={`${TAB_BTN} bg-white text-[#4a6741] border-[#e3e7dd]`}>
            <Icon d={IC.back} />
            <span className={TAB_LBL}>Back</span>
          </button>
          {!readOnly && !isPaid && (
            <button
              onClick={abrirPayment}
              className={`${TAB_BTN} bg-[#f5eee2] text-[#a3814e] border-[#e9dcc4]`}
            >
              <Icon d={IC.plus} />
              <span className={TAB_LBL}>Payment</span>
            </button>
          )}
          {!readOnly && !isPaid && (
            <button
              onClick={abrirMarkPaid}
              className={`${TAB_BTN} bg-green-50 text-green-700 border-green-200/70`}
            >
              <Icon d={IC.check} />
              <span className={TAB_LBL}>Paid</span>
            </button>
          )}
          {!readOnly && (
            <button
              onClick={handleRevert}
              disabled={reverting}
              title="Revert this invoice back to an order to adjust products and re-invoice"
              className={`${TAB_BTN} bg-sky-50 text-sky-700 border-sky-200/70 disabled:opacity-50`}
            >
              <Icon d={IC.revert} />
              <span className={TAB_LBL}>{reverting ? "..." : "To Order"}</span>
            </button>
          )}
          <button
            onClick={abrirPdf}
            disabled={generandoPdf}
            className={`${TAB_BTN} bg-[#4a6741] text-white border-[#4a6741] disabled:opacity-60`}
          >
            <Icon d={IC.print} />
            <span className={TAB_LBL}>{generandoPdf ? "..." : "Print"}</span>
          </button>
          {!readOnly && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`${TAB_BTN} bg-red-50 text-red-600 border-red-200/70 disabled:opacity-50`}
            >
              <Icon d={IC.trash} />
              <span className={TAB_LBL}>Delete</span>
            </button>
          )}
        </div>
        {hayDescuentoListaDisponible && (
          <div className="max-w-3xl mx-auto px-4 sm:px-8 pb-2.5 flex items-center justify-between gap-3">
            <label htmlFor="mostrar-descuento-lista" className="text-xs font-medium text-gray-600">
              Show list price as discount
            </label>
            <Switch
              id="mostrar-descuento-lista"
              checked={mostrarDescuentoLista}
              onCheckedChange={setMostrarDescuentoLista}
            />
          </div>
        )}
      </div>

      {/* Payment form modal */}
      {showPagoForm && (
        <div className="print:hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-4 pb-6">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[#1a1a18]">{pagoFull ? "Mark as Paid" : "Record Payment"}</h2>
              <button onClick={() => setShowPagoForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="text-xs text-gray-500 mb-4">
              Invoice total: <strong>{fmt(factura.total)}</strong> · Paid: <strong className="text-green-700">{fmt(totalPagado)}</strong> · Balance: <strong className="text-amber-700">{fmt(saldo)}</strong>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Payment method</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {METODOS_PAGO.map((m) => (
                    <button
                      key={m}
                      onClick={() => setPagoMetodo(pagoMetodo === m ? "" : m)}
                      className={`py-2 px-1 rounded-xl text-xs font-bold border transition-all ${
                        pagoMetodo === m
                          ? "bg-[#4a6741] text-white border-[#4a6741]"
                          : "bg-white text-gray-600 border-gray-200"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Amount ($)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={pagoMonto}
                  onChange={e => setPagoMonto(e.target.value)}
                  placeholder={fmt(saldo).replace("$", "")}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Date paid</label>
                <input
                  type="date"
                  value={pagoFecha}
                  onChange={e => setPagoFecha(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Note (optional)</label>
                <input
                  type="text"
                  value={pagoNota}
                  onChange={e => setPagoNota(e.target.value)}
                  placeholder="Reference #, details..."
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                />
              </div>
            </div>
            <div className="flex gap-2.5 mt-5">
              <button onClick={() => setShowPagoForm(false)} className={`flex-1 ${GLASS_BTN}`}>Cancel</button>
              <button
                onClick={handleAddPago}
                disabled={savingPago || !pagoMonto}
                className={`flex-1 ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
              >
                {savingPago ? "Saving..." : pagoFull ? "Mark as Paid" : "Save Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment history (screen only) */}
      {pagos.length > 0 && (
        <div className="print:hidden max-w-3xl mx-auto px-4 sm:px-8 pt-4">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Payment History</div>
              <div className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${isPaid ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                {isPaid ? "Fully Paid" : `Balance: ${fmt(saldo)}`}
              </div>
            </div>
            {pagos.map((p, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                <div>
                  <div className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                    {fmt(p.monto)}
                    {p.metodo && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#eaf0e6] text-[#4a6741]">{p.metodo}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">{fdate(p.fecha)}{p.nota ? ` · ${p.nota}` : ""}</div>
                </div>
                {!readOnly && (
                  <button onClick={() => handleDeletePago(i)} className="text-gray-300 hover:text-red-500 text-lg leading-none px-1 transition-colors">×</button>
                )}
              </div>
            ))}
            <div className="px-4 py-2.5 bg-gray-50 flex justify-between text-sm font-bold">
              <span className="text-gray-600">Total paid</span>
              <span className="text-green-700">{fmt(totalPagado)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Medidor oculto: mismo contenido al ancho de impresion mas angosto
          (A4 usable ~7.2in) para calcular cuantas filas caben por hoja. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="absolute top-0 bg-white text-sm"
        style={{ left: "-9999px", width: "7.2in", visibility: "hidden" }}
      >
        <div data-m="header"><EncabezadoFactura factura={factura} cliente={cliente} /></div>
        <table className="w-full text-sm">
          <thead><FilaCols /></thead>
          <tbody>{lineas.map((l, i) => <FilaProducto key={i} l={l} i={i} mostrarDescuentoLista={mostrarDescuentoLista} />)}</tbody>
        </table>
        <BloqueTotales subtotal={subtotal} descuento={descuento} total={factura.total} totalPagado={totalPagado} saldo={saldo} />
        <BloqueFirma />
      </div>

      {/* Invoice — hojas cortadas por altura medida: header en cada hoja,
          totales + firma solo en la ultima. (iOS/WebKit no repite <thead>
          al imprimir, por eso el corte manual.) */}
      <div className="factura-doc max-w-[8.5in] mx-auto py-6 px-4 print:p-0 space-y-8 print:space-y-0">
        {(chunks ?? [lineas]).map((pageLineas, pageIdx, arr) => {
          const isLastPage = pageIdx === arr.length - 1;
          return (
            <div
              key={pageIdx}
              className="invoice-page bg-white print:shadow-none print:border-0 print:rounded-none overflow-hidden print:overflow-visible"
              style={{ breakAfter: isLastPage ? "auto" : "page" }}
            >
              <EncabezadoFactura factura={factura} cliente={cliente} page={pageIdx + 1} totalPages={arr.length} />
              {(pageLineas.length > 0 || lineas.length === 0) && (
                <table className="w-full text-sm">
                  <thead><FilaCols /></thead>
                  <tbody>
                    {pageLineas.length ? (
                      pageLineas.map((l, i) => <FilaProducto key={i} l={l} i={i} mostrarDescuentoLista={mostrarDescuentoLista} />)
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-gray-400 text-sm">No product details</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {isLastPage && (
                <>
                  <BloqueTotales subtotal={subtotal} descuento={descuento} total={factura.total} totalPagado={totalPagado} saldo={saldo} />
                  <BloqueFirma />
                </>
              )}
            </div>
          );
        })}
      </div>

      <style jsx global>{`
        @media screen {
          .invoice-page {
            min-height: 11in;
            box-shadow: 0 8px 40px rgba(0,0,0,0.28);
            border-radius: 2px;
          }
          .factura-doc {
            background: #5a6272;
            max-width: none;
            padding: 1.5rem 1rem;
            min-height: calc(100vh - 60px);
          }
        }
        @media print {
          @page { margin: 0.5in; }
          html, body { height: auto !important; min-height: 0 !important; background: white !important; }
          .factura-doc { padding: 0 !important; }
          .invoice-page { min-height: 0 !important; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
