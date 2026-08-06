// PDF del recibo de pago. Mismo patron que /api/facturas/[id]/pdf: se genera
// en el servidor con @react-pdf porque el motor de impresion de iOS/Safari no
// respeta cortes de pagina ni repite headers.
//
// Aqui NO se recalcula nada del estado de cuenta: el recibo guarda su propio
// snapshot (`pendientes`/`total_pendiente`) al emitirse, asi reimprimir uno
// viejo entrega el mismo papel que se le dio al cliente ese dia.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderReciboPdf, LineaRecibo, PendienteRecibo } from "@/lib/pdf/recibo-pdf";
import { EMPRESA_DEFAULT, empresaContacto, FONT_SCALE_FACTOR } from "@/lib/empresa";

export const runtime = "nodejs";

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

// Dias entre dos fechas YYYY-MM-DD (mediodia para que el timezone no corra el dia)
const diasEntre = (desde: string, hasta: string) => {
  const a = new Date(`${desde}T12:00:00`).getTime();
  const b = new Date(`${hasta}T12:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
};

interface LineaRow { factura_id?: string; factura_num: number; fecha: string; balance_antes: number; aplicado: number }
interface PendienteRow { num: number; fecha: string; saldo: number }

// Muchos clientes tienen la direccion completa escrita en `dir` (con ciudad y
// estado adentro): concatenar ciudad/estado a ciegas imprime "Passaic, NJ" dos
// veces. Se omite lo que ya aparece en `dir`.
const direccionCliente = (c?: { dir?: string | null; ciudad?: string | null; estado_dir?: string | null } | null) => {
  const dir = (c?.dir || "").trim();
  const extra = [c?.ciudad, c?.estado_dir]
    .filter(Boolean)
    .filter((x) => !dir.toLowerCase().includes(String(x).toLowerCase()));
  return [dir, ...extra].filter(Boolean).join(", ") || undefined;
};

// La nota que la app escribe sola al usar el boton "Paid" es contabilidad
// interna, no una referencia del cliente: no va en su recibo.
const NOTA_AUTOMATICA = "Marked as fully paid";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: r, error } = await supabase.from("recibos").select("*").eq("id", id).single();
  if (error || !r) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const { data: c } = await supabase
    .from("clientes")
    .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel")
    .eq("nom", r.cli)
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

  const lineas: LineaRecibo[] = ((r.lineas || []) as LineaRow[]).map((l) => ({
    facturaNum: Number(l.factura_num),
    fecha: fdate(l.fecha),
    balanceAntes: Number(l.balance_antes),
    aplicado: Number(l.aplicado),
  }));

  // La antiguedad se mide contra la FECHA DEL RECIBO, no contra hoy: es parte
  // del snapshot, el papel no envejece despues de entregado.
  const pendientes: PendienteRecibo[] = ((r.pendientes || []) as PendienteRow[])
    .map((p) => ({
      num: Number(p.num),
      fecha: fdate(p.fecha),
      saldo: Number(p.saldo),
      dias: diasEntre(p.fecha, r.fecha),
    }))
    .sort((a, b) => b.dias - a.dias);

  const pdf = await renderReciboPdf({
    num: r.num,
    fecha: fdate(r.fecha),
    cliente: {
      nom: c?.nom || r.cli,
      codigo: c?.codigo_cliente || undefined,
      dir: direccionCliente(c),
      tel: c?.tel || undefined,
    },
    monto: Number(r.monto),
    metodo: r.metodo || undefined,
    nota: r.nota && r.nota !== NOTA_AUTOMATICA ? r.nota : undefined,
    lineas,
    pendientes,
    totalPendiente: Number(r.total_pendiente || 0),
    logo,
    empresaNombre: empresa.nombre,
    empresaEslogan: empresa.eslogan || undefined,
    empresaContacto: empresaContacto(empresa) || undefined,
    mensaje: empresa.mensaje_recibo || undefined,
    logoPos: empresa.doc_logo_pos || "left",
    fontScale: FONT_SCALE_FACTOR[empresa.doc_font_scale || "normal"],
    accentColor: empresa.doc_accent_color || undefined,
    showSignature: empresa.doc_show_signature ?? true,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Receipt-${String(r.num).padStart(4, "0")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
