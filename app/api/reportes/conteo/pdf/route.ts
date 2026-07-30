// Hoja de conteo fisico — mismo patron que /api/reportes/catalogo/pdf: recibe
// los productos ya filtrados y agrupados por POST desde el cliente (que ya los
// tiene cargados via DataContext) en vez de volver a consultarlos aqui.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderConteoPdf, GrupoConteo } from "@/lib/pdf/conteo-pdf";
import { EMPRESA_DEFAULT, empresaContacto } from "@/lib/empresa";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    almacenLabel: string;
    conSistema: boolean;
    grupos: GrupoConteo[];
  };

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
  } catch {
    /* sin logo */
  }

  const pdf = await renderConteoPdf({
    fechaGeneracion: new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
    almacenLabel: body.almacenLabel,
    conSistema: !!body.conSistema,
    grupos: body.grupos || [],
    empresaNombre: empresa.nombre,
    empresaContacto: empresaContacto(empresa) || undefined,
    logo,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Physical-Count.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
