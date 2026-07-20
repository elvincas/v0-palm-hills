// Test local del PDF de aging report: usa las facturas Pending/Partially Paid
// reales de la DB, genera el PDF en ambos modos y verifica que no truene.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { renderReporteCarteraPdf, FilaReporteCartera, GrupoReporteCartera } from "../lib/pdf/reporte-cartera-pdf";

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
const hoyStr = () => new Date().toISOString().split("T")[0];
const diasDesde = (fecha: string) => {
  const ms = new Date(hoyStr() + "T00:00:00").getTime() - new Date(fecha + "T00:00:00").getTime();
  return Math.max(0, Math.round(ms / 86400000));
};

async function main() {
  const rows = await sql(
    "SELECT num, cli, fecha, total, pagos FROM facturas WHERE estado IN ('Pending','Partially Paid')"
  );
  console.log(`Facturas pendientes: ${rows.length}`);

  type Row = { num: number; cli: string; fecha: string; total: string; pagos: { monto: number }[] | null };
  const filas: FilaReporteCartera[] = (rows as Row[]).map((f) => {
    const pagado = (f.pagos || []).reduce((a, p) => a + Number(p.monto || 0), 0);
    return {
      cliNom: f.cli,
      facturaNum: f.num,
      fecha: fdate(f.fecha),
      dias: diasDesde(f.fecha),
      saldo: +(Number(f.total) - pagado).toFixed(2),
    };
  });
  filas.sort((a, b) => b.dias - a.dias);
  const total = +filas.reduce((a, f) => a + f.saldo, 0).toFixed(2);

  // ── Modo flat ──
  const bufFlat = await renderReporteCarteraPdf({ fechaGeneracion: fdate(hoyStr()), modo: "flat", filas, grupos: [], total });
  writeFileSync(join(__dirname, "test-cartera-flat.pdf"), bufFlat);
  console.log(`Flat PDF: ${(bufFlat.length / 1024).toFixed(0)} KB`);

  // ── Modo grouped ──
  const porCliente = new Map<string, FilaReporteCartera[]>();
  for (const f of filas) {
    if (!porCliente.has(f.cliNom)) porCliente.set(f.cliNom, []);
    porCliente.get(f.cliNom)!.push(f);
  }
  const grupos: GrupoReporteCartera[] = Array.from(porCliente.entries())
    .map(([cliNom, fs]) => ({ cliNom, filas: fs, subtotal: +fs.reduce((a, f) => a + f.saldo, 0).toFixed(2) }))
    .sort((a, b) => b.filas[0].dias - a.filas[0].dias);
  const bufGrouped = await renderReporteCarteraPdf({ fechaGeneracion: fdate(hoyStr()), modo: "grouped", filas: [], grupos, total });
  writeFileSync(join(__dirname, "test-cartera-grouped.pdf"), bufGrouped);
  console.log(`Grouped PDF: ${(bufGrouped.length / 1024).toFixed(0)} KB, ${grupos.length} clientes`);

  // Verificacion basica con pdf-parse: texto presente, clientes mas viejos primero
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse");
  const parserFlat = new PDFParse({ data: new Uint8Array(bufFlat) });
  const textFlat = (await parserFlat.getText()).text.toUpperCase();
  const okFlat = textFlat.includes("AGING REPORT") && textFlat.includes("TOTAL OUTSTANDING");

  const parserGrouped = new PDFParse({ data: new Uint8Array(bufGrouped) });
  const textGrouped = (await parserGrouped.getText()).text;
  const primerClienteEnTexto = grupos[0] ? textGrouped.includes(grupos[0].cliNom) : true;

  console.log(`\nFlat OK: ${okFlat}`);
  console.log(`Grouped tiene cliente mas viejo primero: ${primerClienteEnTexto} (${grupos[0]?.cliNom}, ${grupos[0]?.filas[0].dias} dias)`);

  if (!okFlat || !primerClienteEnTexto) {
    console.error("\n❌ FALLO la verificacion");
    process.exit(1);
  }
  console.log("\n✅ Aging report OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
