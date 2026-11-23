// PDF de la nota de credito. Mismo patron que /api/recibos/[id]/pdf: se genera
// en el servidor porque window.print() no funciona en Safari de iPhone.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderNotaCreditoPdf, LineaNotaCredito } from "@/lib/pdf/cuenta-pdf";
import { EMPRESA_DEFAULT, empresaContacto } from "@/lib/empresa";

export const runtime = "nodejs";

const fdate = (s?: string | null) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: n, error } = await supabase.from("notas_credito").select("*").eq("id", id).single();
  if (error || !n) {
    return NextResponse.json({ error: "Credit note not found" }, { status: 404 });
  }

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

  const lineas: LineaNotaCredito[] =
    n.tipo === "product"
      ? ((n.lineas || []) as LineaNotaCredito[]).map((l) => ({
          prodNom: l.prodNom || "",
          sku: l.sku || undefined,
          qty: Number(l.qty),
          precio: Number(l.precio),
        }))
      : [];

  const pdf = await renderNotaCreditoPdf({
    num: n.num,
    fecha: fdate(n.fecha),
    cliente: n.cli,
    monto: Number(n.monto),
    motivo: n.motivo || undefined,
    lineas,
    aplicada: !!n.aplicada,
    aplicadaEn: n.aplicada_en || undefined,
    aplicadaFecha: fdate(n.aplicada_fecha) || undefined,
    mensaje: empresa.mensaje_nota_credito || undefined,
    logo,
    empresaNombre: empresa.nombre,
    empresaContacto: empresaContacto(empresa) || undefined,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="CreditNote-${String(n.num).padStart(3, "0")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
