// PDF del catalogo de productos — ver lib/pdf/documento-pdf.tsx para el patron
// general. Documento que FLUYE solo entre paginas (@react-pdf reparte el grid
// automaticamente, no hay paginacion manual por altura medida).
//
// Rediseño premium (2026-11-23), elegido por mockup entre 3 propuestas:
// - Portada "Atelier": verde profundo a sangre, doble marco dorado, logo en un
//   circulo blanco, titulo en serifa italica (Cormorant, la familia del logo).
//   Sin fotos de productos en la portada (pedido explicito).
// - Hojas "Vitrina": banda verde suave por marca con su cantidad, grid de 4
//   tarjetas con la foto sobre blanco y el precio en una pastilla verde.
// - Productos sin foto: un emoji segun lo que son (shampoo, jabon, pastillas…),
//   dibujado como imagen Twemoji — @react-pdf no puede usar los emoji del
//   sistema. Ver `emojiDeProducto`.
//
// Fuentes y emoji viven en public/catalogo/ y llegan como `assets`: una
// carpeta local (test y servidor, via outputFileTracingIncludes) o una URL.
// Sin `assets` el catalogo sale igual, con Helvetica y sin emoji.
import React from "react";
import fs from "fs";
import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";

export interface ProductoCatalogo {
  nom: string;
  sku?: string;
  precio: number;
  foto?: string | null; // data URL base64, ya reducida en el navegador
}

export interface GrupoCatalogo {
  marca: string; // "Other Products" para los que no tienen fabricante
  productos: ProductoCatalogo[];
}

export interface DatosCatalogo {
  fechaGeneracion: string; // MM/DD/YYYY
  almacenLabel: string; // "All Warehouses" | nombre del almacen
  conPrecio: boolean;
  conFotos: boolean;
  grupos: GrupoCatalogo[];
  empresaNombre?: string;
  empresaEslogan?: string;
  empresaContacto?: string; // "telefono  ·  email", ver lib/empresa.ts
  logo?: Buffer | Uint8Array;
  /** Carpeta o URL de public/catalogo (fuentes + emoji). */
  assets?: string;
}

const OTROS = "Other Products";

// ── Paleta ──
const G = "#4a6741"; // verde de la marca
const G_DEEP = "#2c4527"; // portada
const GOLD = "#d6be8c"; // dorado claro sobre el verde
const IVORY = "#f7f4ec";
const SAGE = "#e9efe4";
const INK = "#18200f";
const MUTED = "#6c7562";
const LINE = "#e4eadf";

// ── Emoji por tipo de producto ─────────────────────────────────────────────
// El primer grupo que coincide gana: el orden importa (un "gel" de gripe es
// gripe, no crema). `code` es el nombre del PNG de Twemoji en
// public/catalogo/emoji/.
const GRUPOS_EMOJI: { code: string; label: string; re: RegExp }[] = [
  { code: "1f927", label: "Cold & flu", re: /\b(dayquil|nyquil|cold|flu|gripe|tos|cough|bronqu\w*|rompe pech\w*|vick\w*|jarabe|syrup)\b/i },
  { code: "1f48a", label: "Medicine", re: /\b(tylenol|advil|motrin|claritin|aspirin|ibuprofen|acetaminophen|ketoconazol|caplets?|tablets?|capsul\w*|liqui-?gels?|anti-?diarr\w*|pepto|alka|pastillas?)\b/i },
  { code: "2600", label: "Sun care", re: /\b(spf|sunscreen|bloqueador|solar|neutrogena 70)\b/i },
  { code: "1f3a8", label: "Hair color", re: /\b(tintes?|color\w*|cellophen|nutrisse|dye|gloss)\b/i },
  { code: "1f4a7", label: "Ampoules & serums", re: /\b(ampollas?|ampoules?|suero|serum|gotero|drops?)\b/i },
  { code: "1fad9", label: "Masks & creams", re: /\b(mascarillas?|masks?|cremas?|creams?|jalea|gel)\b/i },
  { code: "1f9fc", label: "Soap", re: /\b(jab[oó]n|soaps?)\b/i },
  { code: "1fad2", label: "Oils", re: /\b(aceites?|oils?|argan)\b/i },
  { code: "1fae7", label: "Powder", re: /\b(polvo|powder|talco|talc|mexana)\b/i },
  { code: "1f45c", label: "Accessories", re: /\b(bolsos?|bags?|cepillos?|brush\w*|peines?|combs?)\b/i },
  { code: "1f9f4", label: "Hair & body care", re: /\b(shampoo|champ[uú]|acondicionador|conditioner|rinse|lotion|loci[oó]n|leave-?in|borasol)\b/i },
];
export const emojiDeProducto = (nom: string) =>
  GRUPOS_EMOJI.find((g) => g.re.test(nom)) || { code: "1f4e6", label: "Product" };

// ── Fuentes ───────────────────────────────────────────────────────────────
const esUrl = (base: string) => /^https?:\/\//.test(base);
const unir = (base: string, rel: string) => (esUrl(base) ? `${base.replace(/\/?$/, "/")}${rel}` : path.join(base, rel));

// Imagen de assets: una URL se la pasa tal cual; un archivo local se lee a
// Buffer (react-pdf toma "C:\..." por una URL con protocolo "c:" y falla).
const imagenAsset = (base: string, rel: string) =>
  esUrl(base) ? unir(base, rel) : { data: fs.readFileSync(unir(base, rel)), format: "png" as const };

function registrarFuentes(assets?: string) {
  if (!assets) return { serif: "Times-Roman", serifItalic: "Times-Italic", sans: "Helvetica", sansBold: "Helvetica-Bold", mono: "Courier" };
  Font.register({
    family: "PHSerif",
    fonts: [
      { src: unir(assets, "cormorant-garamond-latin-500-normal.ttf"), fontWeight: 500 },
      { src: unir(assets, "cormorant-garamond-latin-500-italic.ttf"), fontWeight: 500, fontStyle: "italic" },
      { src: unir(assets, "cormorant-garamond-latin-600-normal.ttf"), fontWeight: 600 },
    ],
  });
  Font.register({
    family: "PHSans",
    fonts: [
      { src: unir(assets, "manrope-latin-500-normal.ttf"), fontWeight: 500 },
      { src: unir(assets, "manrope-latin-700-normal.ttf"), fontWeight: 700 },
      { src: unir(assets, "manrope-latin-800-normal.ttf"), fontWeight: 800 },
    ],
  });
  Font.register({ family: "PHMono", src: unir(assets, "ibm-plex-mono-latin-400-normal.ttf") });
  // Nombres de producto: nunca cortar una palabra con guion a mitad.
  Font.registerHyphenationCallback((w) => [w]);
  return { serif: "PHSerif", serifItalic: "PHSerif", sans: "PHSans", sansBold: "PHSans", mono: "PHMono" };
}

const fmt = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MESES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const mesAnio = (mmddyyyy: string) => {
  const [m, , y] = mmddyyyy.split("/");
  return `${MESES[Number(m) - 1] || ""} ${y || ""}`.trim();
};

// Grid: 4 columnas en 540pt utiles (LETTER 612 - 2×36).
const COLS = 4;
const GAP = 10;
const ANCHO = 540;
const CARD_W = (ANCHO - GAP * (COLS - 1)) / COLS;

export async function renderCatalogoPdf(d: DatosCatalogo): Promise<Buffer> {
  const F = registrarFuentes(d.assets);
  const conFuentes = !!d.assets;
  const w = (n: number) => (conFuentes ? { fontWeight: n } : {});

  const s = StyleSheet.create({
    // ── portada (Atelier) ──
    cover: { backgroundColor: G_DEEP, color: IVORY, fontFamily: F.sans },
    frame1: { position: "absolute", top: 22, left: 22, right: 22, bottom: 22, borderWidth: 0.75, borderColor: "#a99368" },
    frame2: { position: "absolute", top: 27, left: 27, right: 27, bottom: 27, borderWidth: 0.4, borderColor: "#7e7253" },
    logoCirc: { position: "absolute", top: 150, left: 231, width: 150, height: 150, borderRadius: 75, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
    // 100pt: el PNG del logo trae fondo blanco cuadrado; mas grande, sus
    // esquinas (diagonal > 150) se salen del circulo.
    logoImg: { width: 100, height: 100, objectFit: "contain" },
    eyebrow: { position: "absolute", top: 336, left: 0, right: 0, textAlign: "center", fontSize: 8, letterSpacing: 3.4, color: GOLD, fontFamily: F.sans, ...w(500) },
    title: { position: "absolute", top: 352, left: 0, right: 0, textAlign: "center", fontSize: 58, color: IVORY, fontFamily: F.serifItalic, ...(conFuentes ? { fontStyle: "italic", fontWeight: 500 } : {}) },
    rule: { position: "absolute", top: 444, left: 274, width: 64, height: 0.75, backgroundColor: GOLD },
    sub: { position: "absolute", top: 460, left: 40, right: 40, textAlign: "center", fontSize: 9.5, letterSpacing: 1.3, color: "#d9d6cc", fontFamily: F.sans, ...w(500) },
    stats: { position: "absolute", top: 560, left: 90, right: 90, flexDirection: "row", borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#7e7253" },
    stat: { flex: 1, alignItems: "center", paddingVertical: 14 },
    statSep: { borderLeftWidth: 0.5, borderColor: "#7e7253" },
    statNum: { fontSize: 30, color: IVORY, fontFamily: F.serif, ...w(500) },
    statLbl: { fontSize: 7, letterSpacing: 1.6, color: GOLD, marginTop: 4, fontFamily: F.sans, ...w(500) },
    coverFoot: { position: "absolute", bottom: 52, left: 0, right: 0, textAlign: "center", fontSize: 8.5, letterSpacing: 1, color: "#cfccbf", fontFamily: F.sans, ...w(500) },

    // ── hojas (Vitrina) ──
    page: { paddingTop: 58, paddingBottom: 44, paddingHorizontal: 36, fontFamily: F.sans, color: INK, backgroundColor: "#ffffff" },
    head: { position: "absolute", top: 22, left: 36, right: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    headMarca: { flexDirection: "row", alignItems: "center", gap: 6 },
    headLogo: { width: 20, height: 20, objectFit: "contain" },
    headNom: { fontSize: 9, color: INK, fontFamily: F.sansBold, ...w(800) },
    headDer: { fontSize: 8, color: MUTED, fontFamily: F.sansBold, ...w(700) },
    foot: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#8b9382", fontFamily: F.sans, ...w(500) },

    sec: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: SAGE, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 14, marginBottom: 10 },
    secNom: { fontSize: 13, color: INK, fontFamily: F.sansBold, ...w(800) },
    secCant: { fontSize: 8, color: G, backgroundColor: "#ffffff", borderRadius: 99, paddingVertical: 3, paddingHorizontal: 8, fontFamily: F.sansBold, ...w(700) },

    grid: { flexDirection: "row", flexWrap: "wrap" },
    card: { width: CARD_W, borderWidth: 1, borderColor: LINE, borderRadius: 12, overflow: "hidden", marginBottom: GAP, backgroundColor: "#ffffff" },
    // Sin fondo propio: uno blanco tapaba las esquinas redondeadas del borde.
    ph: { height: 104, padding: 9, alignItems: "center", justifyContent: "center" },
    phImg: { width: CARD_W - 20, height: 86, objectFit: "contain" },
    emo: { height: 104, alignItems: "center", justifyContent: "center", backgroundColor: SAGE },
    emoImg: { width: 40, height: 40 },
    emoLbl: { fontSize: 6, letterSpacing: 1.1, color: "#7d8574", marginTop: 6, fontFamily: F.sans, ...w(500) },
    txt: { paddingTop: 7, paddingBottom: 9, paddingHorizontal: 9 },
    nom: { fontSize: 7.6, lineHeight: 1.3, color: INK, minHeight: 30, fontFamily: F.sansBold, ...w(700) },
    fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 5 },
    sku: { fontSize: 6.5, color: "#8b9382", fontFamily: F.mono },
    precio: { fontSize: 9, color: "#ffffff", backgroundColor: G, borderRadius: 99, paddingVertical: 3, paddingHorizontal: 7, fontFamily: F.sansBold, ...w(800) },

    // ── lista (sin fotos) ──
    th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4, paddingHorizontal: 8 },
    thTxt: { fontSize: 7, letterSpacing: 1, color: MUTED, fontFamily: F.sansBold, ...w(700) },
    tr: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 8 },
    trNom: { flex: 1, fontSize: 8.4, color: INK, paddingRight: 10, fontFamily: F.sansBold, ...w(700) },
    trSku: { width: 80, fontSize: 7.6, color: "#6f7867", fontFamily: F.mono },
    trPrecio: { width: 62, textAlign: "right", fontSize: 8.8, color: G, fontFamily: F.sansBold, ...w(800) },
  });

  const nombre = d.empresaNombre || "Palm Hills";
  const total = d.grupos.reduce((a, g) => a + g.productos.length, 0);
  const marcas = d.grupos.filter((g) => g.marca !== OTROS).length;
  const anio = d.fechaGeneracion.split("/")[2] || "";
  const logoSrc = d.logo ? { data: Buffer.from(d.logo), format: "png" as const } : null;

  const tarjeta = (p: ProductoCatalogo, i: number) => {
    const em = !p.foto ? emojiDeProducto(p.nom) : null;
    return (
      <View key={i} style={[s.card, { marginRight: (i + 1) % COLS === 0 ? 0 : GAP }]} wrap={false}>
        {p.foto ? (
          <View style={s.ph}>
            <Image src={p.foto} style={s.phImg} />
          </View>
        ) : (
          <View style={s.emo}>
            {d.assets ? <Image src={imagenAsset(d.assets, `emoji/${em!.code}.png`)} style={s.emoImg} /> : null}
            <Text style={s.emoLbl}>{em!.label.toUpperCase()}</Text>
          </View>
        )}
        <View style={s.txt}>
          <Text style={s.nom}>{p.nom.replace(/\s+/g, " ").toUpperCase()}</Text>
          <View style={s.fila}>
            <Text style={s.sku}>{p.sku || " "}</Text>
            {d.conPrecio ? <Text style={s.precio}>{fmt(p.precio)}</Text> : null}
          </View>
        </View>
      </View>
    );
  };

  const doc = (
    <Document title={`${nombre} — Product Catalog`}>
      {/* Portada (Atelier) */}
      <Page size="LETTER" style={s.cover}>
        <View style={s.frame1} />
        <View style={s.frame2} />
        {logoSrc ? (
          <View style={s.logoCirc}>
            <Image src={logoSrc} style={s.logoImg} />
          </View>
        ) : null}
        <Text style={s.eyebrow}>{[nombre, d.empresaEslogan].filter(Boolean).join("  ·  ").toUpperCase()}</Text>
        <Text style={s.title}>The Collection</Text>
        <View style={s.rule} />
        <Text style={s.sub}>{`PRODUCT CATALOG  ·  ${d.almacenLabel}  ·  ${mesAnio(d.fechaGeneracion)}`.toUpperCase()}</Text>
        <View style={s.stats}>
          <View style={s.stat}>
            <Text style={s.statNum}>{total}</Text>
            <Text style={s.statLbl}>PRODUCTS</Text>
          </View>
          <View style={[s.stat, s.statSep]}>
            <Text style={s.statNum}>{marcas}</Text>
            <Text style={s.statLbl}>BRANDS</Text>
          </View>
          <View style={[s.stat, s.statSep]}>
            <Text style={s.statNum}>{anio}</Text>
            <Text style={s.statLbl}>EDITION</Text>
          </View>
        </View>
        {d.empresaContacto ? <Text style={s.coverFoot}>{d.empresaContacto}</Text> : null}
      </Page>

      {/* Productos (Vitrina) */}
      <Page size="LETTER" style={s.page} wrap>
        <View style={s.head} fixed>
          <View style={s.headMarca}>
            {logoSrc ? <Image src={logoSrc} style={s.headLogo} /> : null}
            <Text style={s.headNom}>{nombre}</Text>
          </View>
          <Text style={s.headDer}>{`Product Catalog ${anio}  ·  ${d.almacenLabel}`}</Text>
        </View>
        <View style={s.foot} fixed>
          <Text>{d.conPrecio ? "Prices in USD · subject to change" : `Updated ${d.fechaGeneracion}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber - 1} of ${totalPages - 1}`} />
        </View>

        {d.grupos.map((g, gi) => {
          const banda = (
            <View style={[s.sec, gi === 0 ? { marginTop: 0 } : {}]}>
              <Text style={s.secNom}>{g.marca}</Text>
              <Text style={s.secCant}>{`${g.productos.length} ${g.productos.length === 1 ? "product" : "products"}`}</Text>
            </View>
          );
          const filaLista = (p: ProductoCatalogo, i: number) => (
            <View key={i} style={[s.tr, i % 2 === 1 ? { backgroundColor: "#f5f8f2" } : {}]} wrap={false}>
              <Text style={s.trNom}>{p.nom.replace(/\s+/g, " ").toUpperCase()}</Text>
              <Text style={s.trSku}>{p.sku || "—"}</Text>
              {d.conPrecio ? <Text style={s.trPrecio}>{fmt(p.precio)}</Text> : null}
            </View>
          );
          // La banda de la marca va pegada a su primera fila en un bloque que
          // no se parte: nunca queda sola (ni cortada) al pie de una hoja.
          return d.conFotos ? (
            <View key={gi}>
              <View wrap={false}>
                {banda}
                <View style={s.grid}>{g.productos.slice(0, COLS).map(tarjeta)}</View>
              </View>
              {g.productos.length > COLS ? (
                <View style={s.grid}>{g.productos.slice(COLS).map((p, i) => tarjeta(p, i + COLS))}</View>
              ) : null}
            </View>
          ) : (
            <View key={gi}>
              <View wrap={false}>
                {banda}
                <View style={s.th}>
                  <Text style={[s.thTxt, { flex: 1 }]}>PRODUCT</Text>
                  <Text style={[s.thTxt, { width: 80 }]}>SKU</Text>
                  {d.conPrecio ? <Text style={[s.thTxt, { width: 62, textAlign: "right" }]}>PRICE</Text> : null}
                </View>
                {g.productos.slice(0, 3).map(filaLista)}
              </View>
              {g.productos.slice(3).map((p, i) => filaLista(p, i + 3))}
            </View>
          );
        })}
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
