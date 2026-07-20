// PDF del reporte de cartera (facturas Pending/Partially Paid por antiguedad).
// Ver app/api/facturas/[id]/pdf — mismo patron server-side con @react-pdf.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderReporteCarteraPdf, FilaReporteCartera, GrupoReporteCartera, NotaCreditoReporte } from "@/lib/pdf/reporte-cartera-pdf";

export const runtime = "nodejs";

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

export async function GET(request: NextRequest) {
  const modo = new URL(request.url).searchParams.get("groupBy") === "client" ? "grouped" : "flat";
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: facturas, error } = await supabase
    .from("facturas")
    .select("num, cli, fecha, total, estado, pagos")
    .in("estado", ["Pending", "Partially Paid"]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type FacturaRow = { num: number; cli: string; fecha: string; total: number; pagos: { monto: number }[] | null };
  const filas: FilaReporteCartera[] = ((facturas || []) as FacturaRow[]).map((f) => {
    const pagado = (f.pagos || []).reduce((a, p) => a + Number(p.monto || 0), 0);
    return {
      cliNom: f.cli,
      facturaNum: f.num,
      fecha: fdate(f.fecha),
      dias: diasDesde(f.fecha),
      saldo: +(Number(f.total) - pagado).toFixed(2),
    };
  });
  filas.sort((a, b) => b.dias - a.dias);

  const totalBruto = filas.reduce((a, f) => a + f.saldo, 0);

  // Notas de credito no aplicadas: solo las de clientes que aparecen en esta
  // cartera (si ya no debe nada, la NC no es relevante para el reporte).
  const clientesConSaldo = Array.from(new Set(filas.map((f) => f.cliNom)));
  let creditosFlat: NotaCreditoReporte[] = [];
  if (clientesConSaldo.length) {
    const { data: ncData } = await supabase
      .from("notas_credito")
      .select("cli, num, monto, motivo, aplicada")
      .in("cli", clientesConSaldo);
    type NcRow = { cli: string; num: number; monto: number; motivo?: string; aplicada?: boolean };
    creditosFlat = ((ncData || []) as NcRow[])
      .filter((n) => !n.aplicada)
      .map((n) => ({ cliNom: n.cli, num: n.num, monto: Number(n.monto), motivo: n.motivo }));
  }
  const totalCreditos = creditosFlat.reduce((a, c) => a + c.monto, 0);
  const total = totalBruto - totalCreditos;

  let grupos: GrupoReporteCartera[] = [];
  if (modo === "grouped") {
    const creditosPorCliente = new Map<string, NotaCreditoReporte[]>();
    for (const c of creditosFlat) {
      if (!creditosPorCliente.has(c.cliNom)) creditosPorCliente.set(c.cliNom, []);
      creditosPorCliente.get(c.cliNom)!.push(c);
    }
    const porCliente = new Map<string, FilaReporteCartera[]>();
    for (const f of filas) {
      if (!porCliente.has(f.cliNom)) porCliente.set(f.cliNom, []);
      porCliente.get(f.cliNom)!.push(f);
    }
    grupos = Array.from(porCliente.entries())
      .map(([cliNom, filasCliente]) => {
        const subtotal = +filasCliente.reduce((a, f) => a + f.saldo, 0).toFixed(2);
        const creditosCliente = creditosPorCliente.get(cliNom) || [];
        const totalCreditosCliente = creditosCliente.reduce((a, c) => a + c.monto, 0);
        return {
          cliNom,
          filas: filasCliente,
          subtotal,
          creditos: creditosCliente,
          subtotalNeto: +(subtotal - totalCreditosCliente).toFixed(2),
        };
      })
      // Clientes con la factura pendiente mas vieja primero (prioridad pedida)
      .sort((a, b) => b.filas[0].dias - a.filas[0].dias);
  }

  const pdf = await renderReporteCarteraPdf({
    fechaGeneracion: fdate(hoyStr()),
    modo,
    filas,
    grupos,
    creditosFlat,
    totalBruto: +totalBruto.toFixed(2),
    totalCreditos: +totalCreditos.toFixed(2),
    total: +total.toFixed(2),
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Aging-Report-${hoyStr()}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
