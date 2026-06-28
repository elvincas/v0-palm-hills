"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { printOrShare } from "@/lib/print";

interface Cliente {
  nom: string;
  codigo_cliente?: string;
  dir?: string;
  ciudad?: string;
  estado_dir?: string;
  tel?: string;
  email?: string;
}

interface Factura {
  id: string;
  num: number;
  fecha: string;
  estado: string;
  total: number;
}

interface NotaCredito {
  id: string;
  num: number;
  fecha: string;
  monto: number;
  motivo: string;
}

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

const hoy = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
};

export default function EstadoCuentaPage() {
  const params = useParams();
  const router = useRouter();
  const clienteId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [notasCredito, setNotasCredito] = useState<NotaCredito[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data: c, error: cErr } = await supabase
        .from("clientes")
        .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel, email")
        .eq("id", clienteId)
        .single();
      if (cErr || !c) {
        setError("Couldn't load client.");
        setLoading(false);
        return;
      }
      setCliente(c as Cliente);
      document.title = `Statement-${(c as Cliente).nom}`;

      const [{ data: fData }, { data: ncData }] = await Promise.all([
        supabase
          .from("facturas")
          .select("id, num, fecha, estado, total")
          .eq("cli", (c as Cliente).nom)
          .order("num", { ascending: true }),
        supabase
          .from("notas_credito")
          .select("id, num, fecha, monto, motivo")
          .eq("cli", (c as Cliente).nom)
          .order("num", { ascending: true }),
      ]);
      setFacturas((fData as Factura[]) || []);
      setNotasCredito((ncData as NotaCredito[]) || []);
      setLoading(false);
    };
    load();
  }, [clienteId, supabase]);

  if (loading) return <div className="p-6 text-sm text-center text-gray-500">Loading statement...</div>;
  if (error || !cliente) return (
    <div className="p-6 text-center">
      <p className="text-sm text-red-600 mb-3">{error}</p>
      <button onClick={() => router.back()} className="px-4 py-2 rounded-full text-sm font-medium bg-white border border-gray-300 text-gray-700">← Back</button>
    </div>
  );

  const pendingFacturas = facturas.filter(f => !["Paid", "Completed", "Cancelled"].includes(f.estado));
  const totalDeuda = pendingFacturas.reduce((acc, f) => acc + f.total, 0);
  const totalCredito = notasCredito.reduce((acc, n) => acc + n.monto, 0);
  const neto = totalDeuda - totalCredito;

  return (
    <div className="min-h-screen bg-[#f0efe9]">
      {/* Toolbar (hidden on print) */}
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="max-w-3xl mx-auto px-4 py-3.5 flex items-center justify-between" style={{ paddingTop: "calc(0.875rem + env(safe-area-inset-top))" }}>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 rounded-full text-sm font-medium backdrop-blur-md bg-white/50 border border-white/60 shadow-sm hover:bg-white/70 active:scale-[0.97] transition-all text-[#4a6741]"
          >
            ← Back
          </button>
          <button
            onClick={printOrShare}
            className="px-5 py-2 rounded-full backdrop-blur-md bg-[#4a6741]/85 border border-white/30 shadow-md hover:bg-[#4a6741]/95 active:scale-[0.97] transition-all text-white text-sm font-bold"
          >
            🖨️ Print / Save PDF
          </button>
        </div>
      </div>

      {/* Document */}
      <div className="max-w-3xl mx-auto p-4 sm:p-8 print:p-0">
        <div className="bg-white rounded-2xl print:rounded-none shadow-sm print:shadow-none border border-gray-200 print:border-0 overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-6 pb-4 flex items-center justify-between gap-6 border-b-2 border-[#4a6741]">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Palm Hills" className="w-14 h-14 object-contain shrink-0" />
              <div>
                <div className="text-sm font-bold text-[#1a1a18] leading-tight">Palm Hills</div>
                <div className="text-[10px] text-gray-500">📞 (551) 248-3442 &nbsp;·&nbsp; ✉️ admin@palmhillsco.net</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-black tracking-wide text-[#4a6741] uppercase">Account Statement</div>
              <div className="text-xs text-gray-500 mt-0.5">Date: {hoy()}</div>
            </div>
          </div>

          {/* Client info */}
          <div className="px-8 py-4 grid grid-cols-2 gap-6 bg-[#fafaf7] border-b border-gray-100">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">Bill To</div>
              <div className="text-sm font-bold text-[#1a1a18]">{cliente.nom}</div>
              {cliente.codigo_cliente && <div className="text-[10px] font-mono text-gray-400">#{cliente.codigo_cliente}</div>}
              {cliente.dir && <div className="text-[10px] text-gray-600">{[cliente.dir, cliente.ciudad, cliente.estado_dir].filter(Boolean).join(", ")}</div>}
              {cliente.tel && <div className="text-[10px] text-gray-600">📞 {cliente.tel}</div>}
              {cliente.email && <div className="text-[10px] text-gray-600">✉️ {cliente.email}</div>}
            </div>
            <div className="text-right">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">Net Balance Due</div>
              <div className={`text-3xl font-black ${neto > 0 ? "text-amber-700" : "text-green-700"}`}>
                {neto < 0 ? "-" : ""}{fmt(Math.abs(neto))}
              </div>
            </div>
          </div>

          {/* Pending Invoices */}
          <div className="px-8 py-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">Pending Invoices</div>
            {pendingFacturas.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-[#1a1a18] text-left">
                    <th className="pb-2 text-[11px] font-bold uppercase tracking-wide text-[#1a1a18]">Invoice #</th>
                    <th className="pb-2 text-[11px] font-bold uppercase tracking-wide text-[#1a1a18]">Date</th>
                    <th className="pb-2 text-[11px] font-bold uppercase tracking-wide text-[#1a1a18]">Status</th>
                    <th className="pb-2 text-[11px] font-bold uppercase tracking-wide text-[#1a1a18] text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingFacturas.map((f, i) => (
                    <tr key={f.id} className={i % 2 === 0 ? "bg-white" : "bg-[#f5f7f3]"}>
                      <td className="py-2 text-gray-800 font-mono text-xs">#{String(f.num).padStart(3,"0")}</td>
                      <td className="py-2 text-gray-600 text-xs">{fdate(f.fecha)}</td>
                      <td className="py-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          f.estado === "Pending" ? "bg-amber-100 text-amber-700"
                          : f.estado === "Overdue" ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                        }`}>{f.estado}</span>
                      </td>
                      <td className="py-2 text-right font-semibold text-gray-800 text-sm">{fmt(f.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#1a1a18]">
                    <td colSpan={3} className="pt-2 text-sm font-bold text-[#1a1a18]">Subtotal</td>
                    <td className="pt-2 text-right font-bold text-sm text-amber-700">{fmt(totalDeuda)}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="text-sm text-gray-400 italic">No pending invoices.</p>
            )}
          </div>

          {/* Credit Notes */}
          {notasCredito.length > 0 && (
            <div className="px-8 py-5 border-t border-gray-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">Credit Notes Applied</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-[#1a1a18] text-left">
                    <th className="pb-2 text-[11px] font-bold uppercase tracking-wide text-[#1a1a18]">CN #</th>
                    <th className="pb-2 text-[11px] font-bold uppercase tracking-wide text-[#1a1a18]">Date</th>
                    <th className="pb-2 text-[11px] font-bold uppercase tracking-wide text-[#1a1a18]">Reason</th>
                    <th className="pb-2 text-[11px] font-bold uppercase tracking-wide text-[#1a1a18] text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {notasCredito.map((n, i) => (
                    <tr key={n.id} className={i % 2 === 0 ? "bg-white" : "bg-[#f0f7ed]"}>
                      <td className="py-2 text-gray-800 font-mono text-xs">CN-{String(n.num).padStart(3,"0")}</td>
                      <td className="py-2 text-gray-600 text-xs">{fdate(n.fecha)}</td>
                      <td className="py-2 text-gray-600 text-xs">{n.motivo || "—"}</td>
                      <td className="py-2 text-right font-semibold text-green-700 text-sm">−{fmt(n.monto)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#1a1a18]">
                    <td colSpan={3} className="pt-2 text-sm font-bold text-[#1a1a18]">Total Credits</td>
                    <td className="pt-2 text-right font-bold text-sm text-green-700">−{fmt(totalCredito)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Net Summary */}
          <div className="px-8 py-5 border-t-2 border-[#4a6741] bg-[#fafaf7]">
            <div className="flex justify-end">
              <div className="w-64">
                <div className="flex justify-between py-1 text-sm text-gray-600">
                  <span>Total Pending</span>
                  <span className="text-amber-700 font-semibold">{fmt(totalDeuda)}</span>
                </div>
                {totalCredito > 0 && (
                  <div className="flex justify-between py-1 text-sm text-green-700">
                    <span>Credit Notes</span>
                    <span>−{fmt(totalCredito)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2.5 mt-1 border-t-2 border-[#4a6741]">
                  <span className="text-base font-bold text-[#1a1a18]">Balance Due</span>
                  <span className={`text-2xl font-black ${neto > 0 ? "text-amber-700" : "text-green-700"}`}>
                    {neto < 0 ? "-" : ""}{fmt(Math.abs(neto))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 border-t border-gray-200 text-center">
            <p className="text-[10px] text-gray-400">
              This statement is for informational purposes and reflects balances as of {hoy()}. Please contact us with any discrepancies.
            </p>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page { margin: 0.5in; }
          body { background: white !important; }
          tr { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
