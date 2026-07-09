"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { printOrShare } from "@/lib/print";

interface LineaFactura {
  prodNom: string;
  sku?: string;
  barcode?: string;
  qty: number;
  precio: number;
  precioOriginal?: number;
  almacen?: "palmhills" | "castillo";
}

interface Pago {
  monto: number;
  fecha: string;
  nota?: string;
}

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

const ROWS_INTER = 22; // páginas intermedias: solo header + filas
const ROWS_LAST  = 14; // última página: header + filas + totales + firma + thank you

const GLASS_BTN ="backdrop-blur-md bg-white/50 border border-white/60 shadow-sm hover:bg-white/70 active:scale-[0.97] transition-all text-[#4a6741]";
const GLASS_BTN_PRIMARY = "backdrop-blur-md bg-[#4a6741]/85 border border-white/30 shadow-md hover:bg-[#4a6741]/95 active:scale-[0.97] transition-all text-white";
const GLASS_BTN_DANGER = "backdrop-blur-md bg-red-50/80 border border-red-200/60 shadow-sm hover:bg-red-100/80 active:scale-[0.97] transition-all text-red-700";

function EncabezadoFactura({ factura, cliente, page, totalPages }: { factura: Factura; cliente: Cliente | null; page: number; totalPages: number }) {
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
          <div className="text-[9px] text-gray-400 mt-0.5">Page {page} of {totalPages}</div>
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
            <div className={`text-xs font-bold ${factura.estado === "Paid" ? "text-green-700" : factura.estado === "Partially Paid" ? "text-blue-700" : factura.estado === "Overdue" ? "text-red-600" : "text-amber-700"}`}>{factura.estado}</div>
          </div>
        </div>
      </div>
    </>
  );
}


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

  // Payment form
  const [showPagoForm, setShowPagoForm] = useState(false);
  const [pagoMonto, setPagoMonto] = useState("");
  const [pagoFecha, setPagoFecha] = useState(today());
  const [pagoNota, setPagoNota] = useState("");
  const [savingPago, setSavingPago] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reverting, setReverting] = useState(false);

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

  const handleMarkPaid = async () => {
    if (!factura) return;
    const newEstado = "Paid";
    // Registrar solo el saldo restante: si ya habia pagos parciales, agregar
    // el total completo inflaria el historial de pagos.
    const pagado = (factura.pagos || []).reduce((acc, p) => acc + p.monto, 0);
    const restante = +(factura.total - pagado).toFixed(2);
    const newPagos =
      restante > 0
        ? [...(factura.pagos || []), { monto: restante, fecha: today(), nota: "Marked as fully paid" }]
        : [...(factura.pagos || [])];
    const { error } = await supabase.from("facturas").update({ estado: newEstado, pagos: newPagos }).eq("id", facturaId);
    if (error) { alert("Error: " + error.message); return; }
    setFactura(f => f ? { ...f, estado: newEstado, pagos: newPagos } : f);
  };

  const handleAddPago = async () => {
    if (!factura || savingPago) return;
    const monto = parseFloat(pagoMonto);
    if (!monto || monto <= 0) { alert("Enter a valid amount"); return; }
    setSavingPago(true);
    const newPago: Pago = { monto, fecha: pagoFecha, nota: pagoNota || undefined };
    const newPagos = [...(factura.pagos || []), newPago];
    const totalPagado = newPagos.reduce((acc, p) => acc + p.monto, 0);
    const newEstado = totalPagado >= factura.total ? "Paid" : "Partially Paid";
    const { error } = await supabase.from("facturas").update({ pagos: newPagos, estado: newEstado }).eq("id", facturaId);
    if (error) { alert("Error: " + error.message); setSavingPago(false); return; }
    setFactura(f => f ? { ...f, pagos: newPagos, estado: newEstado } : f);
    setPagoMonto("");
    setPagoFecha(today());
    setPagoNota("");
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

  // Auto-print cuando se abre desde iOS PWA con ?print=1. Espera a que los
  // datos del cliente esten listos para no imprimir sin direccion.
  useEffect(() => {
    if (!loading && factura && clienteListo) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("print") === "1") {
        setTimeout(() => window.print(), 400);
      }
    }
  }, [loading, factura, clienteListo]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground text-center">Loading invoice...</div>;
  }

  if (error || !factura) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <button onClick={() => router.push("/?tab=fact")} className={`px-4 py-2 rounded-full text-sm font-medium ${GLASS_BTN}`}>← Back</button>
      </div>
    );
  }

  const pagos = factura.pagos || [];
  const totalPagado = pagos.reduce((acc, p) => acc + p.monto, 0);
  const saldo = factura.total - totalPagado;

  const lineas = [...(factura.lineas || [])].sort((a, b) => {
    const skuA = (a.sku || "").trim();
    const skuB = (b.sku || "").trim();
    if (!skuA && skuB) return 1;
    if (skuA && !skuB) return -1;
    return skuA.localeCompare(skuB, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
  });
  const subtotal = lineas.reduce((acc, l) => acc + l.qty * (l.precioOriginal ?? l.precio), 0);
  const descuento = subtotal - factura.total;
  const isPaid = factura.estado === "Paid";

  // Chunking con dos límites distintos:
  // - Páginas intermedias: ROWS_INTER filas (sin footer)
  // - Última página:       ROWS_LAST filas  (con totales + firma + thank you)
  const chunks: LineaFactura[][] = (() => {
    const n = lineas.length;
    if (n === 0) return [[]];
    if (n <= ROWS_LAST) return [lineas]; // cabe todo en una página

    const numPages = 1 + Math.ceil((n - ROWS_LAST) / ROWS_INTER);

    if (numPages === 2) {
      // 2 páginas: balancear respetando el límite de la última
      const lastCount = Math.min(ROWS_LAST, Math.ceil(n / 2));
      return [lineas.slice(0, n - lastCount), lineas.slice(n - lastCount)];
    }

    // 3+ páginas: última = ROWS_LAST, intermedias se reparten uniformemente
    const interRows = n - ROWS_LAST;
    const numInter  = numPages - 1;
    const base  = Math.floor(interRows / numInter);
    const extra = interRows % numInter;
    const result: LineaFactura[][] = [];
    let idx = 0;
    for (let p = 0; p < numInter; p++) {
      result.push(lineas.slice(idx, idx + base + (p < extra ? 1 : 0)));
      idx += base + (p < extra ? 1 : 0);
    }
    result.push(lineas.slice(idx)); // última página
    return result;
  })();

  return (
    <div className="min-h-screen print:min-h-0 print:h-auto bg-[#f0efe9] print:bg-transparent">
      {/* Toolbar */}
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div
          className="max-w-3xl mx-auto px-4 sm:px-8 py-2.5 grid grid-cols-3 gap-1.5 sm:flex sm:items-center"
          style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
        >
          <button onClick={() => router.push("/?tab=fact")} className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${GLASS_BTN} sm:mr-auto`}>← Back</button>
          {!readOnly && !isPaid && (
            <button
              onClick={() => setShowPagoForm(true)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${GLASS_BTN_PRIMARY}`}
            >
              + Payment
            </button>
          )}
          {!readOnly && !isPaid && (
            <button
              onClick={handleMarkPaid}
              className="px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap backdrop-blur-md bg-green-600/85 border border-white/30 shadow-sm hover:bg-green-600/95 active:scale-[0.97] transition-all text-white"
            >
              ✓ Paid
            </button>
          )}
          {!readOnly && (
            <button
              onClick={handleRevert}
              disabled={reverting}
              title="Revert this invoice back to an order to adjust products and re-invoice"
              className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${GLASS_BTN} disabled:opacity-50`}
            >
              {reverting ? "Reverting..." : "↩️ To Order"}
            </button>
          )}
          <button
            onClick={printOrShare}
            className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${GLASS_BTN_PRIMARY}`}
          >
            🖨️ Print / PDF
          </button>
          {!readOnly && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`px-3 py-2 rounded-lg text-xs font-semibold ${GLASS_BTN_DANGER}`}
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>

      {/* Payment form modal */}
      {showPagoForm && (
        <div className="print:hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-4 pb-6">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[#1a1a18]">Record Payment</h2>
              <button onClick={() => setShowPagoForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="text-xs text-gray-500 mb-4">
              Invoice total: <strong>{fmt(factura.total)}</strong> · Paid: <strong className="text-green-700">{fmt(totalPagado)}</strong> · Balance: <strong className="text-amber-700">{fmt(saldo)}</strong>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Amount ($)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={pagoMonto}
                  onChange={e => setPagoMonto(e.target.value)}
                  placeholder={fmt(saldo).replace("$", "")}
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Date</label>
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
                  placeholder="Cash, transfer, check..."
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                />
              </div>
            </div>
            <div className="flex gap-2.5 mt-5">
              <button onClick={() => setShowPagoForm(false)} className={`flex-1 px-4 py-2.5 rounded-full text-sm font-medium ${GLASS_BTN}`}>Cancel</button>
              <button
                onClick={handleAddPago}
                disabled={savingPago || !pagoMonto}
                className={`flex-1 px-4 py-2.5 rounded-full text-sm font-bold ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
              >
                {savingPago ? "Saving..." : "Save Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment history (screen only) */}
      {pagos.length > 0 && (
        <div className="print:hidden max-w-3xl mx-auto px-4 sm:px-8 pt-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Payment History</div>
              <div className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${isPaid ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                {isPaid ? "Fully Paid" : `Balance: ${fmt(saldo)}`}
              </div>
            </div>
            {pagos.map((p, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                <div>
                  <div className="text-sm font-semibold text-gray-800">{fmt(p.monto)}</div>
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

      {/* Invoice — un div por hoja, header repetido manualmente en cada chunk */}
      <div className="factura-doc max-w-[8.5in] mx-auto py-6 px-4 print:p-0 space-y-8 print:space-y-0">
        {chunks.map((pageLineas, pageIdx) => {
          const isLastPage = pageIdx === chunks.length - 1;
          return (
            <div
              key={pageIdx}
              className="invoice-page bg-white print:shadow-none print:border-0 print:rounded-none overflow-hidden print:overflow-visible"
              style={{ breakAfter: isLastPage ? "auto" : "page" }}
            >
              <EncabezadoFactura factura={factura} cliente={cliente} page={pageIdx + 1} totalPages={chunks.length} />

              <div className="px-6 sm:px-10 py-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-[#1a1a18] text-left">
                      <th className="pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide">Qty.</th>
                      <th className="pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide">SKU</th>
                      <th className="pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide">Description</th>
                      <th className="pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide text-right">Price</th>
                      <th className="pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageLineas.length ? pageLineas.map((l, i) => {
                      const tieneDescuento = l.precioOriginal !== undefined && l.precioOriginal !== l.precio;
                      return (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#e3e9da]"}>
                          <td className="py-2 text-gray-700 text-xs">{l.qty}</td>
                          <td className="py-2 text-gray-400 font-mono text-[9px]">{l.sku || "—"}</td>
                          <td className="py-2 text-gray-800 text-[10px]">{l.prodNom}</td>
                          <td className="py-2 text-right text-xs">
                            {tieneDescuento ? (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="text-gray-400 line-through text-[11px]">{fmt(l.precioOriginal!)}</span>
                                <span className="text-[#4a6741] font-bold">{fmt(l.precio)}</span>
                              </div>
                            ) : (
                              <span className="text-gray-700">{fmt(l.precio)}</span>
                            )}
                          </td>
                          <td className="py-2 text-right text-xs">
                            {tieneDescuento ? (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="text-gray-400 line-through text-[11px]">{fmt(l.qty * l.precioOriginal!)}</span>
                                <span className="text-[#4a6741] font-bold">{fmt(l.qty * l.precio)}</span>
                              </div>
                            ) : (
                              <span className="text-gray-800 font-medium">{fmt(l.qty * l.precio)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-gray-400 text-sm">No product details</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {isLastPage && (
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
                        <span className="text-xl font-black text-[#4a6741]">{fmt(factura.total)}</span>
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
                )}
              </div>

              {isLastPage && (
                <>
                  <div className="px-6 sm:px-10 py-3 border-t border-gray-200">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mb-2">Delivery confirmation</div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <div><div className="border-b border-gray-400 h-4 w-28" /><div className="text-[9px] text-gray-500 mt-0.5">Order received signature</div></div>
                      <div><div className="border-b border-gray-400 h-4 w-20" /><div className="text-[9px] text-gray-500 mt-0.5">Date</div></div>
                      <div><div className="border-b border-gray-400 h-4 w-40" /><div className="text-[9px] text-gray-500 mt-0.5">Name of recipient</div></div>
                    </div>
                  </div>
                  <div className="px-6 sm:px-10 py-6 border-t border-gray-200 text-center">
                    <p className="text-sm font-semibold text-[#4a6741] tracking-wide">Thank you for your purchase!</p>
                  </div>
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
          @page { size: letter portrait; margin: 0.5in; }
          html, body { height: auto !important; min-height: 0 !important; background: white !important; }
          .factura-doc { padding: 0 !important; }
          .invoice-page { min-height: 0 !important; }
          tr { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
