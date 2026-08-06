// Test local del recibo de pago: genera las dos variantes que produce la app
// (un pago que salda una factura, y un cobro que se reparte entre varias) y
// verifica el texto del PDF.
//
// No consulta Supabase a proposito: el recibo se arma con datos ya resueltos
// por el cliente/ruta, asi que el test es autocontenido y corre sin token.
//
// Correr: npx tsx scripts/test-recibo.ts
import { writeFileSync } from "fs";
import { join } from "path";
import { renderReciboPdf } from "../lib/pdf/recibo-pdf";

const EMPRESA = {
  empresaNombre: "Palm Hills",
  empresaEslogan: "Beauty & Health",
  empresaContacto: "(551) 248-3442  ·  admin@palmhillsco.net",
};

const CLIENTE = {
  nom: "BEAUTY SUPPLY LA ESQUINA",
  codigo: "01-0037",
  dir: "214 Bergenline Ave, Union City, NJ",
  tel: "(201) 555-0134",
};

async function main() {
  // Caso 1 — un pago salda su factura y el cliente queda en cero.
  const bufSimple = await renderReciboPdf({
    num: 7001,
    fecha: "08/04/2026",
    cliente: CLIENTE,
    monto: 450,
    metodo: "Zelle",
    lineas: [{ facturaNum: 1042, fecha: "07/28/2026", balanceAntes: 450, aplicado: 450 }],
    pendientes: [],
    totalPendiente: 0,
    ...EMPRESA,
  });
  writeFileSync(join(__dirname, "test-recibo-simple.pdf"), bufSimple);
  console.log(`Recibo simple: ${(bufSimple.length / 1024).toFixed(0)} KB`);

  // Caso 2 — un cobro de $500 cubre tres facturas y deja una abierta y vencida.
  const bufMulti = await renderReciboPdf({
    num: 7002,
    fecha: "08/04/2026",
    cliente: CLIENTE,
    monto: 500,
    metodo: "Cash",
    nota: "Ref. 8821",
    lineas: [
      { facturaNum: 1018, fecha: "06/12/2026", balanceAntes: 120, aplicado: 120 },
      { facturaNum: 1027, fecha: "07/02/2026", balanceAntes: 250, aplicado: 250 },
      { facturaNum: 1035, fecha: "07/19/2026", balanceAntes: 410, aplicado: 130 },
    ],
    pendientes: [
      { num: 1035, fecha: "07/19/2026", saldo: 280, dias: 16 },
      { num: 1009, fecha: "05/20/2026", saldo: 95, dias: 76 },
    ],
    totalPendiente: 375,
    mensaje: "Thank you! Please keep this receipt for your records.",
    ...EMPRESA,
  });
  writeFileSync(join(__dirname, "test-recibo-multi.pdf"), bufMulti);
  console.log(`Recibo multi-factura: ${(bufMulti.length / 1024).toFixed(0)} KB`);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse");
  const texto = async (buf: Buffer) =>
    (await new PDFParse({ data: new Uint8Array(buf) }).getText()).text.toUpperCase();

  const tSimple = await texto(bufSimple);
  const tMulti = await texto(bufMulti);

  const checks: [string, boolean][] = [
    ["titulo y numero", tSimple.includes("RECEIPT") && tSimple.includes("NO. 7001")],
    ["empresa y cliente", tSimple.includes("PALM HILLS") && tSimple.includes("BEAUTY SUPPLY LA ESQUINA")],
    ["monto y metodo", tSimple.includes("$450.00") && tSimple.includes("ZELLE")],
    ["factura cubierta", tSimple.includes("#1042") && tSimple.includes("TOTAL APPLIED")],
    ["firma", tSimple.includes("RECEIVED BY")],
    // Sin facturas abiertas el bloque no se omite: lo dice.
    ["saldado avisa en cero", tSimple.includes("NO OUTSTANDING BALANCE")],
    ["multi lista las 3 facturas", ["#1018", "#1027", "#1035"].every((n) => tMulti.includes(n))],
    ["multi suma el total aplicado", tMulti.includes("$500.00")],
    ["estado de cuenta con saldo", tMulti.includes("TOTAL OUTSTANDING") && tMulti.includes("$375.00")],
    ["marca las vencidas", tMulti.includes("PAST DUE")],
    ["nota y mensaje de plantilla", tMulti.includes("REF. 8821") && tMulti.includes("KEEP THIS RECEIPT")],
  ];
  console.log("");
  checks.forEach(([nombre, ok]) => console.log(`${ok ? "✅" : "❌"} ${nombre}`));
  if (checks.some(([, ok]) => !ok)) {
    console.error("\n❌ FALLO");
    process.exit(1);
  }
  console.log("\n✅ Recibo OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
