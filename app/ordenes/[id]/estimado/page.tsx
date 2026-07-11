"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { printOrShare } from "@/lib/print";

interface LineaOrden {
  prodNom: string;
  sku?: string;
  barcode?: string;
  qty: number;
  precio: number;
  precioFinal?: number;
  almacen?: "palmhills" | "castillo";
}

interface Orden {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  estado: string;
  total: number;
  lineas?: LineaOrden[];
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

// Mismos límites que la factura (mismo layout de hoja): páginas intermedias
// solo llevan header + filas; la última además totales + disclaimer.
const ROWS_INTER = 22;
const ROWS_LAST = 14;

// Pildoras planas estilo iOS (mismo sistema que /facturas/[id])
const PILL = "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-full bg-white text-[#4a6741] text-[13px] font-semibold border border-[#e3e7dd] shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all whitespace-nowrap";
const PILL_SOLID = "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-full bg-[#4a6741] text-white text-[13px] font-semibold border border-[#4a6741] shadow-sm active:scale-[0.97] transition-all whitespace-nowrap";
const PILL_ICON = "inline-flex items-center justify-center h-10 w-10 rounded-full bg-white text-[#4a6741] border border-[#e3e7dd] shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all shrink-0";
const GLASS_BTN = PILL;
const GLASS_BTN_PRIMARY = PILL_SOLID;

const Icon = ({ d }: { d: string }) => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split("|").map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const IC = {
  back: "M15 18l-6-6 6-6",
  print: "M6 9V4h12v5|M6 13h12v8H6z|M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2",
};

function EncabezadoEstimado({ orden, cliente, page, totalPages }: { orden: Orden; cliente: Cliente | null; page: number; totalPages: number }) {
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
          <div className="text-base font-black tracking-wide text-[#b09060] leading-tight">ESTIMATE</div>
          <div className="text-xs font-mono text-gray-600">Order #{orden.num}</div>
          <div className="text-[9px] text-gray-400 mt-0.5">Page {page} of {totalPages}</div>
        </div>
      </div>
      <div className="px-6 sm:px-10 py-3 grid grid-cols-2 gap-6 bg-[#fafaf7]">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Client</div>
          <div className="text-xs font-bold text-[#1a1a18]">{cliente?.nom || orden.cli}</div>
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
          <div className="text-xs font-medium text-[#1a1a18]">{fdate(orden.fecha)}</div>
        </div>
      </div>
    </>
  );
}

export default function EstimadoPage() {
  const params = useParams();
  const router = useRouter();
  const ordenId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [orden, setOrden] = useState<Orden | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [clienteListo, setClienteListo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data: o, error: oErr } = await supabase
        .from("ordenes")
        .select("*")
        .eq("id", ordenId)
        .single();
      if (oErr || !o) {
        setError("Couldn't load this order.");
        setLoading(false);
        return;
      }
      setOrden(o as Orden);
      document.title = `Estimate-Order${(o as Orden).num}`;
      // Mostrar el documento de inmediato; los datos del cliente llegan
      // despues sin bloquear el render.
      setLoading(false);

      // El cliente de una orden puede estar guardado por id o, en ordenes mas
      // antiguas, por nombre — se intenta de las dos formas.
      const { data: cPorId } = await supabase
        .from("clientes")
        .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel, email")
        .eq("id", (o as Orden).cli)
        .maybeSingle();
      if (cPorId) {
        setCliente(cPorId as Cliente);
      } else {
        const { data: cPorNombre } = await supabase
          .from("clientes")
          .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel, email")
          .eq("nom", (o as Orden).cli)
          .maybeSingle();
        if (cPorNombre) setCliente(cPorNombre as Cliente);
      }
      setClienteListo(true);
    };
    load();
  }, [ordenId, supabase]);

  // Auto-print cuando se abre desde iOS PWA con ?print=1. Espera a que los
  // datos del cliente esten listos para no imprimir sin direccion.
  useEffect(() => {
    if (!loading && orden && clienteListo) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("print") === "1") {
        setTimeout(() => window.print(), 400);
      }
    }
  }, [loading, orden, clienteListo]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground text-center">Loading estimate...</div>;
  }

  if (error || !orden) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <button
          onClick={() => router.push("/?tab=ord")}
          className={GLASS_BTN}
        >
          ← Back
        </button>
      </div>
    );
  }

  const lineas = [...(orden.lineas || [])].sort((a, b) => {
    const skuA = (a.sku || "").trim();
    const skuB = (b.sku || "").trim();
    if (!skuA && skuB) return 1;
    if (skuA && !skuB) return -1;
    return skuA.localeCompare(skuB, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
  });
  const subtotal = lineas.reduce((acc, l) => acc + l.qty * l.precio, 0);
  const total = lineas.reduce((acc, l) => acc + l.qty * (l.precioFinal ?? l.precio), 0);
  const descuento = subtotal - total;

  // Mismo chunking que la factura: intermedias uniformes, última con espacio
  // para totales + disclaimer.
  const chunks: LineaOrden[][] = (() => {
    const n = lineas.length;
    if (n === 0) return [[]];
    if (n <= ROWS_LAST) return [lineas];

    const numPages = 1 + Math.ceil((n - ROWS_LAST) / ROWS_INTER);

    if (numPages === 2) {
      const lastCount = Math.min(ROWS_LAST, Math.ceil(n / 2));
      return [lineas.slice(0, n - lastCount), lineas.slice(n - lastCount)];
    }

    const interRows = n - ROWS_LAST;
    const numInter = numPages - 1;
    const base = Math.floor(interRows / numInter);
    const extra = interRows % numInter;
    const result: LineaOrden[][] = [];
    let idx = 0;
    for (let p = 0; p < numInter; p++) {
      result.push(lineas.slice(idx, idx + base + (p < extra ? 1 : 0)));
      idx += base + (p < extra ? 1 : 0);
    }
    result.push(lineas.slice(idx));
    return result;
  })();

  return (
    <div className="min-h-screen print:min-h-0 print:h-auto bg-[#f0efe9] print:bg-transparent">
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div
          className="max-w-3xl mx-auto px-4 sm:px-8 py-2.5 flex items-center justify-between"
          style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
        >
          <button onClick={() => router.push("/?tab=ord")} aria-label="Back" className={PILL_ICON}>
            <Icon d={IC.back} />
          </button>
          <button onClick={printOrShare} className={PILL_SOLID}>
            <Icon d={IC.print} />Print / PDF
          </button>
        </div>
      </div>

      {/* Estimate — mismo layout de hoja que la factura */}
      <div className="factura-doc max-w-[8.5in] mx-auto py-6 px-4 print:p-0 space-y-8 print:space-y-0">
        {chunks.map((pageLineas, pageIdx) => {
          const isLastPage = pageIdx === chunks.length - 1;
          return (
            <div
              key={pageIdx}
              className="invoice-page bg-white print:shadow-none print:border-0 print:rounded-none overflow-hidden print:overflow-visible"
              style={{ breakAfter: isLastPage ? "auto" : "page" }}
            >
              <EncabezadoEstimado orden={orden} cliente={cliente} page={pageIdx + 1} totalPages={chunks.length} />

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
                    {pageLineas.length ? (
                      pageLineas.map((l, i) => {
                        const precioFinal = l.precioFinal ?? l.precio;
                        const tieneDescuento = precioFinal !== l.precio;
                        return (
                          <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#e3e9da]"}>
                            <td className="py-2 text-gray-700 text-xs">{l.qty}</td>
                            <td className="py-2 text-gray-400 font-mono text-[9px]">{l.sku || "—"}</td>
                            <td className="py-2 text-gray-800 text-[10px]">{l.prodNom}</td>
                            <td className="py-2 text-right text-xs">
                              {tieneDescuento ? (
                                <div className="flex flex-col items-end leading-tight">
                                  <span className="text-gray-400 line-through text-[11px]">{fmt(l.precio)}</span>
                                  <span className="text-[#4a6741] font-bold">{fmt(precioFinal)}</span>
                                </div>
                              ) : (
                                <span className="text-gray-700">{fmt(l.precio)}</span>
                              )}
                            </td>
                            <td className="py-2 text-right text-xs">
                              {tieneDescuento ? (
                                <div className="flex flex-col items-end leading-tight">
                                  <span className="text-gray-400 line-through text-[11px]">{fmt(l.qty * l.precio)}</span>
                                  <span className="text-[#4a6741] font-bold">{fmt(l.qty * precioFinal)}</span>
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
                        <span className="text-base font-bold text-[#1a1a18]">Estimated total</span>
                        <span className="text-xl font-black text-[#4a6741]">{fmt(total)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {isLastPage && (
                <div className="px-6 sm:px-10 py-4 border-t border-gray-200 text-center">
                  <p className="text-[11px] text-gray-500">
                    This is an estimate and may vary based on availability at the time of dispatch.
                  </p>
                </div>
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
          @page { size: letter portrait; margin: 0.5in; }
          html, body { height: auto !important; min-height: 0 !important; background: white !important; }
          .factura-doc { padding: 0 !important; }
          .invoice-page { min-height: 0 !important; }
          tr { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>
    </div>
  );
}
