"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Factura {
  num: number;
  cli: string;
  fecha: string;
  total: number;
  pagos?: { monto: number }[];
}

interface Fila {
  cliNom: string;
  facturaNum: number;
  fecha: string;
  dias: number;
  saldo: number;
}

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

const hoyStr = () => new Date().toISOString().split("T")[0];

const diasDesde = (fecha: string) => {
  const ms = new Date(hoyStr() + "T00:00:00").getTime() - new Date(fecha + "T00:00:00").getTime();
  return Math.max(0, Math.round(ms / 86400000));
};

const TAB_BTN = "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl border shadow-[0_1px_2px_rgba(28,31,25,0.04)] active:scale-[0.97] transition-all";
const TAB_LBL = "text-[9px] font-bold leading-none truncate max-w-full px-0.5";

const Icon = ({ d }: { d: string }) => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split("|").map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const IC_PRINT = "M6 9V4h12v5|M6 13h12v8H6z|M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2";
const IC_BACK = "M15 18l-6-6 6-6";

export default function ReporteFacturasPendientesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modo, setModo] = useState<"flat" | "grouped">("flat");
  const [generandoPdf, setGenerandoPdf] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data, error: err } = await supabase
        .from("facturas")
        .select("num, cli, fecha, total, pagos")
        .in("estado", ["Pending", "Partially Paid"]);
      if (err) {
        setError("Couldn't load pending invoices.");
        setLoading(false);
        return;
      }
      const rows: Fila[] = ((data || []) as Factura[]).map((f) => {
        const pagado = (f.pagos || []).reduce((a, p) => a + Number(p.monto || 0), 0);
        return {
          cliNom: f.cli,
          facturaNum: f.num,
          fecha: f.fecha,
          dias: diasDesde(f.fecha),
          saldo: +(Number(f.total) - pagado).toFixed(2),
        };
      });
      rows.sort((a, b) => b.dias - a.dias);
      setFilas(rows);
      setLoading(false);
    };
    load();
  }, [supabase]);

  const grupos = useMemo(() => {
    const porCliente = new Map<string, Fila[]>();
    for (const f of filas) {
      if (!porCliente.has(f.cliNom)) porCliente.set(f.cliNom, []);
      porCliente.get(f.cliNom)!.push(f);
    }
    return Array.from(porCliente.entries())
      .map(([cliNom, filasCliente]) => ({
        cliNom,
        filas: filasCliente,
        subtotal: filasCliente.reduce((a, f) => a + f.saldo, 0),
      }))
      .sort((a, b) => b.filas[0].dias - a.filas[0].dias);
  }, [filas]);

  const total = filas.reduce((a, f) => a + f.saldo, 0);

  const abrirPdf = async () => {
    if (generandoPdf) return;
    setGenerandoPdf(true);
    try {
      const res = await fetch(`/api/reportes/facturas-pendientes/pdf?groupBy=${modo === "grouped" ? "client" : "flat"}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `Aging-Report-${hoyStr()}.pdf`, { type: "application/pdf" });
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

  const FilaRow = ({ f, showCliente }: { f: Fila; showCliente: boolean }) => {
    const vencida = f.dias > 30;
    return (
      <div className={`grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2.5 ${vencida ? "bg-red-50/60" : ""}`}>
        <div className="min-w-0">
          {showCliente && <div className="text-sm font-semibold text-card-foreground truncate">{f.cliNom}</div>}
          <div className="text-xs font-mono text-muted-foreground">#{String(f.facturaNum).padStart(4, "0")} · {fdate(f.fecha)}</div>
        </div>
        <div className={`text-xs font-bold text-right whitespace-nowrap ${vencida ? "text-red-600" : "text-muted-foreground"}`}>
          {f.dias}d
        </div>
        <div className="text-sm font-bold text-card-foreground text-right whitespace-nowrap">{fmt(f.saldo)}</div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div
          className="max-w-3xl mx-auto px-4 sm:px-8 py-2.5 flex items-stretch gap-1.5"
          style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
        >
          <button onClick={() => (window.history.length > 1 ? router.back() : router.push("/?tab=fact"))} className={`${TAB_BTN} bg-white text-[#4a6741] border-[#e3e7dd]`}>
            <Icon d={IC_BACK} />
            <span className={TAB_LBL}>Back</span>
          </button>
          <button
            onClick={abrirPdf}
            disabled={generandoPdf}
            className={`${TAB_BTN} bg-[#4a6741] text-white border-[#4a6741] disabled:opacity-60`}
          >
            <Icon d={IC_PRINT} />
            <span className={TAB_LBL}>{generandoPdf ? "..." : "Print / PDF"}</span>
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-8 pt-4">
        <h1 className="text-lg font-bold text-card-foreground mb-1">Aging Report</h1>
        <p className="text-xs text-muted-foreground mb-4">Pending & partially paid invoices, oldest first.</p>

        <div className="inline-flex bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5 mb-4">
          <button onClick={() => setModo("flat")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${modo === "flat" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
            By age
          </button>
          <button onClick={() => setModo("grouped")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${modo === "grouped" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
            By client
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        ) : error ? (
          <p className="text-sm text-destructive text-center py-8">{error}</p>
        ) : filas.length === 0 ? (
          <div className="bg-card rounded-2xl p-6 border border-border text-center text-sm text-muted-foreground">
            No pending invoices. 🎉
          </div>
        ) : modo === "flat" ? (
          <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
            {filas.map((f, i) => (
              <FilaRow key={i} f={f} showCliente />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {grupos.map((g, gi) => (
              <div key={gi} className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/40">
                  <span className="text-sm font-bold text-card-foreground">{g.cliNom}</span>
                  <span className="text-sm font-bold text-primary">{fmt(g.subtotal)}</span>
                </div>
                <div className="divide-y divide-border">
                  {g.filas.map((f, i) => (
                    <FilaRow key={i} f={f} showCliente={false} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && filas.length > 0 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-sm font-bold text-card-foreground">Total outstanding</span>
            <span className="text-lg font-black text-primary">{fmt(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
