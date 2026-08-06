"use client";

// Recibo de pago en pantalla. El papel que se imprime es el PDF de
// /api/recibos/[id]/pdf (iOS no respeta cortes de pagina con window.print);
// esta vista es la misma informacion para revisarla y compartirla.
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import { type Empresa, EMPRESA_DEFAULT } from "@/lib/empresa";

interface LineaRecibo {
  factura_id?: string;
  factura_num: number;
  fecha: string;
  balance_antes: number;
  aplicado: number;
}

interface PendienteRecibo {
  num: number;
  fecha: string;
  saldo: number;
}

interface Recibo {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  monto: number;
  metodo?: string | null;
  nota?: string | null;
  lineas?: LineaRecibo[];
  pendientes?: PendienteRecibo[];
  total_pendiente?: number;
}

interface Cliente {
  nom: string;
  codigo_cliente?: string;
  dir?: string;
  ciudad?: string;
  estado_dir?: string;
  tel?: string;
}

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

// Muchos clientes tienen la direccion completa escrita en `dir` (con ciudad y
// estado adentro): concatenar ciudad/estado a ciegas imprime "Passaic, NJ" dos
// veces. Se omite lo que ya aparece en `dir`.
const direccionCliente = (c: Cliente | null) => {
  const dir = (c?.dir || "").trim();
  const extra = [c?.ciudad, c?.estado_dir]
    .filter(Boolean)
    .filter((x) => !dir.toLowerCase().includes(String(x).toLowerCase()));
  return [dir, ...extra].filter(Boolean).join(", ");
};

// La nota que la app escribe sola al usar el boton "Paid" es contabilidad
// interna, no una referencia del cliente: no va en su recibo.
const NOTA_AUTOMATICA = "Marked as fully paid";

// Igual que la ruta del PDF: la antiguedad se mide contra la fecha del recibo,
// no contra hoy — es parte del snapshot que se le entrego al cliente.
const diasEntre = (desde: string, hasta: string) => {
  const a = new Date(`${desde}T12:00:00`).getTime();
  const b = new Date(`${hasta}T12:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
};

const TAB_BTN =
  "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl border shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all";
const TAB_LBL = "text-[9px] font-bold leading-none truncate max-w-full px-0.5";

const Icon = ({ d }: { d: string }) => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split("|").map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const IC = {
  back: "M15 18l-6-6 6-6",
  print: "M6 9V4h12v5|M6 13h12v8H6z|M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2",
  trash: "M3 6h18|M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
};

export default function ReciboPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [recibo, setRecibo] = useState<Recibo | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [empresa, setEmpresa] = useState<Empresa>(EMPRESA_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const load = async () => {
      supabase.auth.getUser().then(({ data }) => {
        setReadOnly(data.user?.app_metadata?.role === "visitante");
      });
      supabase.from("empresa").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
        if (data) setEmpresa(data as Empresa);
      });
      const { data } = await supabase.from("recibos").select("*").eq("id", id).single();
      if (data) {
        const r = data as Recibo;
        setRecibo(r);
        const { data: c } = await supabase
          .from("clientes")
          .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel")
          .eq("nom", r.cli)
          .maybeSingle();
        if (c) setCliente(c as Cliente);
      }
      setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Mismo flujo que factura/estimate: se descarga el PDF y se abre el share
  // sheet nativo. Si iOS revoco el "user activation" mientras se generaba, el
  // share falla con NotAllowedError sin que el usuario cancele nada — en ese
  // caso se abre el PDF directo en vez de mostrar un error.
  const abrirPdf = async () => {
    if (generandoPdf || !recibo) return;
    setGenerandoPdf(true);
    try {
      const res = await fetch(`/api/recibos/${recibo.id}/pdf`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `Receipt-${String(recibo.num).padStart(4, "0")}.pdf`, { type: "application/pdf" });
      let compartido = false;
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          compartido = true;
        } catch (shareErr) {
          if (shareErr instanceof DOMException && shareErr.name === "AbortError") compartido = true;
        }
      }
      if (!compartido) window.open(URL.createObjectURL(blob), "_blank");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        alert("Could not generate the PDF: " + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setGenerandoPdf(false);
    }
  };

  // Borrar el recibo NO toca el pago: el dinero sigue registrado en su factura,
  // lo que se anula es el comprobante emitido.
  const handleDelete = async () => {
    if (!recibo) return;
    if (!confirm(`Delete receipt #${String(recibo.num).padStart(4, "0")}? The payment stays recorded on the invoice.`)) return;
    setDeleting(true);
    const { error } = await supabase.from("recibos").delete().eq("id", recibo.id);
    if (error) {
      alert("Error deleting receipt: " + error.message);
      setDeleting(false);
      return;
    }
    // Soltar la referencia guardada en el pago de la factura, si la tenia, para
    // que el boton "Receipt" vuelva a ofrecer emitirlo.
    const facturaId = recibo.lineas?.[0]?.factura_id;
    if (facturaId) {
      const { data: f } = await supabase.from("facturas").select("pagos").eq("id", facturaId).maybeSingle();
      if (f?.pagos) {
        const pagos = (f.pagos as { recibo_id?: string }[]).map((p) =>
          p.recibo_id === recibo.id ? { ...p, recibo_id: undefined } : p
        );
        await supabase.from("facturas").update({ pagos }).eq("id", facturaId);
      }
    }
    await supabase.from("actividad").insert({ msg: `Receipt #${String(recibo.num).padStart(4, "0")} deleted` });
    router.push("/?tab=fact");
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground text-center">Loading receipt...</div>;
  }

  if (!recibo) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-destructive mb-3">Receipt not found.</p>
        <BackButton fallback="/?tab=fact" />
      </div>
    );
  }

  const accent = empresa.doc_accent_color || "#4a6741";
  const lineas = recibo.lineas || [];
  const totalAplicado = lineas.reduce((a, l) => a + Number(l.aplicado), 0);
  const pendientes = (recibo.pendientes || [])
    .map((p) => ({ ...p, dias: diasEntre(p.fecha, recibo.fecha) }))
    .sort((a, b) => b.dias - a.dias);
  const vencidas = pendientes.filter((p) => p.dias > 30).length;

  return (
    <div className="min-h-screen bg-[#f0efe9]">
      {/* Toolbar */}
      <div className="sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div
          className="max-w-3xl mx-auto px-4 sm:px-8 py-2.5 flex items-stretch gap-1.5"
          style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
        >
          <button
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/?tab=fact"))}
            className={`${TAB_BTN} bg-white text-[#4a6741] border-[#e3e7dd]`}
          >
            <Icon d={IC.back} />
            <span className={TAB_LBL}>Back</span>
          </button>
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
      </div>

      {/* Documento */}
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-5">
        <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div
            className={`px-6 sm:px-8 pt-5 pb-3 flex items-center gap-6 border-b-2 ${
              empresa.doc_logo_pos === "right" ? "flex-row-reverse justify-between" : "justify-between"
            }`}
            style={{ borderColor: accent }}
          >
            <div className={`flex items-center gap-2 ${empresa.doc_logo_pos === "center" ? "flex-1 justify-center" : ""}`}>
              <img src={empresa.logo || "/logo.png"} alt={empresa.nombre} className="w-14 h-14 object-contain shrink-0" />
              <div>
                <div className="text-sm font-bold text-[#1a1a18] leading-tight">{empresa.nombre}</div>
                {empresa.eslogan && <div className="text-[10px] italic text-gray-500">{empresa.eslogan}</div>}
                <div className="text-[10px] text-gray-500">
                  {[empresa.telefono ? `📞 ${empresa.telefono}` : "", empresa.email ? `✉️ ${empresa.email}` : ""].filter(Boolean).join("  ·  ")}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-black tracking-wide" style={{ color: accent }}>RECEIPT</div>
              <div className="text-xs font-mono font-bold text-[#a3814e]">No. {String(recibo.num).padStart(4, "0")}</div>
            </div>
          </div>

          {/* Recibido de / fecha / metodo */}
          <div className="px-6 sm:px-8 py-4 bg-[#fafaf7] flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Received from</div>
              <div className="text-sm font-bold text-[#1a1a18]">{cliente?.nom || recibo.cli}</div>
              {cliente?.codigo_cliente && <div className="text-[10px] font-mono text-gray-500">#{cliente.codigo_cliente}</div>}
              {cliente?.dir && <div className="text-[10px] text-gray-600">{direccionCliente(cliente)}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Date</div>
              <div className="text-xs font-medium text-[#1a1a18]">{fdate(recibo.fecha)}</div>
              {recibo.metodo && (
                <>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mt-2">Method</div>
                  <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#eaf0e6]" style={{ color: accent }}>
                    {recibo.metodo}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="px-6 sm:px-8 py-5">
            {/* Monto */}
            <div className="flex items-center justify-between gap-4 border border-gray-200 bg-[#f7f8f4] rounded-2xl px-4 py-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Amount received</div>
              <div className="text-2xl font-black text-[#1a1a18] tabular-nums">{fmt(recibo.monto)}</div>
            </div>
            {recibo.nota && recibo.nota !== NOTA_AUTOMATICA && (
              <div className="text-[11px] italic text-gray-500 mt-2">{recibo.nota}</div>
            )}

            {/* Facturas cubiertas */}
            <table className="w-full mt-5" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid #1a1a18" }}>
                  <th className="text-left pb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">Applied to</th>
                  <th className="text-left pb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">Date</th>
                  <th className="text-right pb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">Balance was</th>
                  <th className="text-right pb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">Applied</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #eceee7" }}>
                    <td className="py-2 text-xs font-mono font-bold text-[#1a1a18]">#{String(l.factura_num).padStart(4, "0")}</td>
                    <td className="py-2 text-xs text-gray-600">{fdate(l.fecha)}</td>
                    <td className="py-2 text-xs text-gray-500 text-right tabular-nums">{fmt(l.balance_antes)}</td>
                    <td className="py-2 text-xs font-bold text-[#1a1a18] text-right tabular-nums">{fmt(l.aplicado)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-2.5 text-right text-xs font-bold text-gray-500 pr-3">Total applied</td>
                  <td className="pt-2.5 text-right text-sm font-black tabular-nums" style={{ color: accent }}>{fmt(totalAplicado)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Estado de cuenta tras el pago */}
            <div className="mt-6 pt-4 border-t border-dashed border-gray-300">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#1a1a18]">Account summary after this payment</div>
                {vencidas > 0 && (
                  <span className="text-[10px] font-bold text-[#b4623f] bg-[#fbeee8] rounded-full px-2 py-0.5 whitespace-nowrap">
                    {vencidas === 1 ? "1 invoice past due" : `${vencidas} invoices past due`}
                  </span>
                )}
              </div>
              {pendientes.length ? (
                <>
                  {pendientes.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-1.5" style={{ borderBottom: "1px solid #eceee7" }}>
                      <span className="text-xs text-gray-600">
                        <span className="font-mono font-bold text-[#1a1a18]">#{String(p.num).padStart(4, "0")}</span>
                        {`  ·  ${fdate(p.fecha)}  ·  ${p.dias} ${p.dias === 1 ? "day" : "days"}`}
                      </span>
                      <span className={`text-xs font-bold tabular-nums ${p.dias > 30 ? "text-[#b4623f]" : "text-[#1a1a18]"}`}>{fmt(p.saldo)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 pt-2.5">
                    <span className="text-sm font-black text-[#1a1a18]">Total outstanding</span>
                    <span className="text-sm font-black text-[#1a1a18] tabular-nums">{fmt(recibo.total_pendiente || 0)}</span>
                  </div>
                </>
              ) : (
                <div className="bg-[#eaf0e6] rounded-xl px-3 py-2.5 text-center text-xs font-bold text-green-700">
                  No outstanding balance — account paid in full.
                </div>
              )}
            </div>

            {/* Firma */}
            {(empresa.doc_show_signature ?? true) && (
              <div className="flex items-end justify-between gap-8 mt-8">
                <div className="text-[11px] italic text-gray-500">Thank you for your business.</div>
                <div className="w-40">
                  <div className="border-b border-gray-400 h-8" />
                  <div className="text-[9px] text-gray-400 text-center mt-1">Received by</div>
                </div>
              </div>
            )}

            {empresa.mensaje_recibo && (
              <p className="mt-4 mx-auto max-w-md text-xs italic text-gray-500 bg-[#f2f4ee] rounded-lg px-3 py-2 text-center">
                {empresa.mensaje_recibo}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
