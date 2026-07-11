// PDF de estimate (orden) generado en el servidor — ver app/api/facturas/[id]/pdf.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderDocumentoPdf, LineaDoc } from "@/lib/pdf/documento-pdf";

export const runtime = "nodejs";

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

interface LineaOrden extends LineaDoc {
  precioFinal?: number;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: o, error } = await supabase.from("ordenes").select("*").eq("id", id).single();
  if (error || !o) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // El cliente puede estar guardado por id (ordenes nuevas) o por nombre
  const cols = "nom, codigo_cliente, dir, ciudad, estado_dir, tel";
  let { data: c } = await supabase.from("clientes").select(cols).eq("id", o.cli).maybeSingle();
  if (!c) {
    const res = await supabase.from("clientes").select(cols).eq("nom", o.cli).maybeSingle();
    c = res.data;
  }

  let logo: Buffer | undefined;
  try {
    const logoRes = await fetch(new URL("/logo.png", request.url));
    if (logoRes.ok) logo = Buffer.from(await logoRes.arrayBuffer());
  } catch { /* sin logo */ }

  // En ordenes el descuento viene como precioFinal; el PDF espera
  // precio = final y precioOriginal = antes del descuento.
  const lineas: LineaDoc[] = [...((o.lineas || []) as LineaOrden[])]
    .map((l) => ({
      prodNom: l.prodNom,
      sku: l.sku,
      qty: l.qty,
      precio: l.precioFinal ?? l.precio,
      precioOriginal: l.precioFinal !== undefined && l.precioFinal !== l.precio ? l.precio : undefined,
    }))
    .sort((a, b) => {
      const sa = (a.sku || "").trim();
      const sb = (b.sku || "").trim();
      if (!sa && sb) return 1;
      if (sa && !sb) return -1;
      return sa.localeCompare(sb, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
    });

  const total = lineas.reduce((a, l) => a + l.qty * l.precio, 0);

  const pdf = await renderDocumentoPdf({
    tipo: "estimate",
    num: o.num,
    fecha: fdate(o.fecha),
    cliente: {
      nom: c?.nom || o.cli,
      codigo: c?.codigo_cliente || undefined,
      dir: [c?.dir, c?.ciudad, c?.estado_dir].filter(Boolean).join(", ") || undefined,
      tel: c?.tel || undefined,
    },
    lineas,
    total,
    logo,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Estimate-Order${o.num}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
