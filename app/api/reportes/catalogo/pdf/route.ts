// PDF del catalogo de productos — ver app/api/facturas/[id]/pdf, mismo patron.
// A diferencia de los otros reportes, este recibe los productos (y sus fotos
// ya reducidas a miniatura) por POST desde el cliente en vez de consultar la
// base: el cliente ya tiene `productos` cargado via DataContext, y redimensiona
// las fotos con canvas antes de enviarlas (@react-pdf no recomprime imagenes,
// asi que enviar las fotos completas de miles de productos generaria un PDF
// de cientos de MB).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderCatalogoPdf, ProductoCatalogo } from "@/lib/pdf/catalogo-pdf";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    conPrecio: boolean;
    conFotos: boolean;
    almacenLabel: string;
    productos: ProductoCatalogo[];
  };

  const pdf = await renderCatalogoPdf({
    fechaGeneracion: new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
    almacenLabel: body.almacenLabel,
    conPrecio: body.conPrecio,
    conFotos: body.conFotos,
    productos: body.productos || [],
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Product-Catalog.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
