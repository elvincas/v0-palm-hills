// PDF del estado de cuenta de un cliente. Mismo patron que
// /api/recibos/[id]/pdf: se genera en el servidor porque window.print() no
// funciona en Safari de iPhone.
//
// Los criterios son los mismos de la pantalla /clientes/[id]/estado-cuenta:
// facturas abiertas con saldo (total menos pagos) y notas de credito sin
// aplicar (las aplicadas ya viven como pago dentro de su factura).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderEstadoCuentaPdf } from "@/lib/pdf/cuenta-pdf";
import { EMPRESA_DEFAULT, empresaContacto } from "@/lib/empresa";

export const runtime = "nodejs";

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

// Misma regla que el recibo: muchos clientes tienen ciudad y estado ya
// escritos dentro de `dir`, no se repiten.
const direccionCliente = (c: { dir?: string | null; ciudad?: string | null; estado_dir?: string | null }) => {
  const dir = (c.dir || "").trim();
  const extra = [c.ciudad, c.estado_dir]
    .filter(Boolean)
    .filter((x) => !dir.toLowerCase().includes(String(x).toLowerCase()));
  return [dir, ...extra].filter(Boolean).join(", ") || undefined;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: c, error } = await supabase
    .from("clientes")
    .select("nom, codigo_cliente, dir, ciudad, estado_dir, tel, email")
    .eq("id", id)
    .single();
  if (error || !c) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const [{ data: fData }, { data: ncData }, { data: empresaRow }] = await Promise.all([
    supabase.from("facturas").select("num, fecha, estado, total, pagos").eq("cli", c.nom).order("num", { ascending: true }),
    supabase.from("notas_credito").select("num, fecha, monto, motivo, aplicada").eq("cli", c.nom).order("num", { ascending: true }),
    supabase.from("empresa").select("*").eq("id", 1).maybeSingle(),
  ]);
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

  const facturas = (fData || [])
    .filter((f) => !["Paid", "Completed", "Cancelled"].includes(f.estado))
    .map((f) => ({
      num: Number(f.num),
      fecha: fdate(f.fecha),
      estado: f.estado as string,
      saldo: Math.max(
        0,
        Number(f.total) - ((f.pagos || []) as { monto: number }[]).reduce((a, p) => a + Number(p.monto), 0),
      ),
    }))
    .filter((f) => f.saldo > 0);

  const creditos = (ncData || [])
    .filter((n) => !n.aplicada)
    .map((n) => ({ num: Number(n.num), fecha: fdate(n.fecha), motivo: n.motivo || undefined, monto: Number(n.monto) }));

  // "Hoy" lo manda el telefono (?fecha=YYYY-MM-DD): el servidor corre en UTC y
  // de noche ya estaria en el dia siguiente. Sin el parametro, hora de NJ.
  const q = request.nextUrl.searchParams.get("fecha") || "";
  const hoy = /^\d{4}-\d{2}-\d{2}$/.test(q)
    ? q
    : new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  const pdf = await renderEstadoCuentaPdf({
    fecha: fdate(hoy),
    cliente: {
      nom: c.nom,
      codigo: c.codigo_cliente || undefined,
      dir: direccionCliente(c),
      tel: c.tel || undefined,
      email: c.email || undefined,
    },
    facturas,
    creditos,
    logo,
    empresaNombre: empresa.nombre,
    empresaContacto: empresaContacto(empresa) || undefined,
  });

  const archivo = `Statement-${c.nom.replace(/[^\w-]+/g, "_")}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${archivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
