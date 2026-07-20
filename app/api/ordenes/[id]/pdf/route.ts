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
  prodId?: string;
  precioFinal?: number;
  precioCatalogo?: number;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Revela el descuento de la lista de precios (catalogo -> lista) ademas del
  // ajuste manual, decidido en la pantalla del estimate: ?listDiscount=1|0.
  const mostrarDescuentoLista = new URL(request.url).searchParams.get("listDiscount") === "1";
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

  // Ordenes viejas (previas a este cambio) no tienen precioCatalogo guardado
  // por linea: se completa con el precio actual del producto.
  const lineasOrden = (o.lineas || []) as LineaOrden[];
  const idsFaltantes = Array.from(
    new Set(lineasOrden.filter((l) => l.precioCatalogo === undefined && l.prodId).map((l) => l.prodId as string))
  );
  let catalogoPrecios: Record<string, number> = {};
  if (idsFaltantes.length) {
    const { data: prods } = await supabase.from("productos").select("id, precio").in("id", idsFaltantes);
    if (prods) {
      catalogoPrecios = Object.fromEntries(
        (prods as { id: string; precio: number }[]).map((p) => [p.id, Number(p.precio)])
      );
    }
  }

  // En ordenes el descuento viene como precioFinal; el PDF espera
  // precio = final y precioOriginal = antes del descuento. Con el switch
  // encendido, "antes del descuento" es el precio de catalogo puro (revela
  // tambien el descuento de lista); apagado, es l.precio (solo el ajuste manual).
  const lineas: LineaDoc[] = [...lineasOrden]
    .map((l) => {
      const precioFinal = l.precioFinal ?? l.precio;
      const precioCatalogo = l.precioCatalogo ?? (l.prodId ? catalogoPrecios[l.prodId] : undefined);
      const comparado = mostrarDescuentoLista ? precioCatalogo ?? l.precio : l.precio;
      return {
        prodNom: l.prodNom,
        sku: l.sku,
        qty: l.qty,
        precio: precioFinal,
        precioOriginal: comparado !== precioFinal ? comparado : undefined,
      };
    })
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
