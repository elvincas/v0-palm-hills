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

// Filas que caben por página con encabezado pero sin footer (páginas intermedias)
const ROWS_PER_PAGE = 17;
// Filas que caben en la última página (encabezado + footer de totales + firma)
const ROWS_LAST_PAGE = 11;

const GLASS_BTN = "backdrop-blur-md bg-white/50 border border-white/60 shadow-sm hover:bg-white/70 active:scale-[0.97] transition-all text-[#4a6741]";
const GLASS_BTN_PRIMARY = "backdrop-blur-md bg-[#4a6741]/85 border border-white/30 shadow-md hover:bg-[#4a6741]/95 active:scale-[0.97] transition-all text-white";
const GLASS_BTN_DANGER = "backdrop-blur-md bg-red-50/80 border border-red-200/60 shadow-sm hover:bg-red-100/80 active:scale-[0.97] transition-all text-red-700";

function EncabezadoFactura({ factura, cliente }: { factura: Factura; cliente: Cliente | null }) {
  return (
    <>
      <div className="px-6 sm:px-10 pt-4 pb-3 flex items-center justify-between gap-6 border-b-2 border-[#4a6741]">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Palm Hills" className="w-14 h-14 object-contain shrink-0" />
          <div>
            <div className="text-sm font-bold text-[#1a1a18] leading-tight">Palm Hills</div>
            <div className="text-[10px] text-gray-500">
              📞 (551) 248-3442 &nbsp;·&nbsp; ✉️ admin@palmhillsco.net
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-black tracking-wide text-[#4a6741] leading-tight">INVOICE</div>
          <div className="text-xs font-mono text-gray-600">#{String(factura.num).padStart(3, "0")}</div>
        </div>
      </div>
      <div className="px-6 sm:px-10 py-3 grid grid-cols-2 gap-6 bg-[#fafaf7]">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Bill to</div>
          <div className="text-xs font-bold text-[#1a1a18]">{cliente?.nom || factura.cli}</div>
          {cliente?.codigo_cliente && (
            <div className="text-[10px] font-mono text-gray-500">#{cliente.codigo_cliente}</div>
          )}
          {cliente?.dir && (
            <div className="text-[10px] text-gray-600">
              {[cliente.dir, cliente.ciudad, cliente.estado_dir].filter(Boolean).join(", ")}
            </div>
          )}
          {cliente?.tel && <div className="text-[10px] text-gray-600">📞 {cliente.tel}</div>}
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Date</div>
          <div className="text-xs font-medium text-[#1a1a18]">{fdate(factura.fecha)}</div>
          <div className="mt-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Status</div>
            <div className={`text-xs font-bold ${
              factura.estado === "Paid" ? "text-green-700"
              : factura.estado === "Partially Paid" ? "text-blue-700"
              : factura.estado === "Overdue" ? "text-red-600"
              : "text-amber-700"
            }`}>{factura.estado}</div>
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
      const { data: c } = await supabase
        .from("clientes")
        .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel, email")
        .eq("nom", (f as Factura).cli)
        .maybeSingle();
      if (c) setCliente(c as Cliente);
      setLoading(false);
    };
    load();
  }, [facturaId, supabase]);

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
    const fullPago: Pago = { monto: factura.total, fecha: today(), nota: "Marked as fully paid" };
    const newPagos = [...(factura.pagos || []), fullPago];
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

  // Auto-print cuando se abre desde iOS PWA con ?print=1
  useEffect(() => {
    if (!loading && factura) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("print") === "1") {
        setTimeout(() => window.print(), 400);
      }
    }
  }, [loading, factura]);

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

  // Paginación manual para que el encabezado aparezca en cada hoja impresa
  const chunks: LineaFactura[][] = (() => {
    if (lineas.length === 0) return [[]];
    if (lineas.length <= ROWS_LAST_PAGE) return [lineas];
    const result: LineaFactura[][] = [];
    const pool = [...lineas];
    while (pool.length > ROWS_LAST_PAGE) {
      result.push(pool.splice(0, ROWS_PER_PAGE));
    }
    if (pool.length > 0) result.push(pool);
    return result;
  })();

  return (
    <div className="min-h-screen bg-[#f0efe9]">
      {/* Toolbar */}
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div
          className="max-w-3xl mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between gap-2"
          style={{ paddingTop: "calc(0.875rem + env(safe-area-inset-top))" }}
        >
          <button onClick={() => router.push("/?tab=fact")} className={`px-4 py-2 rounded-full text-sm font-medium ${GLASS_BTN}`}>← Back</button>
          <div className="flex gap-2">
            {!readOnly && !isPaid && (
              <button
                onClick={() => setShowPagoForm(true)}
                className={`px-4 py-2 rounded-full text-sm font-bold ${GLASS_BTN_PRIMARY}`}
              >
                + Payment
              </button>
            )}
            {!readOnly && !isPaid && (
              <button
                onClick={handleMarkPaid}
                className="px-4 py-2 rounded-full text-sm font-bold backdrop-blur-md bg-green-600/85 border border-white/30 shadow-md hover:bg-green-600/95 active:scale-[0.97] transition-all text-white"
              >
                ✓ Paid
              </button>
            )}
            <button
              onClick={printOrShare}
              className={`px-4 py-2 rounded-full text-sm font-bold ${GLASS_BTN_PRIMARY}`}
            >
              🖨️ Print / PDF
            </button>
            {!readOnly && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className={`px-3 py-2 rounded-full text-sm font-bold ${GLASS_BTN_DANGER}`}
              >
                🗑
              </button>
            )}
          </div>
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

      {/* Invoice document — una sección por hoja para que el encabezado se repita */}
      <div className="max-w-3xl mx-auto p-4 sm:p-8 print:p-0 space-y-6 print:space-y-0">
        {chunks.map((pageLineas, pageIdx) => {
          const isLastPage = pageIdx === chunks.length - 1;
          return (
            <div
              key={pageIdx}
              className="bg-white rounded-2xl print:rounded-none shadow-sm print:shadow-none border border-gray-200 print:border-0 overflow-hidden print:overflow-visible"
              style={{ breakAfter: isLastPage ? "auto" : "page" }}
            >
              <EncabezadoFactura factura={factura} cliente={cliente} />

              <div className="px-6 sm:px-10 py-6">
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
                    {pageLineas.length ? (
                      pageLineas.map((l, i) => {
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
                      })
                    ) : (
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
                        <span>Subtotal</span>
                        <span>{fmt(subtotal)}</span>
                      </div>
                      {descuento > 0.01 && (
                        <div className="flex justify-between py-1.5 text-sm text-[#4a6741] font-medium">
                          <span>Discount</span>
                          <span>-{fmt(descuento)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-2.5 mt-1 border-t-2 border-[#4a6741]">
                        <span className="text-base font-bold text-[#1a1a18]">Total</span>
                        <span className="text-xl font-black text-[#4a6741]">{fmt(factura.total)}</span>
                      </div>
                      {totalPagado > 0 && (
                        <>
                          <div className="flex justify-between py-1.5 text-sm text-green-700">
                            <span>Paid</span>
                            <span>-{fmt(totalPagado)}</span>
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
                      <div>
                        <div className="border-b border-gray-400 h-4 w-28" />
                        <div className="text-[9px] text-gray-500 mt-0.5">Order received signature</div>
                      </div>
                      <div>
                        <div className="border-b border-gray-400 h-4 w-20" />
                        <div className="text-[9px] text-gray-500 mt-0.5">Date</div>
                      </div>
                      <div>
                        <div className="border-b border-gray-400 h-4 w-40" />
                        <div className="text-[9px] text-gray-500 mt-0.5">Name of recipient</div>
                      </div>
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
        @media print {
          @page { size: letter; margin: 0.5in; }
          body { background: white !important; }
          tr { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
