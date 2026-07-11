// Test local del generador de PDF: usa la factura real mas grande de la DB,
// genera el PDF y verifica paginacion, header repetido y firma solo al final.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { renderDocumentoPdf, DatosDocumento } from "../lib/pdf/documento-pdf";

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

const fdate = (s: string) => {
  const [y, m, d] = (s || "").split("-");
  return `${m}/${d}/${y}`;
};

async function main() {
  // La factura con mas lineas (la que se partia mal al imprimir)
  const [f] = await sql(
    "SELECT num, cli, fecha, estado, total, pagos, lineas FROM facturas ORDER BY jsonb_array_length(lineas) DESC LIMIT 1"
  );
  const [c] = await sql(
    `SELECT nom, codigo_cliente, dir, ciudad, estado_dir, tel FROM clientes WHERE nom = ${JSON.stringify(f.cli).replace(/"/g, "'")} LIMIT 1`
  );
  console.log(`Factura #${f.num} — ${f.cli} — ${f.lineas.length} lineas`);

  type Linea = { prodNom: string; sku?: string; qty: number; precio: number; precioOriginal?: number };
  const lineas = [...(f.lineas as Linea[])].sort((a, b) => {
    const sa = (a.sku || "").trim(); const sb = (b.sku || "").trim();
    if (!sa && sb) return 1; if (sa && !sb) return -1;
    return sa.localeCompare(sb, "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en");
  });

  const datos: DatosDocumento = {
    tipo: "invoice",
    num: f.num,
    fecha: fdate(f.fecha),
    estado: f.estado,
    cliente: {
      nom: c?.nom || f.cli,
      codigo: c?.codigo_cliente,
      dir: [c?.dir, c?.ciudad, c?.estado_dir].filter(Boolean).join(", "),
      tel: c?.tel,
    },
    lineas,
    total: Number(f.total),
    totalPagado: ((f.pagos || []) as { monto: number }[]).reduce((a, p) => a + p.monto, 0),
    logo: readFileSync(join(ROOT, "public", "logo.png")),
  };

  const buf = await renderDocumentoPdf(datos);
  const out = join(__dirname, "test-invoice.pdf");
  writeFileSync(out, buf);
  console.log(`PDF generado: ${out} (${(buf.length / 1024).toFixed(0)} KB)`);

  // Verificacion con pdf-parse v2: texto por pagina
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  const pageTexts: string[] = (result.pages || []).map((p: { text: string }) => p.text);

  console.log(`\nPaginas: ${pageTexts.length}`);
  let ok = true;
  pageTexts.forEach((tRaw, i) => {
    const t = tRaw.toUpperCase();
    const tieneHeader = t.includes("INVOICE") && t.includes("PALM HILLS") && t.includes("BILL TO");
    const tienePageNum = t.includes(`PAGE ${i + 1} OF ${pageTexts.length}`);
    const tieneFirma = t.includes("DELIVERY CONFIRMATION");
    const tieneGracias = t.includes("THANK YOU FOR YOUR PURCHASE!");
    const esUltima = i === pageTexts.length - 1;
    console.log(
      `  Pagina ${i + 1}: header=${tieneHeader} pageNum=${tienePageNum} firma=${tieneFirma} gracias=${tieneGracias}`
    );
    if (!tieneHeader || !tienePageNum) ok = false;
    if (esUltima && (!tieneFirma || !tieneGracias)) ok = false;
    if (!esUltima && (tieneFirma || tieneGracias)) ok = false;
  });

  // Conteo de filas por pagina (aprox: por precios con $)
  pageTexts.forEach((t, i) => {
    const filas = (t.match(/\$/g) || []).length;
    console.log(`  Pagina ${i + 1}: ~${filas} montos ($)`);
  });

  if (!ok) { console.error("\n❌ FALLO la verificacion"); process.exit(1); }
  console.log("\n✅ FACTURA OK: header en todas las paginas, firma solo en la ultima");

  // ── Estimate con la orden mas grande ──
  const [o] = await sql(
    "SELECT num, cli, fecha, lineas FROM ordenes ORDER BY jsonb_array_length(lineas) DESC LIMIT 1"
  );
  type LineaO = Linea & { precioFinal?: number };
  const lineasO = ((o.lineas || []) as LineaO[]).map((l) => ({
    prodNom: l.prodNom,
    sku: l.sku,
    qty: l.qty,
    precio: l.precioFinal ?? l.precio,
    precioOriginal: l.precioFinal !== undefined && l.precioFinal !== l.precio ? l.precio : undefined,
  }));
  const bufE = await renderDocumentoPdf({
    tipo: "estimate",
    num: o.num,
    fecha: fdate(o.fecha),
    cliente: { nom: String(o.cli) },
    lineas: lineasO,
    total: lineasO.reduce((a, l) => a + l.qty * l.precio, 0),
    logo: readFileSync(join(ROOT, "public", "logo.png")),
  });
  writeFileSync(join(__dirname, "test-estimate.pdf"), bufE);
  const parserE = new PDFParse({ data: new Uint8Array(bufE) });
  const resE = await parserE.getText();
  const pagesE: string[] = (resE.pages || []).map((p: { text: string }) => p.text);
  console.log(`\nEstimate orden #${o.num} — ${lineasO.length} lineas — ${pagesE.length} paginas`);
  let okE = true;
  pagesE.forEach((tRaw, i) => {
    const t = tRaw.toUpperCase();
    const header = t.includes("ESTIMATE") && t.includes("PALM HILLS");
    const disc = t.includes("THIS IS AN ESTIMATE");
    const esUltima = i === pagesE.length - 1;
    console.log(`  Pagina ${i + 1}: header=${header} disclaimer=${disc}`);
    if (!header) okE = false;
    if (esUltima !== disc) okE = false;
  });
  if (!okE) { console.error("\n❌ FALLO estimate"); process.exit(1); }
  console.log("✅ ESTIMATE OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
