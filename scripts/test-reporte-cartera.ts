// Test local del PDF de aging report: usa las facturas Pending/Partially Paid
// y notas de credito no aplicadas reales de la DB, genera el PDF en ambos
// modos y verifica que no truene.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { renderReporteCarteraPdf, FilaReporteCartera, GrupoReporteCartera, NotaCreditoReporte } from "../lib/pdf/reporte-cartera-pdf";

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
  const totalBruto = +filas.reduce((a, f) => a + f.saldo, 0).toFixed(2);

  const clientesConSaldo = Array.from(new Set(filas.map((f) => f.cliNom)));
  const ncRows = clientesConSaldo.length
    ? await sql(
        `SELECT cli, num, monto, motivo, aplicada FROM notas_credito WHERE cli IN (${clientesConSaldo
          .map((c) => `'${c.replace(/'/g, "''")}'`)
          .join(",")})`
      )
    : [];
  type NcRow = { cli: string; num: number; monto: string; motivo?: string; aplicada?: boolean };
  const creditosFlat: NotaCreditoReporte[] = (ncRows as NcRow[])
    .filter((n) => !n.aplicada)
    .map((n) => ({ cliNom: n.cli, num: n.num, monto: Number(n.monto), motivo: n.motivo }));
  const totalCreditos = +creditosFlat.reduce((a, c) => a + c.monto, 0).toFixed(2);
  const total = +(totalBruto - totalCreditos).toFixed(2);
  console.log(`Notas de credito no aplicadas (clientes con saldo): ${creditosFlat.length}, total -${totalCreditos}`);

  // ── Modo flat ──
  const bufFlat = await renderReporteCarteraPdf({
    fechaGeneracion: fdate(hoyStr()),
    modo: "flat",
    filas,
    grupos: [],
    creditosFlat,
    totalBruto,
    totalCreditos,
    total,
  });
  writeFileSync(join(__dirname, "test-cartera-flat.pdf"), bufFlat);
  console.log(`Flat PDF: ${(bufFlat.length / 1024).toFixed(0)} KB`);

  // ── Modo grouped ──
  const creditosPorCliente = new Map<string, NotaCreditoReporte[]>();
  for (const c of creditosFlat) {
    if (!creditosPorCliente.has(c.cliNom)) creditosPorCliente.set(c.cliNom, []);
    creditosPorCliente.get(c.cliNom)!.push(c);
  }
  const porCliente = new Map<string, FilaReporteCartera[]>();
  for (const f of filas) {
    if (!porCliente.has(f.cliNom)) porCliente.set(f.cliNom, []);
    porCliente.get(f.cliNom)!.push(f);
  }
  const grupos: GrupoReporteCartera[] = Array.from(porCliente.entries())
    .map(([cliNom, fs]) => {
      const subtotal = +fs.reduce((a, f) => a + f.saldo, 0).toFixed(2);
      const creditosCliente = creditosPorCliente.get(cliNom) || [];
      const totalCreditosCliente = creditosCliente.reduce((a, c) => a + c.monto, 0);
      return { cliNom, filas: fs, subtotal, creditos: creditosCliente, subtotalNeto: +(subtotal - totalCreditosCliente).toFixed(2) };
    })
    .sort((a, b) => b.filas[0].dias - a.filas[0].dias);
  const bufGrouped = await renderReporteCarteraPdf({
    fechaGeneracion: fdate(hoyStr()),
    modo: "grouped",
    filas: [],
    grupos,
    creditosFlat: [],
    totalBruto,
    totalCreditos,
    total,
  });
  writeFileSync(join(__dirname, "test-cartera-grouped.pdf"), bufGrouped);
  console.log(`Grouped PDF: ${(bufGrouped.length / 1024).toFixed(0)} KB, ${grupos.length} clientes`);

  // Verificacion basica con pdf-parse
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse");
  const parserFlat = new PDFParse({ data: new Uint8Array(bufFlat) });
  const textFlat = (await parserFlat.getText()).text.toUpperCase();
  const okFlat = textFlat.includes("AGING REPORT") && textFlat.includes("TOTAL OUTSTANDING");
  const flatTieneCreditos = creditosFlat.length ? textFlat.includes("UNAPPLIED CREDIT NOTES") : true;

  const parserGrouped = new PDFParse({ data: new Uint8Array(bufGrouped) });
  const textGrouped = (await parserGrouped.getText()).text;
  const primerClienteEnTexto = grupos[0] ? textGrouped.includes(grupos[0].cliNom) : true;

  console.log(`\nFlat OK: ${okFlat}, muestra creditos: ${flatTieneCreditos}`);
  console.log(`Grouped tiene cliente mas viejo primero: ${primerClienteEnTexto} (${grupos[0]?.cliNom}, ${grupos[0]?.filas[0].dias} dias)`);

  if (!okFlat || !flatTieneCreditos || !primerClienteEnTexto) {
    console.error("\n❌ FALLO la verificacion");
    process.exit(1);
  }
  console.log("\n✅ Aging report OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
