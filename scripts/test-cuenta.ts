// Test local del estado de cuenta y la nota de credito en PDF. Autocontenido
// (sin Supabase), mismo criterio que test-recibo.ts.
//
// Correr: npx tsx scripts/test-cuenta.ts
import { writeFileSync } from "fs";
import { join } from "path";
import { renderEstadoCuentaPdf, renderNotaCreditoPdf } from "../lib/pdf/cuenta-pdf";

const EMPRESA = {
  empresaNombre: "Palm Hills",
  empresaContacto: "(551) 248-3442  ·  admin@palmhillsco.net",
};

async function main() {
  const estado = await renderEstadoCuentaPdf({
    fecha: "11/23/2026",
    cliente: {
      nom: "BEAUTY SUPPLY LA ESQUINA",
      codigo: "01-0037",
      dir: "214 Bergenline Ave, Union City, NJ",
      tel: "(201) 555-0134",
      email: "esquina@example.com",
    },
    facturas: [
      { num: 1018, fecha: "09/12/2026", estado: "Pending", saldo: 120 },
      { num: 1027, fecha: "10/02/2026", estado: "Partially Paid", saldo: 250.5 },
      { num: 1035, fecha: "11/19/2026", estado: "Pending", saldo: 410 },
    ],
    creditos: [{ num: 12, fecha: "11/01/2026", motivo: "Damaged merchandise returned", monto: 45 }],
    ...EMPRESA,
  });
  writeFileSync(join(__dirname, "test-estado-cuenta.pdf"), estado);
  console.log(`Statement: ${(estado.length / 1024).toFixed(0)} KB`);

  // Estado largo: debe fluir a varias hojas repitiendo el encabezado.
  const largo = await renderEstadoCuentaPdf({
    fecha: "11/23/2026",
    cliente: { nom: "FARMACIA CENTRAL" },
    facturas: Array.from({ length: 70 }, (_, i) => ({ num: 1100 + i, fecha: "10/05/2026", estado: "Pending", saldo: 100 + i })),
    creditos: [],
    ...EMPRESA,
  });
  writeFileSync(join(__dirname, "test-estado-cuenta-largo.pdf"), largo);
  console.log(`Statement (70 invoices): ${(largo.length / 1024).toFixed(0)} KB`);

  const ncProducto = await renderNotaCreditoPdf({
    num: 14,
    fecha: "11/20/2026",
    cliente: "Beauty Supply La Esquina",
    monto: 57,
    motivo: "Two boxes arrived open; customer returned them on delivery.",
    lineas: [
      { prodNom: "Hair Plus Ampolla Banana", sku: "HAPL0018", qty: 6, precio: 4.5 },
      { prodNom: "Silicon Mix Tratamiento 8 oz", sku: "BT-056", qty: 3, precio: 10 },
    ],
    aplicada: true,
    aplicadaEn: "Applied to invoice #1035",
    aplicadaFecha: "11/21/2026",
    mensaje: "Thank you for your patience.",
    ...EMPRESA,
  });
  writeFileSync(join(__dirname, "test-nota-credito-producto.pdf"), ncProducto);
  console.log(`Credit note (product): ${(ncProducto.length / 1024).toFixed(0)} KB`);

  const ncMonto = await renderNotaCreditoPdf({
    num: 15,
    fecha: "11/22/2026",
    cliente: "Farmacia Central",
    monto: 125,
    motivo: "Price adjustment",
    ...EMPRESA,
  });
  writeFileSync(join(__dirname, "test-nota-credito-monto.pdf"), ncMonto);
  console.log(`Credit note (amount): ${(ncMonto.length / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
