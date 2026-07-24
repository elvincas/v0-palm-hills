// PDF de quotation generado en el servidor — ver app/api/ordenes/[id]/pdf,
// mismo patron. Mas simple que estimate/invoice: no hay descuento de lista
// de precios que revelar (una cotizacion siempre guarda su precio final tal
// cual, no hay ajuste manual posterior).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderDocumentoPdf, LineaDoc } from "@/lib/pdf/documento-pdf";
import { EMPRESA_DEFAULT, empresaContacto, FONT_SCALE_FACTOR } from "@/lib/empresa";

export const runtime = "nodejs";

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

interface LineaCotizacion extends LineaDoc {
  prodId?: string;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: cot, error } = await supabase.from("cotizaciones").select("*").eq("id", id).single();
  if (error || !cot) {
    return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  }

  const { data: c } = await supabase
    .from("clientes")
    .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel")
    .eq("nom", cot.cli)
    .maybeSingle();

  const { data: empresaRow } = await supabase.from("empresa").select("*").eq("id", 1).maybeSingle();
  const empresa = empresaRow || EMPRESA_DEFAULT;

  let logo: Buffer | undefined;
  try {
    if (empresa.logo) {
      logo = Buffer.from(empresa.logo.split(",")[1] || "", "base64");
    } else {
      const logoRes = await fetch(new URL("/logo.png", request.url));
      if (logoRes.ok) logo = Buffer.from(await logoRes.arrayBuffer());
    }
  } catch { /* sin logo */ }

  const lineas: LineaDoc[] = ((cot.lineas || []) as LineaCotizacion[])
    .map((l) => ({
      prodNom: l.prodNom,
      sku: l.sku,
      qty: l.qty,
      precio: l.precio,
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
    tipo: "quotation",
    num: cot.num,
    fecha: fdate(cot.fecha),
    cliente: {
      nom: c?.nom || cot.cli,
      codigo: c?.codigo_cliente || undefined,
      dir: [c?.dir, c?.ciudad, c?.estado_dir].filter(Boolean).join(", ") || undefined,
      tel: c?.tel || undefined,
    },
    lineas,
    total,
    logo,
    empresaNombre: empresa.nombre,
    empresaEslogan: empresa.eslogan || undefined,
    empresaContacto: empresaContacto(empresa) || undefined,
    mensaje: empresa.mensaje_cotizacion || undefined,
    validoHasta: cot.valido_hasta ? fdate(cot.valido_hasta) : undefined,
    logoPos: empresa.doc_logo_pos || "left",
    fontScale: FONT_SCALE_FACTOR[empresa.doc_font_scale || "normal"],
    accentColor: empresa.doc_accent_color || undefined,
    showDisclaimer: empresa.doc_show_disclaimer ?? true,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Quotation-${cot.num}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
