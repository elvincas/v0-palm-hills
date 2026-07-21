// PDF del catalogo de productos — ver lib/pdf/documento-pdf.tsx. Tabla/grid que
// fluye sola entre paginas, @react-pdf reparte el contenido sin paginacion manual.
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

export interface ProductoCatalogo {
  nom: string;
  sku?: string;
  precio: number;
  foto?: string | null; // data URL base64, ya viene del campo productos.foto
}

export interface DatosCatalogo {
  fechaGeneracion: string; // MM/DD/YYYY
  almacenLabel: string; // "Both" | "Palm Hills" | "Castillo"
  conPrecio: boolean;
  conFotos: boolean;
  productos: ProductoCatalogo[];
}

const PH = "#4a6741";
const INK = "#1a1a18";

const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 36, paddingHorizontal: 36, fontSize: 9, fontFamily: "Helvetica", color: "#333" },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: PH, paddingBottom: 8, marginBottom: 12 },
  brand: { fontSize: 12, fontFamily: "Helvetica-Bold", color: INK },
  brandSub: { fontSize: 7.5, color: "#777", marginTop: 2 },
  docTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: PH, textAlign: "right" },
  docSub: { fontSize: 8, color: "#555", textAlign: "right", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  card: {
    width: "31.8%",
    marginRight: "2.3%",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e3e7dd",
    borderRadius: 4,
    padding: 6,
    alignItems: "center",
  },
  photoBox: { width: "100%", aspectRatio: 1, backgroundColor: "#f5f5f0", borderRadius: 3, alignItems: "center", justifyContent: "center", marginBottom: 4, overflow: "hidden" },
  photo: { width: "100%", height: "100%", objectFit: "contain" },
  cardNom: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: INK, textAlign: "center", textTransform: "uppercase" },
  cardSku: { fontSize: 6.5, fontFamily: "Courier", color: "#888", textAlign: "center", marginTop: 2 },
  cardPrecio: { fontSize: 9, fontFamily: "Helvetica-Bold", color: PH, textAlign: "center", marginTop: 3 },
  colsRow: { flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 3, marginBottom: 2 },
  colTh: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: INK, textTransform: "uppercase" },
  cSku: { width: 80, fontFamily: "Courier", fontSize: 7.5 },
  cDesc: { flex: 1, paddingRight: 6 },
  cPrecio: { width: 60, textAlign: "right" },
  row: { flexDirection: "row", paddingVertical: 4, alignItems: "center" },
});

const fmt = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Header = ({ d }: { d: DatosCatalogo }) => (
  <View style={s.headerTop} fixed>
    <View>
      <Text style={s.brand}>Palm Hills</Text>
      <Text style={s.brandSub}>Product Catalog — {d.almacenLabel}</Text>
    </View>
    <View>
      <Text style={s.docTitle}>CATALOG</Text>
      <Text style={s.docSub}>{d.fechaGeneracion}</Text>
    </View>
  </View>
);

export async function renderCatalogoPdf(d: DatosCatalogo): Promise<Buffer> {
  const doc = (
    <Document title="Product Catalog">
      <Page size="LETTER" style={s.page}>
        <Header d={d} />

        {d.conFotos ? (
          <View style={s.grid}>
            {d.productos.map((p, i) => (
              <View key={i} style={s.card} wrap={false}>
                <View style={s.photoBox}>
                  {p.foto ? <Image src={p.foto} style={s.photo} /> : <Text style={{ fontSize: 20, color: "#ccc" }}>—</Text>}
                </View>
                <Text style={s.cardNom}>{p.nom}</Text>
                {p.sku ? <Text style={s.cardSku}>{p.sku}</Text> : null}
                {d.conPrecio ? <Text style={s.cardPrecio}>{fmt(p.precio)}</Text> : null}
              </View>
            ))}
          </View>
        ) : (
          <>
            <View style={s.colsRow} fixed>
              <Text style={[s.colTh, s.cSku]}>SKU</Text>
              <Text style={[s.colTh, s.cDesc]}>Description</Text>
              {d.conPrecio ? <Text style={[s.colTh, s.cPrecio]}>Price</Text> : null}
            </View>
            {d.productos.map((p, i) => (
              <View key={i} style={[s.row, { backgroundColor: i % 2 === 0 ? "#ffffff" : "#f2f4ee" }]} wrap={false}>
                <Text style={s.cSku}>{p.sku || "—"}</Text>
                <Text style={[s.cDesc, { textTransform: "uppercase" }]}>{p.nom}</Text>
                {d.conPrecio ? <Text style={[s.cPrecio, { fontFamily: "Helvetica-Bold", color: PH }]}>{fmt(p.precio)}</Text> : null}
              </View>
            ))}
          </>
        )}
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
