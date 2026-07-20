// PDF del reporte de cartera (facturas Pending/Partially Paid por antiguedad).
// Ver app/api/facturas/[id]/pdf — mismo patron server-side con @react-pdf.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderReporteCarteraPdf, FilaReporteCartera, GrupoReporteCartera } from "@/lib/pdf/reporte-cartera-pdf";

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

  const total = filas.reduce((a, f) => a + f.saldo, 0);

  let grupos: GrupoReporteCartera[] = [];
  if (modo === "grouped") {
    const porCliente = new Map<string, FilaReporteCartera[]>();
    for (const f of filas) {
      if (!porCliente.has(f.cliNom)) porCliente.set(f.cliNom, []);
      porCliente.get(f.cliNom)!.push(f);
    }
    grupos = Array.from(porCliente.entries())
      .map(([cliNom, filasCliente]) => ({
        cliNom,
        filas: filasCliente,
        subtotal: +filasCliente.reduce((a, f) => a + f.saldo, 0).toFixed(2),
      }))
      // Clientes con la factura pendiente mas vieja primero (prioridad pedida)
      .sort((a, b) => b.filas[0].dias - a.filas[0].dias);
  }

  const pdf = await renderReporteCarteraPdf({
    fechaGeneracion: fdate(hoyStr()),
    modo,
    filas,
    grupos,
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
