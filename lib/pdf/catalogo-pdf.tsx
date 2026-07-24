// PDF del catalogo de productos — ver lib/pdf/documento-pdf.tsx para el patron
// general. A diferencia de las facturas/estimates, este es un documento que
// FLUYE solo entre paginas (@react-pdf reparte el grid/tabla automaticamente,
// no hay paginacion manual por altura medida).
//
// Rediseño 2026-07-24: portada con logo + contacto, header/footer con numero
// de pagina en cada hoja de productos, tarjetas con marca/SKU como "pill" y
// precio como badge — antes era una tabla/grid plana sin portada ni
// informacion de la empresa (el usuario lo describio como "generico y pobre").
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer, Svg, Circle } from "@react-pdf/renderer";

export interface ProductoCatalogo {
  nom: string;
  sku?: string;
  precio: number;
  fabricante?: string;
  foto?: string | null; // data URL base64, ya viene del campo productos.foto
}

export interface DatosCatalogo {
  fechaGeneracion: string; // MM/DD/YYYY
  almacenLabel: string; // "All Warehouses" | nombre del almacen
  conPrecio: boolean;
  conFotos: boolean;
  productos: ProductoCatalogo[];
  empresaNombre?: string;
  empresaContacto?: string; // "telefono  ·  email", ver lib/empresa.ts
  logo?: Buffer | Uint8Array;
}

const PH = "#4a6741";
const GOLD = "#b09060";
const INK = "#1a1a18";
const LIGHT = "#eef5e6";
const BORDER = "#e3e7dd";
const MUTED = "#8a8f80";

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 42, paddingHorizontal: 34, fontSize: 9, fontFamily: "Helvetica", color: "#333" },

  // ---- portada ----
  coverPage: { padding: 0 },
  coverTop: { height: "56%", backgroundColor: PH, alignItems: "center", justifyContent: "center", position: "relative" },
  coverLogoCard: {
    width: 128,
    height: 128,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  coverLogoImg: { width: "100%", height: "100%", objectFit: "contain" },
  coverBrandNoLogo: { fontSize: 34, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  coverBrand: { fontSize: 15, fontFamily: "Helvetica-Bold", color: "#ffffff", marginTop: 18, letterSpacing: 1.5 },
  coverGoldRule: { width: 60, height: 3, backgroundColor: GOLD, marginTop: 12, borderRadius: 2 },
  coverBottom: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 44 },
  coverTitle: { fontSize: 30, fontFamily: "Helvetica-Bold", color: INK, textAlign: "center", letterSpacing: 0.5 },
  coverSubtitle: { fontSize: 10.5, color: MUTED, marginTop: 12, textAlign: "center" },
  coverFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 2,
    borderTopColor: GOLD,
    paddingVertical: 16,
    paddingHorizontal: 44,
    flexDirection: "row",
    justifyContent: "center",
    gap: 22,
  },
  coverFooterItem: { fontSize: 9, color: INK, fontFamily: "Helvetica-Bold" },

  // ---- header / footer de las hojas de productos ----
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: PH,
    paddingBottom: 8,
    marginBottom: 14,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerLogo: { width: 24, height: 24, objectFit: "contain" },
  brand: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: INK },
  brandSub: { fontSize: 7.5, color: "#777", marginTop: 1 },
  docTitle: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: PH, textAlign: "right" },
  docSub: { fontSize: 8, color: "#555", textAlign: "right", marginTop: 2 },

  footer: {
    position: "absolute",
    bottom: 18,
    left: 34,
    right: 34,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.75,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: "#999" },

  // ---- tarjetas del grid (con fotos) ----
  grid: { flexDirection: "row", flexWrap: "wrap" },
  card: {
    width: "31.8%",
    marginRight: "2.3%",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 8,
  },
  photoBox: {
    position: "relative",
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "#f7f7f2",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    overflow: "hidden",
  },
  photo: { width: "100%", height: "100%", objectFit: "contain" },
  skuPill: {
    position: "absolute",
    top: 5,
    left: 5,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  skuPillTxt: { fontSize: 6, fontFamily: "Courier-Bold", color: PH },
  cardNom: { fontSize: 7.8, fontFamily: "Helvetica-Bold", color: INK, textTransform: "uppercase", lineHeight: 1.25 },
  cardFabricante: { fontSize: 6.5, color: MUTED, fontFamily: "Helvetica-Oblique", marginTop: 2 },
  priceRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 6 },
  pricePill: { backgroundColor: PH, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pricePillTxt: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#ffffff" },

  // ---- tabla (sin fotos) ----
  colsRow: { flexDirection: "row", backgroundColor: PH, paddingVertical: 6, paddingHorizontal: 7, borderRadius: 4, marginBottom: 4 },
  colTh: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff", textTransform: "uppercase" },
  cSku: { width: 75, fontFamily: "Courier-Bold", fontSize: 7.5 },
  cDesc: { flex: 1, paddingRight: 6 },
  cFabricante: { width: 105, paddingRight: 6 },
  cPrecio: { width: 60, textAlign: "right" },
  row: { flexDirection: "row", paddingVertical: 5.5, paddingHorizontal: 7, alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: BORDER },
});

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Anillos concentricos como textura discreta en la portada — mas seguro que
// intentar recrear la palmera del logo en vector a mano (un primer intento
// con "hojas" simetricas termino leyendose como otra cosa completamente
// distinta). fillOpacity/strokeOpacity van por elemento: el `opacity` en el
// style del <Svg> contenedor NO se respeta en @react-pdf/renderer.
const RingMark = ({ color, opacity, size = 220 }: { color: string; opacity: number; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 220 220">
    <Circle cx={110} cy={110} r={108} stroke={color} strokeWidth={2} fill="none" strokeOpacity={opacity} />
    <Circle cx={110} cy={110} r={78} stroke={color} strokeWidth={2} fill="none" strokeOpacity={opacity} />
    <Circle cx={110} cy={110} r={48} stroke={color} strokeWidth={2} fill="none" strokeOpacity={opacity} />
  </Svg>
);

const CoverPage = ({ d }: { d: DatosCatalogo }) => (
  <Page size="LETTER" style={s.coverPage}>
    <View style={s.coverTop}>
      <View style={{ position: "absolute", bottom: -60, right: -60 }}>
        <RingMark color="#ffffff" opacity={0.14} size={220} />
      </View>
      {d.logo ? (
        <View style={s.coverLogoCard}>
          <Image src={{ data: Buffer.from(d.logo), format: "png" }} style={s.coverLogoImg} />
        </View>
      ) : (
        <Text style={s.coverBrandNoLogo}>{(d.empresaNombre || "Palm Hills").slice(0, 2).toUpperCase()}</Text>
      )}
      <Text style={s.coverBrand}>{(d.empresaNombre || "Palm Hills").toUpperCase()}</Text>
      <View style={s.coverGoldRule} />
    </View>
    <View style={s.coverBottom}>
      <Text style={s.coverTitle}>PRODUCT CATALOG</Text>
      <Text style={s.coverSubtitle}>
        {d.almacenLabel} · {d.productos.length} product{d.productos.length === 1 ? "" : "s"} · {d.fechaGeneracion}
      </Text>
    </View>
    {d.empresaContacto ? (
      <View style={s.coverFooter}>
        {d.empresaContacto.split("·").map((part, i) => (
          <Text key={i} style={s.coverFooterItem}>{part.trim()}</Text>
        ))}
      </View>
    ) : null}
  </Page>
);

const Header = ({ d }: { d: DatosCatalogo }) => (
  <View style={s.headerTop} fixed>
    <View style={s.headerLeft}>
      {d.logo ? <Image src={{ data: Buffer.from(d.logo), format: "png" }} style={s.headerLogo} /> : null}
      <View>
        <Text style={s.brand}>{d.empresaNombre || "Palm Hills"}</Text>
        <Text style={s.brandSub}>Product Catalog — {d.almacenLabel}</Text>
      </View>
    </View>
    <View>
      <Text style={s.docTitle}>CATALOG</Text>
      <Text style={s.docSub}>{d.fechaGeneracion}</Text>
    </View>
  </View>
);

const Footer = ({ d }: { d: DatosCatalogo }) => (
  <View style={s.footer} fixed>
    <Text style={s.footerText}>{d.empresaNombre || "Palm Hills"} · {d.productos.length} products · {d.fechaGeneracion}</Text>
    <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
  </View>
);

export async function renderCatalogoPdf(d: DatosCatalogo): Promise<Buffer> {
  const doc = (
    <Document title="Product Catalog">
      <CoverPage d={d} />
      <Page size="LETTER" style={s.page}>
        <Header d={d} />

        {d.conFotos ? (
          <View style={s.grid}>
            {d.productos.map((p, i) => (
              <View key={i} style={[s.card, (i + 1) % 3 === 0 ? { marginRight: 0 } : {}]} wrap={false}>
                <View style={s.photoBox}>
                  {p.foto ? <Image src={p.foto} style={s.photo} /> : <Text style={{ fontSize: 20, color: "#ccc" }}>—</Text>}
                  {p.sku ? (
                    <View style={s.skuPill}>
                      <Text style={s.skuPillTxt}>{p.sku}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.cardNom}>{p.nom}</Text>
                {p.fabricante ? <Text style={s.cardFabricante}>{p.fabricante}</Text> : null}
                {d.conPrecio ? (
                  <View style={s.priceRow}>
                    <View style={s.pricePill}>
                      <Text style={s.pricePillTxt}>{fmt(p.precio)}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <>
            <View style={s.colsRow} fixed>
              <Text style={[s.colTh, s.cSku]}>SKU</Text>
              <Text style={[s.colTh, s.cDesc]}>Description</Text>
              <Text style={[s.colTh, s.cFabricante]}>Brand</Text>
              {d.conPrecio ? <Text style={[s.colTh, s.cPrecio]}>Price</Text> : null}
            </View>
            {d.productos.map((p, i) => (
              <View key={i} style={[s.row, { backgroundColor: i % 2 === 0 ? "#ffffff" : LIGHT }]} wrap={false}>
                <Text style={s.cSku}>{p.sku || "—"}</Text>
                <Text style={[s.cDesc, { textTransform: "uppercase" }]}>{p.nom}</Text>
                <Text style={[s.cFabricante, { color: MUTED }]}>{p.fabricante || "—"}</Text>
                {d.conPrecio ? <Text style={[s.cPrecio, { fontFamily: "Helvetica-Bold", color: PH }]}>{fmt(p.precio)}</Text> : null}
              </View>
            ))}
          </>
        )}

        <Footer d={d} />
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
