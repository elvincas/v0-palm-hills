// Test local del PDF de catalogo: usa productos reales de la DB (con y sin
// fotos) para verificar que ambos layouts (grid con fotos / tabla sin fotos)
// generen correctamente.
//
// El test de grid usa las fotos A TAMAÑO COMPLETO (24 productos = ~6.4MB) a
// proposito: demuestra por que la app real reduce cada foto a ~160px en el
// navegador (canvas) ANTES de mandarla a este renderer — @react-pdf embeda
// los bytes de la imagen tal cual, sin recomprimir. Con miniaturas reales
// (~5-10KB c/u) un catalogo de miles de productos pesa decenas de MB, no
// cientos.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { renderCatalogoPdf, ProductoCatalogo } from "../lib/pdf/catalogo-pdf";

const ROOT = join(__dirname, "..");

async function sql(query: string) {
  const env = readFileSync(join(ROOT, ".env.local"), "utf8");
  const token = env.match(/SUPABASE_ACCESS_TOKEN=(.+)/)?.[1]?.trim();
  if (!token) throw new Error("Sin token");
  const res = await fetch("https://api.supabase.com/v1/projects/fpzurpkszplgqarpozmt/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const [empresaRow] = await sql("SELECT nombre, logo, telefono, email FROM empresa WHERE id = 1");
  const logo: Buffer | undefined = empresaRow?.logo
    ? Buffer.from(String(empresaRow.logo).split(",")[1] || "", "base64")
    : undefined;
  const empresaContacto = [empresaRow?.telefono, empresaRow?.email].filter(Boolean).join("  ·  ") || undefined;
  const empresaNombre = empresaRow?.nombre || "Palm Hills";

  // Tabla sin fotos: 40 productos random para verificar el layout de tabla rapido
  const sinFotos = await sql(
    "SELECT nom, sku, precio, fabricante, almacen FROM productos ORDER BY sku LIMIT 40"
  );
  console.log(`Productos (sin fotos): ${sinFotos.length}`);
  const productosTabla: ProductoCatalogo[] = sinFotos.map((p: { nom: string; sku: string; precio: string; fabricante?: string }) => ({
    nom: p.nom, sku: p.sku, precio: Number(p.precio), fabricante: p.fabricante || undefined,
  }));
  const bufTabla = await renderCatalogoPdf({
    fechaGeneracion: "07/24/2026",
    almacenLabel: "Both Warehouses",
    conPrecio: true,
    conFotos: false,
    productos: productosTabla,
    empresaNombre,
    empresaContacto,
    logo,
  });
  writeFileSync(join(__dirname, "test-catalogo-tabla.pdf"), bufTabla);
  console.log(`Tabla PDF: ${(bufTabla.length / 1024).toFixed(0)} KB`);

  // Grid con fotos: solo productos que SI tienen foto, limitado a 24 para que
  // el test corra rapido (la app real puede generar miles).
  const conFotosRows = await sql(
    "SELECT nom, sku, precio, fabricante, foto FROM productos WHERE foto IS NOT NULL ORDER BY sku LIMIT 24"
  );
  console.log(`Productos (con fotos): ${conFotosRows.length}`);
  if (conFotosRows.length === 0) {
    console.log("(ningun producto con foto encontrado, se omite el test de grid)");
  } else {
    const productosGrid: ProductoCatalogo[] = conFotosRows.map((p: { nom: string; sku: string; precio: string; fabricante?: string; foto: string }) => ({
      nom: p.nom, sku: p.sku, precio: Number(p.precio), fabricante: p.fabricante || undefined, foto: p.foto,
    }));
    const bufGrid = await renderCatalogoPdf({
      fechaGeneracion: "07/24/2026",
      almacenLabel: "Palm Hills",
      conPrecio: true,
      conFotos: true,
      productos: productosGrid,
      empresaNombre,
      empresaContacto,
      logo,
    });
    writeFileSync(join(__dirname, "test-catalogo-grid.pdf"), bufGrid);
    console.log(`Grid PDF: ${(bufGrid.length / 1024).toFixed(0)} KB`);
  }

  // Verificacion basica con pdf-parse
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bufTabla) });
  const text = (await parser.getText()).text.toUpperCase();
  const ok = text.includes("PRODUCT CATALOG") && text.includes(empresaNombre.toUpperCase());
  console.log(`\nPortada + tabla OK: ${ok}`);
  if (!ok) { console.error("\n❌ FALLO"); process.exit(1); }
  console.log("✅ Catalogo OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
