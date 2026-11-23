// Test local del PDF de catalogo (portada Atelier + hojas Vitrina) con
// productos REALES de Palm Hills: los que tienen foto y los que no (estos
// salen con su emoji). Agrupado por marca igual que CatalogoModal.generar.
//
// Las fotos se mandan tal cual estan en la base (algunas pesan ~1MB), asi que
// el PDF de prueba pesa mas que el real: la app las reduce a ~320px en el
// navegador antes de mandarlas.
//
// Correr: npx tsx scripts/test-catalogo.ts
// Escribe scripts/test-catalogo-grid.pdf y scripts/test-catalogo-lista.pdf
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { renderCatalogoPdf, emojiDeProducto, ProductoCatalogo, GrupoCatalogo } from "../lib/pdf/catalogo-pdf";

const ROOT = join(__dirname, "..");
const ASSETS = join(ROOT, "public", "catalogo");

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

// Mismo agrupado que CatalogoModal.generar en app/page.tsx.
function agrupar(items: (ProductoCatalogo & { fabricante?: string })[]): GrupoCatalogo[] {
  const porMarca = new Map<string, ProductoCatalogo[]>();
  for (const { fabricante, ...resto } of items) {
    const marca = (fabricante || "").trim() || "Other Products";
    if (!porMarca.has(marca)) porMarca.set(marca, []);
    porMarca.get(marca)!.push(resto);
  }
  const marcas = Array.from(porMarca.keys()).sort((a, b) => {
    if (a === "Other Products") return b === "Other Products" ? 0 : 1;
    if (b === "Other Products") return -1;
    return a.localeCompare(b, "en");
  });
  return marcas.map((marca) => ({ marca, productos: porMarca.get(marca)! }));
}

async function main() {
  const [emp] = await sql("SELECT nombre, eslogan, logo, telefono, email FROM empresa WHERE id = 1");
  const logo = emp?.logo ? Buffer.from(String(emp.logo).split(",")[1] || "", "base64") : undefined;
  const base = {
    fechaGeneracion: "11/23/2026",
    almacenLabel: "Palm Hills",
    empresaNombre: emp?.nombre || "Palm Hills",
    empresaEslogan: emp?.eslogan || undefined,
    empresaContacto: [emp?.telefono, emp?.email].filter(Boolean).join("  ·  ") || undefined,
    logo,
    assets: ASSETS,
  };

  // Fotos chicas (< 130 KB) para que el test corra rapido + todos los sin foto.
  const filas = await sql(
    "SELECT nom, sku, precio, fabricante, CASE WHEN length(foto) < 130000 THEN foto END AS foto FROM productos " +
      "WHERE almacen = 'palmhills' AND precio > 0 AND (foto IS NULL OR foto = '' OR length(foto) < 130000) ORDER BY nom",
  );
  const items = filas.map((p: { nom: string; sku: string; precio: string; fabricante?: string; foto?: string }) => ({
    nom: p.nom, sku: p.sku, precio: Number(p.precio), fabricante: p.fabricante || undefined, foto: p.foto || null,
  }));
  const grupos = agrupar(items);
  const sinFoto = items.filter((p: ProductoCatalogo) => !p.foto);
  console.log(`${items.length} productos · ${grupos.length} grupos · ${sinFoto.length} sin foto`);
  for (const p of sinFoto) console.log(`  ${emojiDeProducto(p.nom).label.padEnd(18)} ${p.nom}`);

  const grid = await renderCatalogoPdf({ ...base, conPrecio: true, conFotos: true, grupos });
  writeFileSync(join(__dirname, "test-catalogo-grid.pdf"), grid);
  console.log(`Grid PDF: ${(grid.length / 1024).toFixed(0)} KB`);

  // Muestra corta (portada + pocas hojas) para revisar el diseño a ojo.
  const muestra = grupos.filter((g) => ["Karseell", "Carotone", "Other Products"].includes(g.marca));
  const bufMuestra = await renderCatalogoPdf({ ...base, conPrecio: true, conFotos: true, grupos: muestra });
  writeFileSync(join(__dirname, "test-catalogo-muestra.pdf"), bufMuestra);
  console.log(`Muestra PDF: ${(bufMuestra.length / 1024).toFixed(0)} KB`);

  const lista = await renderCatalogoPdf({ ...base, conPrecio: true, conFotos: false, grupos });
  writeFileSync(join(__dirname, "test-catalogo-lista.pdf"), lista);
  console.log(`Lista PDF: ${(lista.length / 1024).toFixed(0)} KB`);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse");
  const texto = (await new PDFParse({ data: new Uint8Array(grid) }).getText()).text;
  const ok = texto.includes("The Collection") && texto.includes("HAIR PLUS") && /Page 1 of \d+/.test(texto);
  console.log(ok ? "✅ Catalogo OK" : "❌ FALLO: falta portada, productos o numeracion");
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
