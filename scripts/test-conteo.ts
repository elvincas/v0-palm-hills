// Test local de la hoja de conteo fisico: usa productos reales del almacen que
// lleva stock y genera las dos variantes (a ciegas y con stock del sistema).
//
// Correr: npx tsx scripts/test-conteo.ts
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { renderConteoPdf, ProductoConteo, GrupoConteo } from "../lib/pdf/conteo-pdf";

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

// Mismo agrupado que ConteoModal.generar en app/page.tsx: por ubicacion o
// marca, con el grupo "sin valor" siempre al final.
function agrupar(items: (ProductoConteo & { fabricante?: string })[], por: "ubicacion" | "marca"): GrupoConteo[] {
  const sinTitulo = por === "ubicacion" ? "Unassigned" : "Other Products";
  const mapa = new Map<string, ProductoConteo[]>();
  for (const { fabricante, ...p } of items) {
    const clave = (por === "ubicacion" ? (p.ubicacion || "").trim() : (fabricante || "").trim()) || sinTitulo;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave)!.push(p);
  }
  return Array.from(mapa.keys())
    .sort((a, b) => {
      if (a === sinTitulo) return b === sinTitulo ? 0 : 1;
      if (b === sinTitulo) return -1;
      return a.localeCompare(b, "en", { numeric: true });
    })
    .map((titulo) => ({ titulo, productos: mapa.get(titulo)! }));
}

async function main() {
  const [empresaRow] = await sql("SELECT nombre, logo, telefono, email FROM empresa WHERE id = 1");
  const logo: Buffer | undefined = empresaRow?.logo
    ? Buffer.from(String(empresaRow.logo).split(",")[1] || "", "base64")
    : undefined;
  const empresaContacto = [empresaRow?.telefono, empresaRow?.email].filter(Boolean).join("  ·  ") || undefined;
  const empresaNombre = empresaRow?.nombre || "Palm Hills";

  const rows = await sql(
    `SELECT nom, sku, ubicacion, cajas, stock, fabricante FROM productos
     WHERE coalesce(almacen,'palmhills') = 'palmhills' AND coalesce(stock,0) > 0
     ORDER BY nom`
  );
  console.log(`Productos con stock: ${rows.length}`);
  const items = rows.map(
    (p: { nom: string; sku: string; ubicacion?: string; cajas?: number; stock: number; fabricante?: string }) => ({
      nom: p.nom,
      sku: p.sku || "",
      ubicacion: p.ubicacion || "",
      cajas: Number(p.cajas || 0),
      stock: Number(p.stock || 0),
      fabricante: p.fabricante || "",
    })
  );
  const conUbic = items.filter((p: ProductoConteo) => p.ubicacion).length;
  const conCajas = items.filter((p: ProductoConteo) => p.cajas).length;
  console.log(`Con ubicacion cargada: ${conUbic} · con unidades por caja: ${conCajas}`);

  // Variante 1 — a ciegas, agrupada por marca (el caso real de hoy: ninguna
  // ubicacion cargada todavia, cada fila lleva la casilla en blanco).
  const gruposMarca = agrupar(items, "marca");
  console.log(`Grupos por marca: ${gruposMarca.length}`);
  const bufCiego = await renderConteoPdf({
    fechaGeneracion: "07/29/2026",
    almacenLabel: "Palm Hills",
    conSistema: false,
    grupos: gruposMarca,
    empresaNombre,
    empresaContacto,
    logo,
  });
  writeFileSync(join(__dirname, "test-conteo-ciego.pdf"), bufCiego);
  console.log(`Hoja a ciegas: ${(bufCiego.length / 1024).toFixed(0)} KB`);

  // Variante 2 — con stock del sistema, agrupada por ubicacion. Si todavia no
  // hay ubicaciones cargadas se inventan para ejercitar las bandas y el
  // formato de la columna.
  const conUbicaciones = conUbic
    ? items
    : items.map((p: ProductoConteo, i: number) => ({
        ...p,
        ubicacion: `${String.fromCharCode(65 + Math.floor(i / 24))}-${String((i % 24) % 6 + 1).padStart(2, "0")}`,
      }));
  const gruposUbic = agrupar(conUbicaciones, "ubicacion");
  console.log(`Grupos por ubicacion: ${gruposUbic.length}`);
  const bufSistema = await renderConteoPdf({
    fechaGeneracion: "07/29/2026",
    almacenLabel: "Palm Hills",
    conSistema: true,
    grupos: gruposUbic,
    empresaNombre,
    empresaContacto,
    logo,
  });
  writeFileSync(join(__dirname, "test-conteo-sistema.pdf"), bufSistema);
  console.log(`Hoja con sistema: ${(bufSistema.length / 1024).toFixed(0)} KB`);

  // Verificacion con pdf-parse
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse");
  const texto = async (buf: Buffer) =>
    (await new PDFParse({ data: new Uint8Array(buf) }).getText()).text.toUpperCase();

  const tCiego = await texto(bufCiego);
  const tSistema = await texto(bufSistema);

  const primerProducto = String(items[0].nom).toUpperCase();
  const checks: [string, boolean][] = [
    ["titulo y empresa", tCiego.includes("PHYSICAL COUNT") && tCiego.includes(empresaNombre.toUpperCase())],
    ["campos a llenar", tCiego.includes("COUNTED BY") && tCiego.includes("FINISHED")],
    ["columnas de captura", tCiego.includes("BOXES") && tCiego.includes("LOOSE") && tCiego.includes("TOTAL")],
    ["numeracion de pagina", tCiego.includes("PAGE 1 OF")],
    ["incluye los productos", tCiego.includes(primerProducto)],
    // Conteo a ciegas: la columna Sys NO aparece; con sistema si.
    ["a ciegas sin columna Sys", !tCiego.includes("U/BOX SYS") && !/\bSYS\b/.test(tCiego)],
    ["con sistema muestra Sys", /\bSYS\b/.test(tSistema)],
    ["bandas de ubicacion", tSistema.includes("A-01")],
  ];
  console.log("");
  checks.forEach(([nombre, ok]) => console.log(`${ok ? "✅" : "❌"} ${nombre}`));
  if (checks.some(([, ok]) => !ok)) {
    console.error("\n❌ FALLO");
    process.exit(1);
  }
  console.log("\n✅ Hoja de conteo OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
