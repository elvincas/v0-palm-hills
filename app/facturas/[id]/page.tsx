"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface LineaFactura {
  prodNom: string;
  sku?: string;
  barcode?: string;
  qty: number;
  precio: number;
  precioOriginal?: number;
}

interface Factura {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  estado: string;
  total: number;
  lineas?: LineaFactura[];
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
  "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

const ESTADO_BADGE: Record<string, string> = {
  Pagada: "bg-green-100 text-green-800",
  Pendiente: "bg-amber-100 text-amber-800",
  "En revision": "bg-blue-100 text-blue-800",
  "En revisión": "bg-blue-100 text-blue-800",
};

export default function FacturaPage() {
  const params = useParams();
  const router = useRouter();
  const facturaId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [factura, setFactura] = useState<Factura | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data: f, error: fErr } = await supabase
        .from("facturas")
        .select("*")
        .eq("id", facturaId)
        .single();
      if (fErr || !f) {
        setError("No se pudo cargar esta factura.");
        setLoading(false);
        return;
      }
      setFactura(f as Factura);
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

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground text-center">Cargando factura...</div>;
  }

  if (error || !factura) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <button onClick={() => router.push("/?tab=fact")} className="text-sm text-muted-foreground underline">
          Volver
        </button>
      </div>
    );
  }

  const lineas = factura.lineas || [];
  const subtotal = lineas.reduce((acc, l) => acc + l.qty * (l.precioOriginal ?? l.precio), 0);
  const descuento = subtotal - factura.total;

  return (
    <div className="min-h-screen bg-[#f0efe9]">
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between">
          <button
            onClick={() => router.push("/?tab=fact")}
            className="text-sm font-medium text-[#4a6741] hover:text-[#39512f]"
          >
            ← Volver
          </button>
          <button
            onClick={() => window.print()}
            className="px-5 py-2 rounded-full bg-[#4a6741] text-white text-sm font-bold shadow-sm hover:bg-[#3d5636]"
          >
            🖨️ Imprimir / Guardar PDF
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-8 print:p-0">
        <div className="bg-white rounded-2xl print:rounded-none shadow-sm print:shadow-none border border-gray-200 print:border-0 overflow-hidden">
          {/* Tabla unica: el thead (mi empresa + cliente + columnas) se repite en cada hoja al imprimir */}
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th colSpan={5} className="p-0 text-left font-normal">
                  <div className="px-6 sm:px-10 pt-8 pb-6 flex items-start justify-between gap-6 border-b-2 border-[#4a6741]">
                    <div className="flex items-center gap-3.5">
                      <img src="/logo.png" alt="Palm Hills" className="w-16 h-16 object-contain shrink-0" />
                      <div>
                        <div className="text-lg font-bold text-[#1a1a18] leading-tight">Palm Hills</div>
                        <div className="text-xs font-medium text-[#b09060] tracking-wide">Beauty &amp; Health</div>
                        <div className="text-[11px] text-gray-500 mt-1.5">
                          📞 (551) 248-3442 &nbsp;·&nbsp; ✉️ admin@palmhillsco.net
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black tracking-wide text-[#4a6741]">FACTURA</div>
                      <div className="text-sm font-mono text-gray-600 mt-1">
                        #{String(factura.num).padStart(3, "0")}
                      </div>
                      <span
                        className={`mt-2 inline-flex px-3 py-1 rounded-full text-xs font-bold ${
                          ESTADO_BADGE[factura.estado] || "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {factura.estado}
                      </span>
                    </div>
                  </div>
                </th>
              </tr>
              <tr>
                <th colSpan={5} className="p-0 text-left font-normal">
                  <div className="px-6 sm:px-10 py-6 grid grid-cols-2 gap-6 bg-[#fafaf7]">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                        Facturar a
                      </div>
                      <div className="text-sm font-bold text-[#1a1a18]">{cliente?.nom || factura.cli}</div>
                      {cliente?.codigo_cliente && (
                        <div className="text-xs font-mono text-gray-500">#{cliente.codigo_cliente}</div>
                      )}
                      {cliente?.dir && (
                        <div className="text-xs text-gray-600 mt-1">
                          {[cliente.dir, cliente.ciudad, cliente.estado_dir].filter(Boolean).join(", ")}
                        </div>
                      )}
                      {cliente?.tel && <div className="text-xs text-gray-600">📞 {cliente.tel}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                        Fecha
                      </div>
                      <div className="text-sm font-medium text-[#1a1a18]">{fdate(factura.fecha)}</div>
                    </div>
                  </div>
                </th>
              </tr>
              <tr className="border-b-2 border-[#1a1a18] text-left">
                <th className="pt-3 pb-2 px-6 sm:px-10 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide">
                  Cant.
                </th>
                <th className="pt-3 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide">SKU</th>
                <th className="pt-3 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide">
                  Descripción
                </th>
                <th className="pt-3 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide text-right">
                  Precio
                </th>
                <th className="pt-3 pb-2 px-6 sm:px-10 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide text-right">
                  Monto
                </th>
              </tr>
            </thead>
            <tbody>
              {lineas.length ? (
                lineas.map((l, i) => {
                  const tieneDescuento = l.precioOriginal !== undefined && l.precioOriginal !== l.precio;
                  return (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#f4f6f2]"}>
                      <td className="py-2 px-6 sm:px-10 text-gray-700 text-xs">{l.qty}</td>
                      <td className="py-2 text-gray-400 font-mono text-[11px]">{l.sku || "—"}</td>
                      <td className="py-2 text-gray-800 text-xs">{l.prodNom}</td>
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
                      <td className="py-2 px-6 sm:px-10 text-right text-xs">
                        {tieneDescuento ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-gray-400 line-through text-[11px]">
                              {fmt(l.qty * l.precioOriginal!)}
                            </span>
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
                  <td colSpan={5} className="py-6 text-center text-gray-400 text-sm">
                    Sin detalle de productos
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="px-6 sm:px-10 py-6">
            <div className="flex justify-end">
              <div className="w-full sm:w-64">
                <div className="flex justify-between py-1.5 text-sm text-gray-600">
                  <span>Subtotal</span>
                  <span>{fmt(subtotal)}</span>
                </div>
                {descuento > 0.01 && (
                  <div className="flex justify-between py-1.5 text-sm text-[#4a6741] font-medium">
                    <span>Descuento</span>
                    <span>-{fmt(descuento)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2.5 mt-1 border-t-2 border-[#4a6741]">
                  <span className="text-base font-bold text-[#1a1a18]">Total</span>
                  <span className="text-xl font-black text-[#4a6741]">{fmt(factura.total)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Pie de pagina */}
          <div className="px-6 sm:px-10 py-6 border-t border-gray-200 text-center">
            <p className="text-sm font-semibold text-[#4a6741] tracking-wide">
              ¡Gracias por su compra!
            </p>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            margin: 0.5in;
          }
          body {
            background: white !important;
          }
          table {
            page-break-inside: auto;
          }
          thead {
            display: table-header-group;
          }
          tr {
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
