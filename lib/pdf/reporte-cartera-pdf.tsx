// PDF del reporte de cartera (facturas pendientes por antiguedad) — ver
// lib/pdf/documento-pdf.tsx. A diferencia de facturas/estimates, este PDF no
// necesita paginacion manual: es una tabla que fluye y @react-pdf reparte las
// filas entre hojas automaticamente.
import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

export interface FilaReporteCartera {
  cliNom: string;
  facturaNum: number;
  fecha: string; // MM/DD/YYYY
  dias: number;
  saldo: number;
}

export interface GrupoReporteCartera {
  cliNom: string;
  filas: FilaReporteCartera[];
  subtotal: number;
}

export interface DatosReporteCartera {
  fechaGeneracion: string; // MM/DD/YYYY
  modo: "flat" | "grouped";
  filas: FilaReporteCartera[]; // usado en modo flat
  grupos: GrupoReporteCartera[]; // usado en modo grouped
  total: number;
}

const PH = "#4a6741";
const INK = "#1a1a18";
const RED = "#b91c1c";

const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 36, paddingHorizontal: 40, fontSize: 9, fontFamily: "Helvetica", color: "#333" },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: PH, paddingBottom: 8, marginBottom: 10 },
  brand: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK },
  brandSub: { fontSize: 7, color: "#777", marginTop: 2 },
  docTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: PH, textAlign: "right" },
  docSub: { fontSize: 8, color: "#555", textAlign: "right", marginTop: 2 },
  colsRow: { flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 3, marginBottom: 2 },
  colTh: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: INK, textTransform: "uppercase" },
  cCli: { flex: 1 },
  cNum: { width: 55 },
  cFecha: { width: 62 },
  cDias: { width: 46, textAlign: "right" },
  cSaldo: { width: 68, textAlign: "right" },
  row: { flexDirection: "row", paddingVertical: 3.5, alignItems: "center" },
  grupoHeader: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#f2f4ee", paddingVertical: 4, paddingHorizontal: 4, marginTop: 6 },
  grupoCli: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK },
  grupoSubtotal: { fontSize: 9, fontFamily: "Helvetica-Bold", color: PH },
  totalRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 2, borderTopColor: PH, paddingTop: 8, marginTop: 10 },
});

const fmt = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ColsRow = () => (
  <View style={s.colsRow}>
    <Text style={[s.colTh, s.cCli]}>Client</Text>
    <Text style={[s.colTh, s.cNum]}>Invoice</Text>
    <Text style={[s.colTh, s.cFecha]}>Date</Text>
    <Text style={[s.colTh, s.cDias]}>Days</Text>
    <Text style={[s.colTh, s.cSaldo]}>Balance</Text>
  </View>
);

const Fila = ({ f, showCliente }: { f: FilaReporteCartera; showCliente: boolean }) => {
  const vencida = f.dias > 30;
  const color = vencida ? RED : "#333";
  return (
    <View style={s.row} wrap={false}>
      <Text style={[s.cCli, { color, fontFamily: showCliente ? "Helvetica-Bold" : "Helvetica" }]}>{showCliente ? f.cliNom : ""}</Text>
      <Text style={[s.cNum, { fontFamily: "Courier", fontSize: 8, color }]}>#{String(f.facturaNum).padStart(4, "0")}</Text>
      <Text style={[s.cFecha, { color }]}>{f.fecha}</Text>
      <Text style={[s.cDias, { color, fontFamily: vencida ? "Helvetica-Bold" : "Helvetica" }]}>{f.dias}</Text>
      <Text style={[s.cSaldo, { color, fontFamily: "Helvetica-Bold" }]}>{fmt(f.saldo)}</Text>
    </View>
  );
};

export async function renderReporteCarteraPdf(d: DatosReporteCartera): Promise<Buffer> {
  const doc = (
    <Document title="Aging Report">
      <Page size="LETTER" style={s.page}>
        <View style={s.headerTop} fixed>
          <View>
            <Text style={s.brand}>Palm Hills</Text>
            <Text style={s.brandSub}>Aging Report — Pending Invoices</Text>
          </View>
          <View>
            <Text style={s.docTitle}>AGING REPORT</Text>
            <Text style={s.docSub}>{d.fechaGeneracion}</Text>
          </View>
        </View>

        {d.modo === "flat" ? (
          <>
            <ColsRow />
            {d.filas.map((f, i) => (
              <Fila key={i} f={f} showCliente />
            ))}
          </>
        ) : (
          d.grupos.map((g, gi) => (
            <View key={gi} wrap={false}>
              <View style={s.grupoHeader}>
                <Text style={s.grupoCli}>{g.cliNom}</Text>
                <Text style={s.grupoSubtotal}>{fmt(g.subtotal)}</Text>
              </View>
              <ColsRow />
              {g.filas.map((f, i) => (
                <Fila key={i} f={f} showCliente={false} />
              ))}
            </View>
          ))
        )}

        <View style={s.totalRow} wrap={false}>
          <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: INK }}>Total outstanding</Text>
          <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold", color: PH }}>{fmt(d.total)}</Text>
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
