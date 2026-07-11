// Prueba puntual: PDF de la ultima factura Paid con sello PAID + metodo
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { renderDocumentoPdf } from "../lib/pdf/documento-pdf";

const ROOT = join(__dirname, "..");

async function main() {
  const token = readFileSync(join(ROOT, ".env.local"), "utf8").match(/SUPABASE_ACCESS_TOKEN=(.+)/)![1].trim();
  const res = await fetch("https://api.supabase.com/v1/projects/fpzurpkszplgqarpozmt/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "SELECT num, cli, fecha::text AS fecha, estado, total, pagos, lineas FROM facturas WHERE estado = 'Paid' ORDER BY num DESC LIMIT 1" }),
  });
  const [f] = await res.json();
  const fd = (s: string) => { const [y, m, d] = s.split("-"); return `${m}/${d}/${y}`; };
  type Pago = { monto: number; fecha: string; metodo?: string };
  const pagos: Pago[] = f.pagos || [];
  const ultimo = pagos.length ? pagos.reduce((a, b) => (a.fecha >= b.fecha ? a : b)) : null;
  const buf = await renderDocumentoPdf({
    tipo: "invoice",
    num: f.num,
    fecha: fd(f.fecha),
    estado: f.estado,
    pagoInfo: ultimo ? { fecha: fd(ultimo.fecha), metodos: ["Zelle"] } : undefined,
    cliente: { nom: f.cli },
    lineas: f.lineas || [],
    total: Number(f.total),
    totalPagado: pagos.reduce((a, p) => a + p.monto, 0),
    logo: readFileSync(join(ROOT, "public", "logo.png")),
  });
  writeFileSync(join(__dirname, "test-paid.pdf"), buf);
  console.log(`OK factura #${f.num} Paid → ${(buf.length / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
