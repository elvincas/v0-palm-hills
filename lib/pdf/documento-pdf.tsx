// Generador de PDF para facturas, estimados y quotations con @react-pdf/renderer.
// Se genera el PDF directamente (sin window.print) porque el motor de
// impresion de iOS/Safari no repite headers ni respeta los cortes de pagina:
// aqui la paginacion es exacta y el header sale en todas las hojas.
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

export interface LineaDoc {
  prodNom: string;
  sku?: string;
  qty: number;
  precio: number;        // precio final por unidad
  precioOriginal?: number; // si hay descuento, precio antes del descuento
}

export interface DatosDocumento {
  tipo: "invoice" | "estimate" | "quotation";
  num: number | string;
  fecha: string; // MM/DD/YYYY
  estado?: string;
  cliente: {
    nom: string;
    codigo?: string;
    dir?: string;
    tel?: string;
  };
  lineas: LineaDoc[];
  total: number;
  totalPagado?: number;
  // Si la factura esta pagada: fecha del ultimo pago y metodos usados
  pagoInfo?: { fecha: string; metodos: string[] };
  logo?: Buffer | Uint8Array;
  // Company Profile (2026-07-24): nombre/contacto editables, ver lib/empresa.ts.
  // Opcional con fallback para no romper llamadas viejas.
  empresaNombre?: string;
  empresaContacto?: string;
  // Mensaje de plantilla (Document Templates, fase B) — opcional, ademas del
  // contenido estructural fijo (firma de entrega, disclaimer de estimate).
  mensaje?: string;
  // Solo quotations: fecha limite de validez, si se fijo una.
  validoHasta?: string;
  // Opciones de layout (fase B2, 2026-07-24) — presets, no un editor visual
  // libre: posicion del logo, escala de tipografia, color de acento, y
  // mostrar/ocultar los bloques de firma (factura) / disclaimer (estimate,
  // quotation). Todos opcionales con default para no romper llamadas viejas.
  logoPos?: "left" | "center" | "right";
  fontScale?: number;
  accentColor?: string;
  showSignature?: boolean;
  showDisclaimer?: boolean;
}

const GOLD = "#b09060";
const INK = "#1a1a18";

// StyleSheet como funcion de (color de acento, escala de tipografia) en vez
// de un objeto estatico — asi Document Templates puede cambiar el aspecto
// del PDF sin tocar este archivo. `f` redondea a 2 decimales para que
// react-pdf no reciba floats raros.
const f = (n: number, scale: number) => Math.round(n * scale * 100) / 100;

const makeStyles = (accent: string, scale: number) =>
  StyleSheet.create({
    page: {
      paddingTop: 158,
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
    brandSub: { fontSize: f(7, scale), color: "#777", marginTop: 2 },
    docTitle: { fontSize: f(13, scale), fontFamily: "Helvetica-Bold", textAlign: "right" },
    docNum: { fontSize: f(9, scale), fontFamily: "Courier", color: "#555", textAlign: "right", marginTop: 2 },
    pageNum: { fontSize: f(6.5, scale), color: "#999", textAlign: "right", marginTop: 2 },
    billRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      backgroundColor: "#fafaf7",
      paddingVertical: 7,
      paddingHorizontal: 8,
    },
    lbl: { fontSize: f(6, scale), fontFamily: "Helvetica-Bold", color: "#888", textTransform: "uppercase", letterSpacing: 0.5 },
    cliNom: { fontSize: f(9.5, scale), fontFamily: "Helvetica-Bold", color: INK, marginTop: 1.5 },
    cliDet: { fontSize: f(7.5, scale), color: "#555", marginTop: 1.5 },
    colsRow: {
      flexDirection: "row",
      borderBottomWidth: 1.5,
      borderBottomColor: INK,
      paddingBottom: 3,
      paddingTop: 8,
    },
    colTh: { fontSize: f(7.5, scale), fontFamily: "Helvetica-Bold", color: INK, textTransform: "uppercase" },
    row: { flexDirection: "row", paddingVertical: 4.5, alignItems: "center" },
    cQty: { width: 28, fontSize: f(9, scale) },
    cSku: { width: 78, fontFamily: "Courier", fontSize: f(7, scale), color: "#888" },
    cDesc: { flex: 1, paddingRight: 6, fontSize: f(8, scale) },
    cPrice: { width: 58, textAlign: "right", fontSize: f(9, scale) },
    cAmt: { width: 62, textAlign: "right", fontSize: f(9, scale) },
    strike: { fontSize: f(7, scale), color: "#999", textDecoration: "line-through", textAlign: "right" },
    descPrecio: { color: accent, fontFamily: "Helvetica-Bold", textAlign: "right" },
    totales: { marginTop: 12, alignItems: "flex-end" },
    totBox: { width: 190 },
    totLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, fontSize: f(9, scale) },
    totGrand: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 2,
      borderTopColor: accent,
      paddingTop: 6,
      marginTop: 3,
    },
    firma: { marginTop: 16, borderTopWidth: 1, borderTopColor: "#ddd", paddingTop: 10 },
    firmaRow: { flexDirection: "row", gap: 30, marginTop: 12 },
    firmaCampo: { borderBottomWidth: 1, borderBottomColor: "#999", height: 16 },
    firmaLbl: { fontSize: f(6.5, scale), color: "#888", marginTop: 2 },
    gracias: { marginTop: 18, textAlign: "center", fontSize: f(9.5, scale), fontFamily: "Helvetica-Bold", color: accent },
    disclaimer: { marginTop: 16, borderTopWidth: 1, borderTopColor: "#ddd", paddingTop: 10, textAlign: "center", fontSize: f(7.5, scale), color: "#888" },
    mensaje: { marginTop: 12, padding: 8, backgroundColor: "#f2f4ee", borderRadius: 3, textAlign: "center", fontSize: f(8, scale), color: "#444", fontFamily: "Helvetica-Oblique" },
  });

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function renderDocumentoPdf(d: DatosDocumento): Promise<Buffer> {
  const esFactura = d.tipo === "invoice";
  const esCotizacion = d.tipo === "quotation";
  const titulo = esFactura ? "INVOICE" : esCotizacion ? "QUOTATION" : "ESTIMATE";
  const accent = d.accentColor || "#4a6741";
  const scale = d.fontScale || 1;
  const logoPos = d.logoPos || "left";
  const showSignature = d.showSignature ?? true;
  const showDisclaimer = d.showDisclaimer ?? true;
  const colorTitulo = esFactura ? accent : GOLD;
  const numTexto = esFactura ? `#${String(d.num).padStart(4, "0")}` : esCotizacion ? `#${String(d.num).padStart(4, "0")}` : `Order #${d.num}`;
  const subtotal = d.lineas.reduce((a, l) => a + l.qty * (l.precioOriginal ?? l.precio), 0);
  const descuento = subtotal - d.lineas.reduce((a, l) => a + l.qty * l.precio, 0);
  const totalPagado = d.totalPagado || 0;
  const saldo = d.total - totalPagado;
  const s = makeStyles(accent, scale);

  const logoBlock = (
    <View style={s.logoRow}>
      {d.logo ? <Image src={{ data: Buffer.from(d.logo), format: "png" }} style={s.logo} /> : null}
      <View>
        <Text style={s.brand}>{d.empresaNombre || "Palm Hills"}</Text>
        <Text style={s.brandSub}>{d.empresaContacto || "(551) 248-3442  ·  admin@palmhillsco.net"}</Text>
      </View>
    </View>
  );
  const docInfoBlock = (
    <View>
      <Text style={[s.docTitle, { color: colorTitulo }]}>{titulo}</Text>
      <Text style={s.docNum}>{numTexto}</Text>
      <Text style={s.pageNum} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );

  const doc = (
    <Document title={`${titulo} ${numTexto}`}>
      <Page size="LETTER" style={s.page}>
        {/* Header fijo: se repite en TODAS las hojas */}
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
          <View style={s.billRow}>
            <View style={{ maxWidth: 300 }}>
              <Text style={s.lbl}>{esFactura ? "Bill to" : "Client"}</Text>
              <Text style={s.cliNom}>{d.cliente.nom}</Text>
              {d.cliente.codigo ? <Text style={[s.cliDet, { fontFamily: "Courier" }]}>#{d.cliente.codigo}</Text> : null}
              {d.cliente.dir ? <Text style={s.cliDet}>{d.cliente.dir}</Text> : null}
              {d.cliente.tel ? <Text style={s.cliDet}>{d.cliente.tel}</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.lbl}>Date</Text>
              <Text style={[s.cliDet, { color: INK }]}>{d.fecha}</Text>
              {esFactura && d.estado ? (
                <>
                  <Text style={[s.lbl, { marginTop: 5 }]}>Status</Text>
                  {d.estado === "Paid" ? (
                    <>
                      <Text style={{ fontSize: f(14, scale), fontFamily: "Helvetica-Bold", color: "#15803d", textAlign: "right" }}>PAID</Text>
                      {d.pagoInfo ? (
                        <Text style={{ fontSize: f(7, scale), fontFamily: "Helvetica-Bold", color: "#15803d", textAlign: "right", marginTop: 1 }}>
                          {d.pagoInfo.fecha}
                          {d.pagoInfo.metodos.length ? ` · ${d.pagoInfo.metodos.join(" + ")}` : ""}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={[s.cliDet, { fontFamily: "Helvetica-Bold", color: "#b45309" }]}>{d.estado}</Text>
                  )}
                </>
              ) : null}
            </View>
          </View>
          <View style={s.colsRow}>
            <Text style={[s.colTh, s.cQty]}>Qty.</Text>
            <Text style={[s.colTh, s.cSku, { color: INK, fontFamily: "Helvetica-Bold", fontSize: f(7.5, scale) }]}>SKU</Text>
            <Text style={[s.colTh, s.cDesc]}>Description</Text>
            <Text style={[s.colTh, s.cPrice]}>Price</Text>
            <Text style={[s.colTh, s.cAmt]}>Amount</Text>
          </View>
        </View>

        {/* Filas: fluyen y cortan solas; el wrap las mantiene enteras */}
        {d.lineas.map((l, i) => {
          const conDesc = l.precioOriginal !== undefined && l.precioOriginal !== l.precio;
          return (
            <View key={i} style={[s.row, { backgroundColor: i % 2 === 0 ? "#ffffff" : "#e3e9da" }]} wrap={false}>
              <Text style={s.cQty}>{l.qty}</Text>
              <Text style={s.cSku}>{l.sku || "—"}</Text>
              <Text style={s.cDesc}>{l.prodNom.toUpperCase()}</Text>
              <View style={s.cPrice}>
                {conDesc ? <Text style={s.strike}>{fmt(l.precioOriginal!)}</Text> : null}
                <Text style={conDesc ? s.descPrecio : { textAlign: "right" }}>{fmt(l.precio)}</Text>
              </View>
              <View style={s.cAmt}>
                {conDesc ? <Text style={s.strike}>{fmt(l.qty * l.precioOriginal!)}</Text> : null}
                <Text style={conDesc ? s.descPrecio : { textAlign: "right", fontFamily: "Helvetica-Bold" }}>
                  {fmt(l.qty * l.precio)}
                </Text>
              </View>
            </View>
          );
        })}

        {/* Totales + firma/disclaimer: bloque entero, solo en la ultima hoja */}
        <View wrap={false}>
          <View style={s.totales}>
            <View style={s.totBox}>
              <View style={s.totLine}>
                <Text style={{ color: "#666" }}>Subtotal</Text>
                <Text>{fmt(subtotal)}</Text>
              </View>
              {descuento > 0.01 ? (
                <View style={s.totLine}>
                  <Text style={{ color: accent }}>Discount</Text>
                  <Text style={{ color: accent }}>-{fmt(descuento)}</Text>
                </View>
              ) : null}
              <View style={s.totGrand}>
                <Text style={{ fontSize: f(11, scale), fontFamily: "Helvetica-Bold", color: INK }}>
                  {esFactura ? "Total" : "Estimated total"}
                </Text>
                <Text style={{ fontSize: f(13, scale), fontFamily: "Helvetica-Bold", color: accent }}>{fmt(d.total)}</Text>
              </View>
              {esFactura && totalPagado > 0 ? (
                <>
                  <View style={s.totLine}>
                    <Text style={{ color: "#15803d" }}>Paid</Text>
                    <Text style={{ color: "#15803d" }}>-{fmt(totalPagado)}</Text>
                  </View>
                  <View style={[s.totLine, { borderTopWidth: 1, borderTopColor: "#ddd" }]}>
                    <Text style={{ fontFamily: "Helvetica-Bold", color: INK }}>Balance Due</Text>
                    <Text style={{ fontFamily: "Helvetica-Bold", color: saldo <= 0 ? "#15803d" : "#b45309" }}>
                      {fmt(Math.max(0, saldo))}
                    </Text>
                  </View>
                </>
              ) : null}
            </View>
          </View>

          {esFactura ? (
            <>
              {showSignature && (
                <View style={s.firma}>
                  <Text style={s.lbl}>Delivery confirmation</Text>
                  <View style={s.firmaRow}>
                    <View style={{ width: 130 }}>
                      <View style={s.firmaCampo} />
                      <Text style={s.firmaLbl}>Order received signature</Text>
                    </View>
                    <View style={{ width: 90 }}>
                      <View style={s.firmaCampo} />
                      <Text style={s.firmaLbl}>Date</Text>
                    </View>
                    <View style={{ width: 170 }}>
                      <View style={s.firmaCampo} />
                      <Text style={s.firmaLbl}>Name of recipient</Text>
                    </View>
                  </View>
                </View>
              )}
              <Text style={s.gracias}>Thank you for your purchase!</Text>
            </>
          ) : (
            showDisclaimer && (
              <Text style={s.disclaimer}>
                {esCotizacion
                  ? `This is a price quotation${d.validoHasta ? `, valid until ${d.validoHasta}` : ""} and does not reserve inventory.`
                  : "This is an estimate and may vary based on availability at the time of dispatch."}
              </Text>
            )
          )}
          {d.mensaje ? <Text style={s.mensaje}>{d.mensaje}</Text> : null}
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
