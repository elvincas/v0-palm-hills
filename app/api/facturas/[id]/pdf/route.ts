// PDF de factura generado en el servidor con paginacion exacta.
// El motor de impresion de iOS/Safari no respeta cortes de pagina ni repite
// headers, asi que el documento imprimible es este PDF, no window.print().
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderDocumentoPdf, LineaDoc } from "@/lib/pdf/documento-pdf";
import { EMPRESA_DEFAULT, empresaContacto } from "@/lib/empresa";

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

  type LineaFacturaRow = LineaDoc & { precioCatalogo?: number; almacen?: string };
  const lineasFactura = (f.lineas || []) as LineaFacturaRow[];

  // Facturas viejas (previas a este cambio) no tienen precioCatalogo guardado
  // por linea: se completa buscando el producto por SKU+almacen (o nombre).
  const lineasFaltantes = lineasFactura.filter((l) => l.precioCatalogo === undefined);
  const catalogoPorSku: Record<string, number> = {};
  const catalogoPorNom: Record<string, number> = {};
  if (lineasFaltantes.length) {
    const skus = Array.from(new Set(lineasFaltantes.map((l) => (l.sku || "").trim()).filter(Boolean)));
    const noms = Array.from(new Set(lineasFaltantes.map((l) => l.prodNom).filter(Boolean)));
    const [porSku, porNom] = await Promise.all([
      skus.length
        ? supabase.from("productos").select("sku, nom, almacen, precio").in("sku", skus)
        : Promise.resolve({ data: [] as never[] }),
      noms.length
        ? supabase.from("productos").select("sku, nom, almacen, precio").in("nom", noms)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const prods = [...(porSku.data || []), ...(porNom.data || [])] as {
      sku: string | null; nom: string; almacen: string | null; precio: number;
    }[];
    for (const p of prods) {
      if (p.sku) catalogoPorSku[`${p.sku.trim().toLowerCase()}|${p.almacen || "palmhills"}`] = Number(p.precio);
      catalogoPorNom[p.nom] = Number(p.precio);
    }
  }

  const lineas = [...lineasFactura]
    .sort((a, b) => {
      const sa = (a.sku || "").trim();
      const sb = (b.sku || "").trim();
      if (!sa && sb) return 1;
      if (sa && !sb) return -1;
      return sa.localeCompare(sb, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
    })
    .map((l): LineaDoc => {
      const key = `${(l.sku || "").trim().toLowerCase()}|${l.almacen || "palmhills"}`;
      const precioCatalogo = l.precioCatalogo ?? catalogoPorSku[key] ?? catalogoPorNom[l.prodNom];
      return {
        prodNom: l.prodNom,
        sku: l.sku,
        qty: l.qty,
        precio: l.precio,
        precioOriginal: mostrarDescuentoLista ? precioCatalogo ?? l.precioOriginal : l.precioOriginal,
      };
    });

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
    empresaNombre: empresa.nombre,
    empresaContacto: empresaContacto(empresa) || undefined,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice-${String(f.num).padStart(4, "0")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
