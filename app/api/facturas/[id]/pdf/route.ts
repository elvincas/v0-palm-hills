// PDF de factura generado en el servidor con paginacion exacta.
// El motor de impresion de iOS/Safari no respeta cortes de pagina ni repite
// headers, asi que el documento imprimible es este PDF, no window.print().
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderDocumentoPdf, LineaDoc } from "@/lib/pdf/documento-pdf";

export const runtime = "nodejs";

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Si se pide revelar el descuento de la lista de precios (catalogo -> lista),
  // ademas del ajuste manual por linea que siempre se muestra. Decidido en la
  // pantalla de la factura, no aqui: ?listDiscount=1|0, default 0 (comportamiento historico).
  const mostrarDescuentoLista = new URL(request.url).searchParams.get("listDiscount") === "1";
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: f, error } = await supabase.from("facturas").select("*").eq("id", id).single();
  if (error || !f) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const { data: c } = await supabase
    .from("clientes")
    .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel")
    .eq("nom", f.cli)
    .maybeSingle();

  let logo: Buffer | undefined;
  try {
    const logoRes = await fetch(new URL("/logo.png", request.url));
    if (logoRes.ok) logo = Buffer.from(await logoRes.arrayBuffer());
  } catch { /* sin logo */ }

  type LineaFacturaRow = LineaDoc & { precioCatalogo?: number };
  const lineas = [...((f.lineas || []) as LineaFacturaRow[])]
    .sort((a, b) => {
      const sa = (a.sku || "").trim();
      const sb = (b.sku || "").trim();
      if (!sa && sb) return 1;
      if (sa && !sb) return -1;
      return sa.localeCompare(sb, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
    })
    .map((l): LineaDoc => ({
      prodNom: l.prodNom,
      sku: l.sku,
      qty: l.qty,
      precio: l.precio,
      precioOriginal: mostrarDescuentoLista ? l.precioCatalogo ?? l.precioOriginal : l.precioOriginal,
    }));

  // Fecha del ultimo pago + metodos usados (para el sello PAID del PDF)
  const pagos = (f.pagos || []) as { monto: number; fecha: string; metodo?: string }[];
  const ultimoPago = pagos.length ? pagos.reduce((a, b) => (a.fecha >= b.fecha ? a : b)) : null;
  const metodos = Array.from(new Set(pagos.map((p) => p.metodo).filter(Boolean))) as string[];

  const pdf = await renderDocumentoPdf({
    tipo: "invoice",
    num: f.num,
    fecha: fdate(f.fecha),
    estado: f.estado,
    pagoInfo: f.estado === "Paid" && ultimoPago ? { fecha: fdate(ultimoPago.fecha), metodos } : undefined,
    cliente: {
      nom: c?.nom || f.cli,
      codigo: c?.codigo_cliente || undefined,
      dir: [c?.dir, c?.ciudad, c?.estado_dir].filter(Boolean).join(", ") || undefined,
      tel: c?.tel || undefined,
    },
    lineas,
    total: Number(f.total),
    totalPagado: ((f.pagos || []) as { monto: number }[]).reduce((a, p) => a + p.monto, 0),
    logo,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice-${String(f.num).padStart(4, "0")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
