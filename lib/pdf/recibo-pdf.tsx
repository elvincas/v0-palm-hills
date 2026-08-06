// Recibo de pago (2026-08-04) — el documento que el cliente se lleva cuando
// paga. Diseno "C" aprobado por mockup: el recibo arriba y, debajo, el estado
// de cuenta que le queda despues de este pago (comprobante y recordatorio de
// cobro en el mismo papel).
//
// Vive aparte de documento-pdf.tsx a proposito: aquel renderiza lineas de
// PRODUCTO (qty/sku/precio/importe) y aqui las lineas son FACTURAS que el pago
// cubre. Comparte en cambio las mismas opciones de Document Templates (color
// de acento, escala de tipografia, posicion del logo, mensaje al cliente).
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

// Una factura cubierta por este pago. `balanceAntes` es el saldo que tenia la
// factura justo antes de aplicarlo (no su total): es lo que el cliente
// reconoce como "lo que debia".
export interface LineaRecibo {
  facturaNum: number;
  fecha: string; // MM/DD/YYYY
  balanceAntes: number;
  aplicado: number;
}

// Snapshot de una factura que sigue abierta despues del pago.
export interface PendienteRecibo {
  num: number;
  fecha: string; // MM/DD/YYYY
  saldo: number;
  dias: number;
}

export interface DatosRecibo {
  num: number | string;
  fecha: string; // MM/DD/YYYY
  cliente: { nom: string; codigo?: string; dir?: string; tel?: string };
  monto: number;
  metodo?: string;
  nota?: string;
  lineas: LineaRecibo[];
  pendientes: PendienteRecibo[];
  totalPendiente: number;
  logo?: Buffer | Uint8Array;
  empresaNombre?: string;
  empresaEslogan?: string;
  empresaContacto?: string;
  mensaje?: string;
  logoPos?: "left" | "center" | "right";
  fontScale?: number;
  accentColor?: string;
  showSignature?: boolean;
}

const GOLD = "#b09060";
const INK = "#1a1a18";
const RED = "#b4623f";

const f = (n: number, scale: number) => Math.round(n * scale * 100) / 100;

const makeStyles = (accent: string, scale: number) =>
  StyleSheet.create({
    page: {
      paddingTop: 104,
      paddingBottom: 42,
      paddingHorizontal: 40,
      fontSize: f(9, scale),
      fontFamily: "Helvetica",
      color: "#333",
    },
    header: { position: "absolute", top: 26, left: 40, right: 40 },
    headerTop: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 2,
      borderBottomColor: accent,
      paddingBottom: 8,
    },
    logoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    logo: { width: f(42, scale), height: f(42, scale), objectFit: "contain" },
    brand: { fontSize: f(11, scale), fontFamily: "Helvetica-Bold", color: INK },
    brandSlogan: { fontSize: f(7, scale), fontFamily: "Helvetica-Oblique", color: "#777", marginTop: 1 },
    brandSub: { fontSize: f(7, scale), color: "#777", marginTop: 1 },
    docTitle: { fontSize: f(13, scale), fontFamily: "Helvetica-Bold", textAlign: "right", color: accent },
    docNum: { fontSize: f(9, scale), fontFamily: "Courier", color: GOLD, textAlign: "right", marginTop: 2 },
    pageNum: { fontSize: f(6.5, scale), color: "#999", textAlign: "right", marginTop: 2 },

    lbl: { fontSize: f(6, scale), fontFamily: "Helvetica-Bold", color: "#888", textTransform: "uppercase", letterSpacing: 0.5 },
    partyRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      backgroundColor: "#fafaf7",
      paddingVertical: 7,
      paddingHorizontal: 8,
    },
    cliNom: { fontSize: f(9.5, scale), fontFamily: "Helvetica-Bold", color: INK, marginTop: 1.5 },
    cliDet: { fontSize: f(7.5, scale), color: "#555", marginTop: 1.5 },
    metodo: { fontSize: f(8.5, scale), fontFamily: "Helvetica-Bold", color: accent, marginTop: 2, textAlign: "right" },

    montoBox: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: "#e3e7dd",
      backgroundColor: "#f7f8f4",
      borderRadius: 4,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    montoBig: { fontSize: f(20, scale), fontFamily: "Helvetica-Bold", color: INK },

    nota: { fontSize: f(7.5, scale), color: "#777", marginTop: 5, fontFamily: "Helvetica-Oblique" },

    colsRow: {
      flexDirection: "row",
      borderBottomWidth: 1.5,
      borderBottomColor: INK,
      paddingBottom: 3,
      paddingTop: 16,
    },
    colTh: { fontSize: f(7.5, scale), fontFamily: "Helvetica-Bold", color: INK, textTransform: "uppercase" },
    row: {
      flexDirection: "row",
      paddingVertical: 5,
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: "#eceee7",
    },
    cInv: { width: 70, fontFamily: "Courier", fontSize: f(8.5, scale), color: INK },
    cFecha: { flex: 1, fontSize: f(8.5, scale) },
    cWas: { width: 80, textAlign: "right", fontSize: f(8.5, scale), color: "#666" },
    cAplic: { width: 80, textAlign: "right", fontSize: f(9, scale), fontFamily: "Helvetica-Bold", color: INK },
    totalRow: { flexDirection: "row", paddingTop: 7 },
    totalLbl: { flex: 1, textAlign: "right", fontSize: f(9, scale), fontFamily: "Helvetica-Bold", color: "#666", paddingRight: 8 },
    totalVal: { width: 80, textAlign: "right", fontSize: f(10, scale), fontFamily: "Helvetica-Bold", color: accent },

    estado: { marginTop: 20, borderTopWidth: 1, borderTopColor: "#ddd", borderTopStyle: "dashed", paddingTop: 12 },
    estadoHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
    estadoTit: { fontSize: f(7.5, scale), fontFamily: "Helvetica-Bold", color: INK, textTransform: "uppercase", letterSpacing: 0.5 },
    vencidas: { fontSize: f(7, scale), fontFamily: "Helvetica-Bold", color: RED },
    outRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
      borderBottomWidth: 1,
      borderBottomColor: "#eceee7",
    },
    outTot: { flexDirection: "row", justifyContent: "space-between", paddingTop: 7 },
    saldado: {
      marginTop: 4,
      backgroundColor: "#eaf0e6",
      borderRadius: 4,
      paddingVertical: 8,
      paddingHorizontal: 10,
      textAlign: "center",
      fontSize: f(9, scale),
      fontFamily: "Helvetica-Bold",
      color: "#15803d",
    },

    firma: { marginTop: 22, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 30 },
    gracias: { fontSize: f(8.5, scale), fontFamily: "Helvetica-Oblique", color: "#777" },
    firmaCampo: { borderBottomWidth: 1, borderBottomColor: "#999", height: 16, width: 170 },
    firmaLbl: { fontSize: f(6.5, scale), color: "#888", marginTop: 2, textAlign: "center" },
    mensaje: {
      marginTop: 14,
      padding: 8,
      backgroundColor: "#f2f4ee",
      borderRadius: 3,
      textAlign: "center",
      fontSize: f(8, scale),
      color: "#444",
      fontFamily: "Helvetica-Oblique",
    },
  });

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function renderReciboPdf(d: DatosRecibo): Promise<Buffer> {
  const accent = d.accentColor || "#4a6741";
  const scale = d.fontScale || 1;
  const logoPos = d.logoPos || "left";
  const showSignature = d.showSignature ?? true;
  const s = makeStyles(accent, scale);
  const numTexto = `No. ${String(d.num).padStart(4, "0")}`;
  const totalAplicado = d.lineas.reduce((a, l) => a + l.aplicado, 0);
  const vencidas = d.pendientes.filter((p) => p.dias > 30).length;

  const logoBlock = (
    <View style={s.logoRow}>
      {d.logo ? <Image src={{ data: Buffer.from(d.logo), format: "png" }} style={s.logo} /> : null}
      <View>
        <Text style={s.brand}>{d.empresaNombre || "Palm Hills"}</Text>
        <Text style={s.brandSlogan}>{d.empresaEslogan || "Beauty & Health"}</Text>
        <Text style={s.brandSub}>{d.empresaContacto || "(551) 248-3442  ·  admin@palmhillsco.net"}</Text>
      </View>
    </View>
  );
  const docInfoBlock = (
    <View>
      <Text style={s.docTitle}>RECEIPT</Text>
      <Text style={s.docNum}>{numTexto}</Text>
      <Text style={s.pageNum} render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : " ")} />
    </View>
  );

  const doc = (
    <Document title={`Receipt ${numTexto}`}>
      <Page size="LETTER" style={s.page}>
        {/* Header fijo: un recibo normalmente cabe en una hoja, pero un cliente
            con muchas facturas abiertas puede empujar el estado de cuenta a la
            segunda. */}
        <View style={s.header} fixed>
          {logoPos === "center" ? (
            <View style={[s.headerTop, { flexDirection: "column", alignItems: "center", gap: 4 }]}>
              {logoBlock}
              <View style={{ flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 4 }}>
                <View style={{ width: 60 }} />
                {docInfoBlock}
              </View>
            </View>
          ) : (
            <View style={[s.headerTop, { justifyContent: "space-between", flexDirection: logoPos === "right" ? "row-reverse" : "row" }]}>
              {logoBlock}
              {docInfoBlock}
            </View>
          )}
        </View>

        <View wrap={false}>
          <View style={s.partyRow}>
            <View style={{ maxWidth: 300 }}>
              <Text style={s.lbl}>Received from</Text>
              <Text style={s.cliNom}>{d.cliente.nom}</Text>
              {d.cliente.codigo ? <Text style={[s.cliDet, { fontFamily: "Courier" }]}>#{d.cliente.codigo}</Text> : null}
              {d.cliente.dir ? <Text style={s.cliDet}>{d.cliente.dir}</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.lbl}>Date</Text>
              <Text style={[s.cliDet, { color: INK }]}>{d.fecha}</Text>
              {d.metodo ? (
                <>
                  <Text style={[s.lbl, { marginTop: 5 }]}>Method</Text>
                  <Text style={s.metodo}>{d.metodo}</Text>
                </>
              ) : null}
            </View>
          </View>

          <View style={s.montoBox}>
            <Text style={s.lbl}>Amount received</Text>
            <Text style={s.montoBig}>{fmt(d.monto)}</Text>
          </View>
          {d.nota ? <Text style={s.nota}>{d.nota}</Text> : null}
        </View>

        {/* Facturas que cubre este pago */}
        <View style={s.colsRow}>
          <Text style={[s.colTh, s.cInv]}>Applied to</Text>
          <Text style={[s.colTh, s.cFecha]}>Date</Text>
          <Text style={[s.colTh, s.cWas]}>Balance was</Text>
          <Text style={[s.colTh, s.cAplic]}>Applied</Text>
        </View>
        {d.lineas.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.cInv}>#{String(l.facturaNum).padStart(4, "0")}</Text>
            <Text style={s.cFecha}>{l.fecha}</Text>
            <Text style={s.cWas}>{fmt(l.balanceAntes)}</Text>
            <Text style={s.cAplic}>{fmt(l.aplicado)}</Text>
          </View>
        ))}
        <View style={s.totalRow}>
          <Text style={s.totalLbl}>Total applied</Text>
          <Text style={s.totalVal}>{fmt(totalAplicado)}</Text>
        </View>

        {/* Estado de cuenta tras el pago */}
        <View style={s.estado}>
          <View style={s.estadoHead}>
            <Text style={s.estadoTit}>Account summary after this payment</Text>
            {vencidas > 0 ? (
              <Text style={s.vencidas}>{vencidas === 1 ? "1 invoice past due" : `${vencidas} invoices past due`}</Text>
            ) : null}
          </View>
          {d.pendientes.length ? (
            <>
              {d.pendientes.map((p, i) => (
                <View key={i} style={s.outRow} wrap={false}>
                  <Text style={{ fontSize: f(8.5, scale) }}>
                    <Text style={{ fontFamily: "Courier" }}>#{String(p.num).padStart(4, "0")}</Text>
                    {`  ·  ${p.fecha}  ·  ${p.dias} ${p.dias === 1 ? "day" : "days"}`}
                  </Text>
                  <Text style={{ fontSize: f(8.5, scale), fontFamily: "Helvetica-Bold", color: p.dias > 30 ? RED : INK }}>
                    {fmt(p.saldo)}
                  </Text>
                </View>
              ))}
              <View style={s.outTot}>
                <Text style={{ fontSize: f(9.5, scale), fontFamily: "Helvetica-Bold", color: INK }}>Total outstanding</Text>
                <Text style={{ fontSize: f(10.5, scale), fontFamily: "Helvetica-Bold", color: INK }}>{fmt(d.totalPendiente)}</Text>
              </View>
            </>
          ) : (
            // Sin facturas abiertas no se omite el bloque: se dice, que es la
            // mejor noticia que puede llevarse el cliente.
            <Text style={s.saldado}>No outstanding balance — account paid in full.</Text>
          )}
        </View>

        <View wrap={false}>
          {showSignature && (
            <View style={s.firma}>
              <Text style={s.gracias}>Thank you for your business.</Text>
              <View>
                <View style={s.firmaCampo} />
                <Text style={s.firmaLbl}>Received by</Text>
              </View>
            </View>
          )}
          {d.mensaje ? <Text style={s.mensaje}>{d.mensaje}</Text> : null}
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
