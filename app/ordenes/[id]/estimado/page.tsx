"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

// Filas de producto por hoja impresa (deja espacio para el encabezado completo en cada una)
function EncabezadoEstimado({ orden, cliente }: { orden: Orden; cliente: Cliente | null }) {
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
      setLoading(false);
    };
    load();
  }, [ordenId, supabase]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground text-center">Loading estimate...</div>;
  }

  if (error || !orden) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <button
          onClick={() => router.push("/?tab=ord")}
          className="px-4 py-2 rounded-full text-sm font-medium backdrop-blur-md bg-white/50 border border-white/60 shadow-sm hover:bg-white/70 active:scale-[0.97] transition-all text-[#4a6741]"
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

  return (
    <div className="min-h-screen bg-[#f0efe9]">
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div
          className="max-w-3xl mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between"
          style={{ paddingTop: "calc(0.875rem + env(safe-area-inset-top))" }}
        >
          <button
            onClick={() => router.push("/?tab=ord")}
            className="px-4 py-2 rounded-full text-sm font-medium backdrop-blur-md bg-white/50 border border-white/60 shadow-sm hover:bg-white/70 active:scale-[0.97] transition-all text-[#4a6741]"
          >
            ← Back
          </button>
          <button
            onClick={() => window.print()}
            className="px-5 py-2 rounded-full backdrop-blur-md bg-[#4a6741]/85 border border-white/30 shadow-md hover:bg-[#4a6741]/95 active:scale-[0.97] transition-all text-white text-sm font-bold"
          >
            🖨️ Print / Save PDF
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-8 print:p-0">
        <div className="bg-white rounded-2xl print:rounded-none shadow-sm print:shadow-none border border-gray-200 print:border-0 overflow-hidden">
          <EncabezadoEstimado orden={orden} cliente={cliente} />

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
                {lineas.length ? (
                  lineas.map((l, i) => {
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
          </div>

          <div className="px-6 sm:px-10 py-4 border-t border-gray-200 text-center">
            <p className="text-[11px] text-gray-500">
              This is an estimate and may vary based on availability at the time of dispatch.
            </p>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page { size: letter; margin: 0.5in; }
          body { background: white !important; }
          tr { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>
    </div>
  );
}
