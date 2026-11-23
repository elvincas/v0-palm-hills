// Estado de cuenta y nota de credito en PDF (2026-11-23).
//
// Estos dos documentos se imprimian con window.print(), que en Safari de
// iPhone no abria nada: solo salian las facturas, que ya se generaban en el
// servidor. Ahora siguen el mismo camino que factura/estimate/recibo.
//
// Viven juntos porque comparten encabezado y estilos, y aparte de
// documento-pdf.tsx porque no llevan las opciones de Document Templates
// (logo/escala/acento): en pantalla tampoco las llevan.
//
// OJO: Helvetica no trae emoji ni el signo menos tipografico (U+2212): los
// creditos se escriben con guion normal.
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const GREEN = "#4a6741";
const GOLD = "#b09060";
const INK = "#1a1a18";
const AMBER = "#b45309";
const OK = "#15803d";

interface Encabezado {
  logo?: Buffer | Uint8Array;
  empresaNombre?: string;
  empresaContacto?: string;
}

const s = StyleSheet.create({
  page: { paddingTop: 104, paddingBottom: 46, paddingHorizontal: 40, fontSize: 9, fontFamily: "Helvetica", color: "#333" },
  header: { position: "absolute", top: 26, left: 40, right: 40 },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: GREEN,
    paddingBottom: 8,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  logo: { width: 42, height: 42, objectFit: "contain" },
  brand: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK },
  brandSub: { fontSize: 7, color: "#777", marginTop: 1 },
  docTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "right", color: GREEN },
  docNum: { fontSize: 9, fontFamily: "Courier", color: GOLD, textAlign: "right", marginTop: 2 },
  docSub: { fontSize: 7.5, color: "#777", textAlign: "right", marginTop: 2 },
  pageNum: { fontSize: 6.5, color: "#999", textAlign: "right", marginTop: 2 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, textAlign: "center", fontSize: 6.5, color: "#999" },

  lbl: { fontSize: 6, fontFamily: "Helvetica-Bold", color: "#888", textTransform: "uppercase", letterSpacing: 0.5 },
  partyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fafaf7",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  cliNom: { fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, marginTop: 2 },
  cliDet: { fontSize: 7.5, color: "#555", marginTop: 1.5 },
  netoBig: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 2, textAlign: "right" },

  seccion: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16 },
  colsRow: { flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 3, paddingTop: 6 },
  colTh: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: INK, textTransform: "uppercase" },
  row: { flexDirection: "row", paddingVertical: 5, alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#eceee7" },
  cNum: { width: 80, fontFamily: "Courier", fontSize: 8.5, color: INK },
  cFecha: { width: 80, fontSize: 8.5 },
  cMedio: { flex: 1, fontSize: 8.5, paddingRight: 8 },
  cMonto: { width: 90, textAlign: "right", fontSize: 9, fontFamily: "Helvetica-Bold", color: INK },
  totalRow: { flexDirection: "row", paddingTop: 7 },
  totalLbl: { flex: 1, fontSize: 9, fontFamily: "Helvetica-Bold", color: INK },
  totalVal: { width: 90, textAlign: "right", fontSize: 10, fontFamily: "Helvetica-Bold" },
  vacio: { fontSize: 8.5, fontFamily: "Helvetica-Oblique", color: "#999", marginTop: 6 },

  resumen: { marginTop: 20, borderTopWidth: 2, borderTopColor: GREEN, paddingTop: 10, alignItems: "flex-end" },
  resumenCaja: { width: 230 },
  resumenFila: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  resumenTot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1.5,
    borderTopColor: GREEN,
    marginTop: 4,
    paddingTop: 7,
  },

  // Nota de credito
  aplicada: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#86b592",
    backgroundColor: "#f0fdf4",
    borderRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  montoBox: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#d5ddd0",
    backgroundColor: "#f0f4ee",
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  montoBig: { fontSize: 22, fontFamily: "Helvetica-Bold", color: GREEN },
  cProd: { flex: 1, paddingRight: 8 },
  cQty: { width: 44, textAlign: "center", fontSize: 9 },
  cPrecio: { width: 74, textAlign: "right", fontSize: 9 },
  prodNom: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK },
  prodSku: { fontSize: 7, fontFamily: "Courier", color: "#888", marginTop: 1 },
  motivo: { fontSize: 9, color: "#444", marginTop: 3, lineHeight: 1.4 },
  firmas: { marginTop: 34, flexDirection: "row", justifyContent: "space-between", gap: 40 },
  firmaCampo: { borderBottomWidth: 1, borderBottomColor: "#999", height: 24 },
  firmaLbl: { fontSize: 6.5, color: "#888", marginTop: 3, textAlign: "center" },
  mensaje: {
    marginTop: 18,
    padding: 8,
    backgroundColor: "#f2f4ee",
    borderRadius: 3,
    textAlign: "center",
    fontSize: 8,
    color: "#444",
    fontFamily: "Helvetica-Oblique",
  },
});

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Encabezado fijo (se repite en cada hoja) + pie con el texto del documento.
function Marco({ e, titulo, num, sub, pie }: { e: Encabezado; titulo: string; num?: string; sub?: string; pie: string }) {
  return (
    <>
      <View style={s.header} fixed>
        <View style={s.headerTop}>
          <View style={s.logoRow}>
            {e.logo ? <Image src={{ data: Buffer.from(e.logo), format: "png" }} style={s.logo} /> : null}
            <View>
              <Text style={s.brand}>{e.empresaNombre || "Palm Hills"}</Text>
              <Text style={s.brandSub}>{e.empresaContacto || "(551) 248-3442  ·  admin@palmhillsco.net"}</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.docTitle}>{titulo}</Text>
            {num ? <Text style={s.docNum}>{num}</Text> : null}
            {sub ? <Text style={s.docSub}>{sub}</Text> : null}
            <Text style={s.pageNum} render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : " ")} />
          </View>
        </View>
      </View>
      <Text style={s.footer} fixed>{pie}</Text>
    </>
  );
}

// ───────────────────────── Estado de cuenta ─────────────────────────

export interface FacturaEstado {
  num: number;
  fecha: string; // MM/DD/YYYY
  estado: string;
  saldo: number;
}

export interface CreditoEstado {
  num: number;
  fecha: string; // MM/DD/YYYY
  motivo?: string;
  monto: number;
}

export interface DatosEstadoCuenta extends Encabezado {
  fecha: string; // MM/DD/YYYY
  cliente: { nom: string; codigo?: string; dir?: string; tel?: string; email?: string };
  facturas: FacturaEstado[];
  creditos: CreditoEstado[];
}

export async function renderEstadoCuentaPdf(d: DatosEstadoCuenta): Promise<Buffer> {
  const totalDeuda = d.facturas.reduce((a, x) => a + x.saldo, 0);
  const totalCredito = d.creditos.reduce((a, x) => a + x.monto, 0);
  const neto = totalDeuda - totalCredito;
  const netoTexto = `${neto < 0 ? "-" : ""}${fmt(Math.abs(neto))}`;
  const netoColor = neto > 0 ? AMBER : OK;
  const colorEstado = (e: string) => (e === "Overdue" ? "#b91c1c" : e === "Pending" ? AMBER : "#555");

  const doc = (
    <Document title={`Statement ${d.cliente.nom}`}>
      <Page size="LETTER" style={s.page}>
        <Marco
          e={d}
          titulo="ACCOUNT STATEMENT"
          sub={`Date: ${d.fecha}`}
          pie={`This statement is for informational purposes and reflects balances as of ${d.fecha}. Please contact us with any discrepancies.`}
        />

        <View style={s.partyRow} wrap={false}>
          <View style={{ maxWidth: 300 }}>
            <Text style={s.lbl}>Bill to</Text>
            <Text style={s.cliNom}>{d.cliente.nom}</Text>
            {d.cliente.codigo ? <Text style={[s.cliDet, { fontFamily: "Courier" }]}>#{d.cliente.codigo}</Text> : null}
            {d.cliente.dir ? <Text style={s.cliDet}>{d.cliente.dir}</Text> : null}
            {d.cliente.tel ? <Text style={s.cliDet}>{d.cliente.tel}</Text> : null}
            {d.cliente.email ? <Text style={s.cliDet}>{d.cliente.email}</Text> : null}
          </View>
          <View>
            <Text style={[s.lbl, { textAlign: "right" }]}>Net balance due</Text>
            <Text style={[s.netoBig, { color: netoColor }]}>{netoTexto}</Text>
          </View>
        </View>

        <Text style={s.seccion}>Pending invoices</Text>
        {d.facturas.length ? (
          <>
            <View style={s.colsRow}>
              <Text style={[s.cNum, s.colTh]}>Invoice #</Text>
              <Text style={[s.cFecha, s.colTh]}>Date</Text>
              <Text style={[s.cMedio, s.colTh]}>Status</Text>
              <Text style={[s.cMonto, s.colTh]}>Amount</Text>
            </View>
            {d.facturas.map((x, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={s.cNum}>#{String(x.num).padStart(3, "0")}</Text>
                <Text style={s.cFecha}>{x.fecha}</Text>
                <Text style={[s.cMedio, { fontFamily: "Helvetica-Bold", fontSize: 8, color: colorEstado(x.estado) }]}>{x.estado}</Text>
                <Text style={s.cMonto}>{fmt(x.saldo)}</Text>
              </View>
            ))}
            <View style={s.totalRow} wrap={false}>
              <Text style={s.totalLbl}>Subtotal</Text>
              <Text style={[s.totalVal, { color: AMBER }]}>{fmt(totalDeuda)}</Text>
            </View>
          </>
        ) : (
          <Text style={s.vacio}>No pending invoices.</Text>
        )}

        {d.creditos.length ? (
          <>
            <Text style={s.seccion}>Credit notes applied</Text>
            <View style={s.colsRow}>
              <Text style={[s.cNum, s.colTh]}>CN #</Text>
              <Text style={[s.cFecha, s.colTh]}>Date</Text>
              <Text style={[s.cMedio, s.colTh]}>Reason</Text>
              <Text style={[s.cMonto, s.colTh]}>Credit</Text>
            </View>
            {d.creditos.map((x, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={s.cNum}>CN-{String(x.num).padStart(3, "0")}</Text>
                <Text style={s.cFecha}>{x.fecha}</Text>
                <Text style={[s.cMedio, { color: "#555" }]}>{x.motivo || "—"}</Text>
                <Text style={[s.cMonto, { color: OK }]}>-{fmt(x.monto)}</Text>
              </View>
            ))}
            <View style={s.totalRow} wrap={false}>
              <Text style={s.totalLbl}>Total credits</Text>
              <Text style={[s.totalVal, { color: OK }]}>-{fmt(totalCredito)}</Text>
            </View>
          </>
        ) : null}

        <View style={s.resumen} wrap={false}>
          <View style={s.resumenCaja}>
            <View style={s.resumenFila}>
              <Text style={{ color: "#555" }}>Total pending</Text>
              <Text style={{ fontFamily: "Helvetica-Bold", color: AMBER }}>{fmt(totalDeuda)}</Text>
            </View>
            {totalCredito > 0 ? (
              <View style={s.resumenFila}>
                <Text style={{ color: OK }}>Credit notes</Text>
                <Text style={{ color: OK }}>-{fmt(totalCredito)}</Text>
              </View>
            ) : null}
            <View style={s.resumenTot}>
              <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: INK }}>Balance due</Text>
              <Text style={{ fontSize: 15, fontFamily: "Helvetica-Bold", color: netoColor }}>{netoTexto}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}

// ───────────────────────── Nota de credito ─────────────────────────

export interface LineaNotaCredito {
  prodNom: string;
  sku?: string;
  qty: number;
  precio: number;
}

export interface DatosNotaCredito extends Encabezado {
  num: number;
  fecha: string; // MM/DD/YYYY
  cliente: string;
  monto: number;
  motivo?: string;
  /** Solo las notas por producto traen lineas; las de monto van con la caja. */
  lineas?: LineaNotaCredito[];
  aplicada?: boolean;
  aplicadaEn?: string;
  aplicadaFecha?: string; // MM/DD/YYYY
  mensaje?: string;
}

export async function renderNotaCreditoPdf(d: DatosNotaCredito): Promise<Buffer> {
  const cnNum = `CN-${String(d.num).padStart(3, "0")}`;
  const lineas = d.lineas || [];

  const doc = (
    <Document title={`Credit Note ${cnNum}`}>
      <Page size="LETTER" style={s.page}>
        <Marco
          e={d}
          titulo="CREDIT NOTE"
          num={cnNum}
          sub={d.fecha}
          pie={`This credit note was issued by ${d.empresaNombre || "Palm Hills"}  ·  ${cnNum}  ·  ${d.fecha}`}
        />

        <View style={s.partyRow} wrap={false}>
          <View>
            <Text style={s.lbl}>Issued to</Text>
            <Text style={[s.cliNom, { fontSize: 12 }]}>{d.cliente.toUpperCase()}</Text>
          </View>
        </View>

        {d.aplicada ? (
          <View style={s.aplicada} wrap={false}>
            <Text style={{ fontSize: 7.5, fontFamily: "Helvetica-Bold", color: OK, letterSpacing: 0.8 }}>APPLIED</Text>
            <Text style={{ fontSize: 8, color: "#166534", marginTop: 2 }}>
              {d.aplicadaEn || "This credit has been used"}
              {d.aplicadaFecha ? `  ·  ${d.aplicadaFecha}` : ""}
            </Text>
          </View>
        ) : null}

        {lineas.length ? (
          <>
            <View style={[s.colsRow, { borderBottomColor: GREEN, paddingTop: 16 }]}>
              <Text style={[s.cProd, s.colTh]}>Product</Text>
              <Text style={[s.cQty, s.colTh]}>Qty</Text>
              <Text style={[s.cPrecio, s.colTh]}>Price</Text>
              <Text style={[s.cPrecio, s.colTh]}>Total</Text>
            </View>
            {lineas.map((l, i) => (
              <View key={i} style={s.row} wrap={false}>
                <View style={s.cProd}>
                  <Text style={s.prodNom}>{l.prodNom.toUpperCase()}</Text>
                  {l.sku ? <Text style={s.prodSku}>SKU: {l.sku}</Text> : null}
                </View>
                <Text style={s.cQty}>{l.qty}</Text>
                <Text style={s.cPrecio}>{fmt(l.precio)}</Text>
                <Text style={[s.cPrecio, { fontFamily: "Helvetica-Bold", color: INK }]}>{fmt(l.precio * l.qty)}</Text>
              </View>
            ))}
            <View style={[s.totalRow, { borderTopWidth: 1.5, borderTopColor: GREEN, marginTop: -1 }]} wrap={false}>
              <Text style={[s.totalLbl, { textAlign: "right", paddingRight: 10 }]}>Credit total</Text>
              <Text style={[s.totalVal, { width: 74, fontSize: 11, color: GREEN }]}>{fmt(d.monto)}</Text>
            </View>
          </>
        ) : (
          <View style={s.montoBox} wrap={false}>
            <Text style={s.lbl}>Credit amount</Text>
            <Text style={s.montoBig}>{fmt(d.monto)}</Text>
          </View>
        )}

        {d.motivo ? (
          <View style={{ marginTop: 16 }} wrap={false}>
            <Text style={s.lbl}>Reason</Text>
            <Text style={s.motivo}>{d.motivo}</Text>
          </View>
        ) : null}

        <View wrap={false}>
          <View style={s.firmas}>
            <View style={{ flex: 1 }}>
              <View style={s.firmaCampo} />
              <Text style={s.firmaLbl}>Authorized Signature</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.firmaCampo} />
              <Text style={s.firmaLbl}>Date</Text>
            </View>
          </View>
          {d.mensaje ? <Text style={s.mensaje}>{d.mensaje}</Text> : null}
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
