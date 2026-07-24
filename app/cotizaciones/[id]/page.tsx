"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import { type Empresa, EMPRESA_DEFAULT } from "@/lib/empresa";

interface LineaCotizacion {
  prodId?: string;
  prodNom: string;
  sku?: string;
  barcode?: string;
  qty: number;
  precio: number;
  precioCatalogo?: number;
  almacen?: string;
}

interface Cotizacion {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  estado: string;
  lineas?: LineaCotizacion[];
  total: number;
  valido_hasta?: string | null;
  mensaje?: string | null;
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

const PILL = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full bg-white text-[#4a6741] text-xs font-semibold border border-[#e3e7dd] shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all whitespace-nowrap";
const PILL_SOLID = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full bg-[#4a6741] text-white text-xs font-semibold border border-[#4a6741] shadow-sm active:scale-[0.97] transition-all whitespace-nowrap";
const TAB_BTN = "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl border shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all";
const TAB_LBL = "text-[9px] font-bold leading-none truncate max-w-full px-0.5";

const ESTADO_BADGE: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-800",
  Accepted: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
  Expired: "bg-gray-100 text-gray-600",
};

const Icon = ({ d }: { d: string }) => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split("|").map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const IC = {
  back: "M15 18l-6-6 6-6",
  print: "M6 9V4h12v5|M6 13h12v8H6z|M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2",
  check: "M20 6L9 17l-5-5",
  convert: "M17 1l4 4-4 4|M3 11V9a4 4 0 0 1 4-4h14|M7 23l-4-4 4-4|M21 13v2a4 4 0 0 1-4 4H3",
};

function EncabezadoCotizacion({ cot, cliente, empresa, page, totalPages }: { cot: Cotizacion; cliente: Cliente | null; empresa: Empresa; page?: number; totalPages?: number }) {
  return (
    <>
      <div
        className={`px-6 sm:px-10 pt-4 pb-3 flex items-center gap-6 border-b-2 ${empresa.doc_logo_pos === "right" ? "flex-row-reverse justify-between" : "justify-between"}`}
        style={{ borderColor: empresa.doc_accent_color || "#4a6741" }}
      >
        <div className={`flex items-center gap-2 ${empresa.doc_logo_pos === "center" ? "flex-1 justify-center" : ""}`}>
          <img src={empresa.logo || "/logo.png"} alt={empresa.nombre} className="w-14 h-14 object-contain shrink-0" />
          <div>
            <div className="text-sm font-bold text-[#1a1a18] leading-tight">{empresa.nombre}</div>
            <div className="text-[10px] text-gray-500">
              {[empresa.telefono ? `📞 ${empresa.telefono}` : "", empresa.email ? `✉️ ${empresa.email}` : ""].filter(Boolean).join("  ·  ")}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-black tracking-wide text-[#b09060] leading-tight">QUOTATION</div>
          <div className="text-xs font-mono text-gray-600">#{String(cot.num).padStart(4, "0")}</div>
          {page !== undefined && totalPages !== undefined && (
            <div className="text-[9px] text-gray-400 mt-0.5">Page {page} of {totalPages}</div>
          )}
        </div>
      </div>
      <div className="px-6 sm:px-10 py-3 grid grid-cols-2 gap-6 bg-[#fafaf7]">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Client</div>
          <div className="text-xs font-bold text-[#1a1a18]">{cliente?.nom || cot.cli}</div>
          {cliente?.codigo_cliente && <div className="text-[10px] font-mono text-gray-500">#{cliente.codigo_cliente}</div>}
          {cliente?.dir && <div className="text-[10px] text-gray-600">{[cliente.dir, cliente.ciudad, cliente.estado_dir].filter(Boolean).join(", ")}</div>}
          {cliente?.tel && <div className="text-[10px] text-gray-600">📞 {cliente.tel}</div>}
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Date</div>
          <div className="text-xs font-medium text-[#1a1a18]">{fdate(cot.fecha)}</div>
          {cot.valido_hasta && (
            <>
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mt-1.5">Valid Until</div>
              <div className="text-xs font-medium text-[#1a1a18]">{fdate(cot.valido_hasta)}</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

const FilaColsQ = () => (
  <tr className="text-left" data-m="cols">
    <th className="pt-4 pb-2 pl-6 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">Qty.</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">SKU</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">Description</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18] text-right">Price</th>
    <th className="pt-4 pb-2 pr-6 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18] text-right">Amount</th>
  </tr>
);

const FilaProductoQ = ({ l, i }: { l: LineaCotizacion; i: number }) => (
  <tr className={i % 2 === 0 ? "bg-white" : "bg-[#e3e9da]"} data-m="row">
    <td className="py-2 pl-6 text-gray-700 text-xs">{l.qty}</td>
    <td className="py-2 text-gray-400 font-mono text-[9px]">{l.sku || "—"}</td>
    <td className="py-2 text-gray-800 text-[10px] uppercase">{l.prodNom}</td>
    <td className="py-2 text-right text-xs text-gray-700">{fmt(l.precio)}</td>
    <td className="py-2 pr-6 text-right text-xs text-gray-800 font-medium">{fmt(l.qty * l.precio)}</td>
  </tr>
);

const BloqueTotalesQ = ({ total, accentColor }: { total: number; accentColor?: string }) => (
  <div className="px-6 pb-4" data-m="totals">
    <div className="flex justify-end mt-4">
      <div className="w-full sm:w-64">
        <div className="flex justify-between items-center py-2.5 mt-1 border-t-2" style={{ borderColor: accentColor || "#4a6741" }}>
          <span className="text-base font-bold text-[#1a1a18]">Total</span>
          <span className="text-xl font-black" style={{ color: accentColor || "#4a6741" }}>{fmt(total)}</span>
        </div>
      </div>
    </div>
  </div>
);

const BloqueDisclaimerQ = ({ validoHasta, mensaje, showDisclaimer = true }: { validoHasta?: string | null; mensaje?: string | null; showDisclaimer?: boolean }) => (
  <div className="px-6 py-4 border-t border-gray-200 text-center" data-m="firma">
    {showDisclaimer && (
      <p className="text-[11px] text-gray-500">
        This is a price quotation{validoHasta ? `, valid until ${fdate(validoHasta)}` : ""} and does not reserve inventory.
      </p>
    )}
    {mensaje && <p className="mt-2 mx-auto max-w-md text-xs italic text-gray-500 bg-[#f2f4ee] rounded-lg px-3 py-2">{mensaje}</p>}
  </div>
);

export default function CotizacionPage() {
  const params = useParams();
  const router = useRouter();
  const cotId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [cot, setCot] = useState<Cotizacion | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [clienteListo, setClienteListo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [empresa, setEmpresa] = useState<Empresa>(EMPRESA_DEFAULT);
  const [readOnly, setReadOnly] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [converting, setConverting] = useState(false);
  const [savingEstado, setSavingEstado] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setReadOnly(data.user?.user_metadata?.role === "visitante");
    });
    supabase.from("empresa").select("*").eq("id", 1).maybeSingle().then(({ data }) => { if (data) setEmpresa(data as Empresa); });
  }, [supabase]);

  useEffect(() => {
    const load = async () => {
      const { data: c, error: cErr } = await supabase.from("cotizaciones").select("*").eq("id", cotId).single();
      if (cErr || !c) {
        setError("Couldn't load this quotation.");
        setLoading(false);
        return;
      }
      setCot(c as Cotizacion);
      document.title = `Quotation-${(c as Cotizacion).num}`;
      setLoading(false);

      const { data: cliData } = await supabase
        .from("clientes")
        .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel, email")
        .eq("nom", (c as Cotizacion).cli)
        .maybeSingle();
      if (cliData) setCliente(cliData as Cliente);
      setClienteListo(true);
    };
    load();
  }, [cotId, supabase]);

  const lineasOrdenadas = useMemo(() => {
    const arr = [...(cot?.lineas || [])];
    arr.sort((a, b) => {
      const skuA = (a.sku || "").trim();
      const skuB = (b.sku || "").trim();
      if (!skuA && skuB) return 1;
      if (skuA && !skuB) return -1;
      return skuA.localeCompare(skuB, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
    });
    return arr;
  }, [cot]);

  const [chunks, setChunks] = useState<LineaCotizacion[][] | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!cot || !clienteListo) return;
    const el = measureRef.current;
    if (!el) return;
    const h = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.offsetHeight || 0;
    const headerH = h('[data-m="header"]') + h('[data-m="cols"]');
    const totalsH = h('[data-m="totals"]');
    const firmaH = h('[data-m="firma"]');
    const rowHs = Array.from(el.querySelectorAll('[data-m="row"]')).map((r) => (r as HTMLElement).offsetHeight);
    const PAGE_H = 10 * 96 - 30;
    const budget = Math.max(200, PAGE_H - headerH);
    const out: LineaCotizacion[][] = [];
    let cur: LineaCotizacion[] = [];
    let acc = 0;
    lineasOrdenadas.forEach((l, i) => {
      const rh = rowHs[i] || 36;
      if (acc + rh > budget && cur.length) { out.push(cur); cur = []; acc = 0; }
      cur.push(l);
      acc += rh;
    });
    if (acc + totalsH + firmaH > budget && cur.length) { out.push(cur); cur = []; }
    out.push(cur);
    setChunks(out);
  }, [cot, clienteListo, lineasOrdenadas]);

  useEffect(() => {
    if (!loading && cot && clienteListo && chunks) {
      const p = new URLSearchParams(window.location.search);
      if (p.get("print") === "1") setTimeout(() => window.print(), 400);
    }
  }, [loading, cot, clienteListo, chunks]);

  const abrirPdf = async () => {
    if (generandoPdf || !cot) return;
    setGenerandoPdf(true);
    try {
      const res = await fetch(`/api/cotizaciones/${cotId}/pdf`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `Quotation-${cot.num}.pdf`, { type: "application/pdf" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        window.open(URL.createObjectURL(blob), "_blank");
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        alert("Could not generate the PDF: " + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setGenerandoPdf(false);
    }
  };

  const cambiarEstado = async (estado: string) => {
    if (!cot || savingEstado) return;
    setSavingEstado(true);
    try {
      const { error: uErr } = await supabase.from("cotizaciones").update({ estado }).eq("id", cot.id);
      if (uErr) throw uErr;
      setCot({ ...cot, estado });
    } catch (err) {
      alert(`Could not update status: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingEstado(false);
    }
  };

  // Convierte la cotizacion en una Orden real: mismas lineas, pero ahora SI
  // reserva inventario (a diferencia de la cotizacion, que nunca lo hizo).
  const convertirAOrden = async () => {
    if (!cot || converting) return;
    if (!confirm(`Create a real Order from Quotation #${cot.num}? This will reserve inventory.`)) return;
    setConverting(true);
    try {
      const { data: maxRow } = await supabase.from("ordenes").select("num").order("num", { ascending: false }).limit(1);
      const num = (maxRow && maxRow.length ? Number(maxRow[0].num) || 0 : 0) + 1;
      const lineasOrden = (cot.lineas || []).map((l) => ({
        prodId: l.prodId || "",
        prodNom: l.prodNom,
        barcode: l.barcode || "",
        sku: l.sku || "",
        precio: l.precio,
        precioFinal: l.precio,
        precioCatalogo: l.precioCatalogo,
        qty: l.qty,
        qtyEnviada: l.qty,
        picked: false,
        almacen: l.almacen,
      }));
      const { data: ordenNueva, error: oErr } = await supabase
        .from("ordenes")
        .insert({ cli: cot.cli, fecha: today(), estado: "Pending", total: cot.total, lineas: lineasOrden, num })
        .select()
        .single();
      if (oErr) throw oErr;
      // Reservar inventario para cada linea (mismo criterio que addOrden en el DataContext)
      const prodIds = lineasOrden.filter((l) => l.prodId).map((l) => l.prodId);
      if (prodIds.length) {
        const { data: prods } = await supabase.from("productos").select("id, reservado, almacen").in("id", prodIds);
        if (prods) {
          const porId = new Map((prods as { id: string; reservado: number | null; almacen: string | null }[]).map((p) => [p.id, p]));
          const { data: almacenesData } = await supabase.from("almacenes").select("id, lleva_stock");
          const llevaStock = new Map((almacenesData || []).map((a: { id: string; lleva_stock: boolean }) => [a.id, a.lleva_stock]));
          await Promise.all(
            lineasOrden.map(async (l) => {
              const row = l.prodId ? porId.get(l.prodId) : undefined;
              if (!row) return;
              const alm = row.almacen || "palmhills";
              if (llevaStock.has(alm) && llevaStock.get(alm) === false) return;
              await supabase.from("productos").update({ reservado: Number(row.reservado || 0) + l.qty }).eq("id", row.id);
            })
          );
        }
      }
      await cambiarEstado("Accepted");
      router.push(`/ordenes/${(ordenNueva as { id: string }).id}/estimado`);
    } catch (err) {
      alert(`Could not convert to order: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground text-center">Loading quotation...</div>;
  }

  if (error || !cot) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <BackButton fallback="/?tab=ord" />
      </div>
    );
  }

  const lineas = lineasOrdenadas;
  const total = lineas.reduce((acc, l) => acc + l.qty * l.precio, 0);

  return (
    <div className="min-h-screen print:min-h-0 print:h-auto bg-[#f0efe9] print:bg-transparent">
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div
          className="max-w-3xl mx-auto px-4 sm:px-8 py-2.5 flex items-center justify-center gap-2"
          style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
        >
          <button onClick={() => (window.history.length > 1 ? router.back() : router.push("/?tab=ord"))} className={`${TAB_BTN} bg-white text-[#4a6741] border-[#e3e7dd]`}>
            <Icon d={IC.back} />
            <span className={TAB_LBL}>Back</span>
          </button>
          <button onClick={abrirPdf} disabled={generandoPdf} className={`${TAB_BTN} bg-[#4a6741] text-white border-[#4a6741] disabled:opacity-60`}>
            <Icon d={IC.print} />
            <span className={TAB_LBL}>{generandoPdf ? "..." : "Print / PDF"}</span>
          </button>
          {!readOnly && cot.estado !== "Accepted" && (
            <button onClick={convertirAOrden} disabled={converting} className={`${TAB_BTN} bg-[#b09060] text-white border-[#b09060] disabled:opacity-60`}>
              <Icon d={IC.convert} />
              <span className={TAB_LBL}>{converting ? "..." : "Convert"}</span>
            </button>
          )}
        </div>
        {!readOnly && (
          <div className="max-w-3xl mx-auto px-4 sm:px-8 pb-2.5 flex items-center justify-center gap-1.5">
            {["Pending", "Accepted", "Rejected", "Expired"].map((e) => (
              <button
                key={e}
                onClick={() => cambiarEstado(e)}
                disabled={savingEstado}
                className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${cot.estado === e ? ESTADO_BADGE[e] : "bg-gray-100 text-gray-400"}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={measureRef}
        aria-hidden="true"
        className="absolute top-0 bg-white text-sm"
        style={{ left: "-9999px", width: "7.2in", visibility: "hidden" }}
      >
        <div data-m="header"><EncabezadoCotizacion cot={cot} cliente={cliente} empresa={empresa} /></div>
        <table className="w-full text-sm">
          <thead><FilaColsQ /></thead>
          <tbody>{lineas.map((l, i) => <FilaProductoQ key={i} l={l} i={i} />)}</tbody>
        </table>
        <BloqueTotalesQ total={total} accentColor={empresa.doc_accent_color} />
        <BloqueDisclaimerQ validoHasta={cot.valido_hasta} mensaje={empresa.mensaje_cotizacion} showDisclaimer={empresa.doc_show_disclaimer ?? true} />
      </div>

      <div className="factura-doc max-w-[8.5in] mx-auto py-6 px-4 print:p-0 space-y-8 print:space-y-0">
        {(chunks ?? [lineas]).map((pageLineas, pageIdx, arr) => {
          const isLastPage = pageIdx === arr.length - 1;
          return (
            <div
              key={pageIdx}
              className="invoice-page bg-white print:shadow-none print:border-0 print:rounded-none overflow-hidden print:overflow-visible"
              style={{ breakAfter: isLastPage ? "auto" : "page" }}
            >
              <EncabezadoCotizacion cot={cot} cliente={cliente} empresa={empresa} page={pageIdx + 1} totalPages={arr.length} />
              {(pageLineas.length > 0 || lineas.length === 0) && (
                <table className="w-full text-sm">
                  <thead><FilaColsQ /></thead>
                  <tbody>
                    {pageLineas.length ? (
                      pageLineas.map((l, i) => <FilaProductoQ key={i} l={l} i={i} />)
                    ) : (
                      <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-sm">No product details</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              {isLastPage && (
                <>
                  <BloqueTotalesQ total={total} accentColor={empresa.doc_accent_color} />
                  <BloqueDisclaimerQ validoHasta={cot.valido_hasta} mensaje={empresa.mensaje_cotizacion} showDisclaimer={empresa.doc_show_disclaimer ?? true} />
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
            box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28);
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
          thead { display: table-header-group; }
        }
      `}</style>
    </div>
  );
}
