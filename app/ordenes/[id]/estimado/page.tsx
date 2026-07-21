"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import { Switch } from "@/components/ui/switch";

interface LineaOrden {
  prodId?: string;
  prodNom: string;
  sku?: string;
  barcode?: string;
  qty: number;
  precio: number;
  precioFinal?: number;
  precioCatalogo?: number;
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

// Pildoras planas estilo iOS (mismo sistema que /facturas/[id])
const PILL = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full bg-white text-[#4a6741] text-xs font-semibold border border-[#e3e7dd] shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all whitespace-nowrap";
const PILL_SOLID = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full bg-[#4a6741] text-white text-xs font-semibold border border-[#4a6741] shadow-sm active:scale-[0.97] transition-all whitespace-nowrap";
// Botones del toolbar: identicos (flex-1), icono arriba y etiqueta abajo
const TAB_BTN = "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl border shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all";
const TAB_LBL = "text-[9px] font-bold leading-none truncate max-w-full px-0.5";
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

function EncabezadoEstimado({ orden, cliente, page, totalPages }: { orden: Orden; cliente: Cliente | null; page?: number; totalPages?: number }) {
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
          {page !== undefined && totalPages !== undefined && (
            <div className="text-[9px] text-gray-400 mt-0.5">Page {page} of {totalPages}</div>
          )}
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

// Bloques compartidos entre el medidor oculto de paginacion y las hojas reales
const FilaColsE = () => (
  <tr className="text-left" data-m="cols">
    <th className="pt-4 pb-2 pl-6 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">Qty.</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">SKU</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18]">Description</th>
    <th className="pt-4 pb-2 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18] text-right">Price</th>
    <th className="pt-4 pb-2 pr-6 font-bold text-[#1a1a18] text-[11px] uppercase tracking-wide border-b-2 border-[#1a1a18] text-right">Amount</th>
  </tr>
);

// precioComparado: el precio "de antes" a tachar. Con el switch de descuento
// de lista encendido se usa el precio de catalogo puro (revela el descuento
// de lista completo); apagado, se usa l.precio (solo el ajuste manual, el
// comportamiento historico donde el precio de lista se ve como precio normal).
const precioComparadoE = (l: LineaOrden, mostrarDescuentoLista: boolean) =>
  mostrarDescuentoLista ? l.precioCatalogo ?? l.precio : l.precio;

const FilaProductoE = ({ l, i, mostrarDescuentoLista }: { l: LineaOrden; i: number; mostrarDescuentoLista: boolean }) => {
  const precioFinal = l.precioFinal ?? l.precio;
  const comparado = precioComparadoE(l, mostrarDescuentoLista);
  const tieneDescuento = precioFinal !== comparado;
  return (
    <tr className={i % 2 === 0 ? "bg-white" : "bg-[#e3e9da]"} data-m="row">
      <td className="py-2 pl-6 text-gray-700 text-xs">{l.qty}</td>
      <td className="py-2 text-gray-400 font-mono text-[9px]">{l.sku || "—"}</td>
      <td className="py-2 text-gray-800 text-[10px] uppercase">{l.prodNom}</td>
      <td className="py-2 text-right text-xs">
        {tieneDescuento ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-gray-400 line-through text-[11px]">{fmt(comparado)}</span>
            <span className="text-[#4a6741] font-bold">{fmt(precioFinal)}</span>
          </div>
        ) : (
          <span className="text-gray-700">{fmt(precioFinal)}</span>
        )}
      </td>
      <td className="py-2 pr-6 text-right text-xs">
        {tieneDescuento ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-gray-400 line-through text-[11px]">{fmt(l.qty * comparado)}</span>
            <span className="text-[#4a6741] font-bold">{fmt(l.qty * precioFinal)}</span>
          </div>
        ) : (
          <span className="text-gray-800 font-medium">{fmt(l.qty * precioFinal)}</span>
        )}
      </td>
    </tr>
  );
};

const BloqueTotalesE = ({ subtotal, descuento, total }: { subtotal: number; descuento: number; total: number }) => (
  <div className="px-6 pb-4" data-m="totals">
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
);

const BloqueDisclaimerE = () => (
  <div className="px-6 py-4 border-t border-gray-200 text-center" data-m="firma">
    <p className="text-[11px] text-gray-500">
      This is an estimate and may vary based on availability at the time of dispatch.
    </p>
  </div>
);

export default function EstimadoPage() {
  const params = useParams();
  const router = useRouter();
  const ordenId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [orden, setOrden] = useState<Orden | null>(null);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  // Mismo switch que en /facturas/[id]: revela el descuento de lista de
  // precios (catalogo -> lista) ademas del ajuste manual. Encendido por defecto.
  const [mostrarDescuentoLista, setMostrarDescuentoLista] = useState(true);

  // Descarga el PDF y abre el share sheet nativo (con Print/Save/AirDrop).
  const abrirPdf = async () => {
    if (generandoPdf || !orden) return;
    setGenerandoPdf(true);
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/pdf?listDiscount=${mostrarDescuentoLista ? "1" : "0"}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `Estimate-Order${orden.num}.pdf`, { type: "application/pdf" });
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
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [clienteListo, setClienteListo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Precio de catalogo actual por producto, para ordenes viejas creadas antes
  // de guardar precioCatalogo en cada linea (si no, el switch nunca aparece
  // en pedidos anteriores a este cambio).
  const [catalogoPrecios, setCatalogoPrecios] = useState<Record<string, number>>({});

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

      const idsFaltantes = Array.from(
        new Set(
          ((o as Orden).lineas || [])
            .filter((l) => l.precioCatalogo === undefined && l.prodId)
            .map((l) => l.prodId as string)
        )
      );
      if (idsFaltantes.length) {
        const { data: prods } = await supabase.from("productos").select("id, precio").in("id", idsFaltantes);
        if (prods) {
          setCatalogoPrecios(
            Object.fromEntries((prods as { id: string; precio: number }[]).map((p) => [p.id, Number(p.precio)]))
          );
        }
      }

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

  const lineasOrdenadas = useMemo(() => {
    const arr = (orden?.lineas || []).map((l) => ({
      ...l,
      precioCatalogo: l.precioCatalogo ?? (l.prodId ? catalogoPrecios[l.prodId] : undefined),
    }));
    arr.sort((a, b) => {
      const skuA = (a.sku || "").trim();
      const skuB = (b.sku || "").trim();
      if (!skuA && skuB) return 1;
      if (skuA && !skuB) return -1;
      return skuA.localeCompare(skuB, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
    });
    return arr;
  }, [orden, catalogoPrecios]);

  // Paginacion por medicion real (iOS/WebKit no repite <thead> al imprimir).
  // Ver el mismo mecanismo en /facturas/[id].
  const [chunks, setChunks] = useState<LineaOrden[][] | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!orden || !clienteListo) return;
    const el = measureRef.current;
    if (!el) return;
    const h = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.offsetHeight || 0;
    const headerH = h('[data-m="header"]') + h('[data-m="cols"]');
    const totalsH = h('[data-m="totals"]');
    const firmaH = h('[data-m="firma"]');
    const rowHs = Array.from(el.querySelectorAll('[data-m="row"]')).map((r) => (r as HTMLElement).offsetHeight);
    const PAGE_H = 10 * 96 - 30;
    const budget = Math.max(200, PAGE_H - headerH);
    const out: LineaOrden[][] = [];
    let cur: LineaOrden[] = [];
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
  }, [orden, clienteListo, lineasOrdenadas]);

  // Auto-print cuando se abre desde iOS PWA con ?print=1. Espera cliente y paginacion.
  useEffect(() => {
    if (!loading && orden && clienteListo && chunks) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("print") === "1") {
        setTimeout(() => window.print(), 400);
      }
    }
  }, [loading, orden, clienteListo, chunks]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground text-center">Loading estimate...</div>;
  }

  if (error || !orden) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <BackButton fallback="/?tab=ord" />
      </div>
    );
  }

  const lineas = lineasOrdenadas;
  // Solo tiene sentido ofrecer el switch si al menos una linea tiene un
  // precio de catalogo distinto al precio de lista ya guardado.
  const hayDescuentoListaDisponible = lineas.some(
    (l) => l.precioCatalogo !== undefined && l.precioCatalogo !== l.precio
  );
  const subtotal = lineas.reduce((acc, l) => acc + l.qty * precioComparadoE(l, mostrarDescuentoLista), 0);
  const total = lineas.reduce((acc, l) => acc + l.qty * (l.precioFinal ?? l.precio), 0);
  const descuento = subtotal - total;

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
          <button
            onClick={abrirPdf}
            disabled={generandoPdf}
            className={`${TAB_BTN} bg-[#4a6741] text-white border-[#4a6741] disabled:opacity-60`}
          >
            <Icon d={IC.print} />
            <span className={TAB_LBL}>{generandoPdf ? "..." : "Print / PDF"}</span>
          </button>
        </div>
        {hayDescuentoListaDisponible && (
          <div className="max-w-3xl mx-auto px-4 sm:px-8 pb-2.5 flex items-center justify-between gap-3">
            <label htmlFor="mostrar-descuento-lista-e" className="text-xs font-medium text-gray-600">
              Show list price as discount
            </label>
            <Switch
              id="mostrar-descuento-lista-e"
              checked={mostrarDescuentoLista}
              onCheckedChange={setMostrarDescuentoLista}
            />
          </div>
        )}
      </div>

      {/* Medidor oculto al ancho de impresion (ver /facturas/[id]) */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="absolute top-0 bg-white text-sm"
        style={{ left: "-9999px", width: "7.2in", visibility: "hidden" }}
      >
        <div data-m="header"><EncabezadoEstimado orden={orden} cliente={cliente} /></div>
        <table className="w-full text-sm">
          <thead><FilaColsE /></thead>
          <tbody>{lineas.map((l, i) => <FilaProductoE key={i} l={l} i={i} mostrarDescuentoLista={mostrarDescuentoLista} />)}</tbody>
        </table>
        <BloqueTotalesE subtotal={subtotal} descuento={descuento} total={total} />
        <BloqueDisclaimerE />
      </div>

      {/* Estimate — hojas cortadas por altura medida: header en cada hoja,
          totales + disclaimer solo en la ultima. */}
      <div className="factura-doc max-w-[8.5in] mx-auto py-6 px-4 print:p-0 space-y-8 print:space-y-0">
        {(chunks ?? [lineas]).map((pageLineas, pageIdx, arr) => {
          const isLastPage = pageIdx === arr.length - 1;
          return (
            <div
              key={pageIdx}
              className="invoice-page bg-white print:shadow-none print:border-0 print:rounded-none overflow-hidden print:overflow-visible"
              style={{ breakAfter: isLastPage ? "auto" : "page" }}
            >
              <EncabezadoEstimado orden={orden} cliente={cliente} page={pageIdx + 1} totalPages={arr.length} />
              {(pageLineas.length > 0 || lineas.length === 0) && (
                <table className="w-full text-sm">
                  <thead><FilaColsE /></thead>
                  <tbody>
                    {pageLineas.length ? (
                      pageLineas.map((l, i) => <FilaProductoE key={i} l={l} i={i} mostrarDescuentoLista={mostrarDescuentoLista} />)
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
                  <BloqueTotalesE subtotal={subtotal} descuento={descuento} total={total} />
                  <BloqueDisclaimerE />
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
