// Hoja de conteo fisico de inventario (2026-07-29) — se imprime, se llena a
// mano caminando el almacen, y despues se pasan los numeros a la app.
//
// Ver lib/pdf/catalogo-pdf.tsx para el patron general: es un documento que
// FLUYE solo entre paginas (@react-pdf reparte la tabla, no hay paginacion
// manual por altura medida como en factura/estimate).
//
// Decisiones de diseno (mockup aprobado por el usuario, opcion A):
// - Agrupada por ubicacion: se cuenta caminando un estante completo, no
//   siguiendo un orden alfabetico que obliga a ir y volver por el almacen.
// - "Conteo a ciegas" por defecto: NO se imprime el stock del sistema. Si el
//   papel dice 65, la cabeza cuenta hasta 65 y para. Es un interruptor
//   (`conSistema`) para cuando solo se quiere verificar rapido.
// - Casillas en blanco para Cajas / Sueltas / Total. La multiplicacion en papel
//   se hace o no; lo que importa es anotar cajas y sueltas, la app rehace la
//   cuenta al capturar.
// - `U/box` se IMPRIME cuando el producto la tiene cargada y se deja como
//   casilla en blanco cuando no: hoy la mayoria de los productos no la tienen,
//   y el conteo es justamente la oportunidad de averiguarla y anotarla.
// - La columna de ubicacion va SIEMPRE, con el valor impreso o en blanco para
//   escribirlo: el primer conteo se hace con las ubicaciones vacias y sirve
//   para cargarlas.
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

export interface ProductoConteo {
  nom: string;
  sku?: string;
  ubicacion?: string;
  cajas?: number; // unidades por caja, 0/undefined = no se sabe todavia
  stock: number; // solo se imprime si conSistema
}

export interface GrupoConteo {
  titulo: string; // ubicacion, marca, o "" cuando no hay agrupacion
  productos: ProductoConteo[];
}

export interface DatosConteo {
  fechaGeneracion: string; // MM/DD/YYYY
  almacenLabel: string;
  conSistema: boolean; // false = conteo a ciegas
  grupos: GrupoConteo[];
  empresaNombre?: string;
  empresaContacto?: string; // "telefono  ·  email", ver lib/empresa.ts
  logo?: Buffer | Uint8Array;
}

const PH = "#4a6741";
const GOLD = "#b09060";
const INK = "#1a1a18";
const LIGHT = "#eef1e9";
const BORDER = "#e2e6da";
const MUTED = "#8a8f80";
const CELL_BORDER = "#cfd5c6";

const totalProductos = (d: DatosConteo) => d.grupos.reduce((acc, g) => acc + g.productos.length, 0);

const s = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 46, paddingHorizontal: 34, fontSize: 9, fontFamily: "Helvetica", color: "#333" },

  // ---- header ----
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: PH,
    paddingBottom: 8,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerLogo: { width: 30, height: 30, objectFit: "contain" },
  brand: { fontSize: 12, fontFamily: "Helvetica-Bold", color: INK },
  brandSub: { fontSize: 7.5, color: MUTED, marginTop: 1.5 },
  docTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: PH, textAlign: "right", letterSpacing: 0.6 },
  docSub: { fontSize: 8, color: "#555", textAlign: "right", marginTop: 2.5 },

  // ---- campos a llenar a mano en la primera hoja ----
  fields: { flexDirection: "row", gap: 16, paddingTop: 9, paddingBottom: 4 },
  field: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  fieldLabel: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: MUTED },
  fieldLine: { flex: 1, borderBottomWidth: 0.75, borderBottomColor: "#b9bfae", height: 11 },

  // ---- banda de seccion (ubicacion / marca) ----
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    backgroundColor: LIGHT,
    borderLeftWidth: 3,
    borderLeftColor: PH,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginTop: 10,
  },
  sectionHeaderText: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: PH, textTransform: "uppercase", letterSpacing: 0.4 },
  sectionCount: { fontSize: 7.5, color: MUTED },

  // ---- tabla ----
  thRow: { flexDirection: "row", alignItems: "flex-end", borderBottomWidth: 1, borderBottomColor: INK, paddingVertical: 4, paddingHorizontal: 2 },
  th: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 22, borderBottomWidth: 0.5, borderBottomColor: BORDER, paddingHorizontal: 2 },

  cLoc: { width: 46, paddingRight: 4 },
  cSku: { width: 60, paddingRight: 4 },
  cNom: { flex: 1, paddingRight: 6 },
  cBox: { width: 40, paddingHorizontal: 3 },
  cSys: { width: 34, paddingHorizontal: 3 },
  cWrite: { width: 54, paddingHorizontal: 3 },
  cTotal: { width: 62, paddingHorizontal: 3 },
  cTick: { width: 20, alignItems: "center" },

  loc: { fontSize: 7.5, fontFamily: "Courier-Bold", color: PH },
  sku: { fontSize: 7, fontFamily: "Courier", color: "#5a6152" },
  nom: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: INK, textTransform: "uppercase" },
  num: { fontSize: 8, textAlign: "center", color: "#5a6152" },
  sys: { fontSize: 8, textAlign: "center", color: "#9aa08e" },

  // casilla para escribir a mano
  cell: { height: 15, borderWidth: 0.75, borderColor: CELL_BORDER, borderRadius: 2, backgroundColor: "#fafbf8" },
  cellTotal: { height: 15, borderWidth: 0.75, borderColor: "#b9c2ac", borderRadius: 2, backgroundColor: "#f1f4ec" },
  cellSmall: { height: 13, borderWidth: 0.75, borderColor: CELL_BORDER, borderRadius: 2, backgroundColor: "#fafbf8" },
  tick: { width: 10, height: 10, borderWidth: 0.75, borderColor: "#b9bfae", borderRadius: 2 },

  // ---- footer ----
  footer: {
    position: "absolute",
    bottom: 18,
    left: 34,
    right: 34,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 0.75,
    borderTopColor: BORDER,
    paddingTop: 7,
  },
  signRow: { flexDirection: "row", gap: 22, flex: 1 },
  signBox: { width: 150 },
  signLine: { borderBottomWidth: 0.75, borderBottomColor: "#b9bfae", height: 14, marginBottom: 2.5 },
  signLabel: { fontSize: 6.5, color: MUTED },
  footerText: { fontSize: 7, color: "#999" },

  goldRule: { height: 2, backgroundColor: GOLD, width: 46, marginTop: 6, borderRadius: 1 },
});

const Header = ({ d }: { d: DatosConteo }) => {
  const total = totalProductos(d);
  return (
    <View fixed>
      <View style={s.headerTop}>
        <View style={s.headerLeft}>
          {d.logo ? <Image src={{ data: Buffer.from(d.logo), format: "png" }} style={s.headerLogo} /> : null}
          <View>
            <Text style={s.brand}>{d.empresaNombre || "Palm Hills"}</Text>
            {d.empresaContacto ? <Text style={s.brandSub}>{d.empresaContacto}</Text> : null}
          </View>
        </View>
        <View>
          <Text style={s.docTitle}>PHYSICAL COUNT</Text>
          {/* "Warehouse · X" y no solo "X": el almacen principal suele llamarse
              igual que la empresa y el encabezado quedaba con el nombre repetido. */}
          <Text style={s.docSub}>Warehouse · {d.almacenLabel}</Text>
          <Text style={s.docSub}>
            {d.fechaGeneracion} · {total} item{total === 1 ? "" : "s"}
          </Text>
        </View>
      </View>
      <View style={s.fields}>
        {["Counted by", "Date", "Started", "Finished"].map((label) => (
          <View key={label} style={s.field}>
            <Text style={s.fieldLabel}>{label}</Text>
            <View style={s.fieldLine} />
          </View>
        ))}
      </View>
    </View>
  );
};

const Footer = ({ d }: { d: DatosConteo }) => (
  <View style={s.footer} fixed>
    <View style={s.signRow}>
      <View style={s.signBox}>
        <View style={s.signLine} />
        <Text style={s.signLabel}>Counted by</Text>
      </View>
      <View style={s.signBox}>
        <View style={s.signLine} />
        <Text style={s.signLabel}>Checked by</Text>
      </View>
    </View>
    <Text
      style={s.footerText}
      render={({ pageNumber, totalPages }) =>
        `${d.empresaNombre || "Palm Hills"} · ${d.fechaGeneracion} · Page ${pageNumber} of ${totalPages}`
      }
    />
  </View>
);

// El encabezado de columnas se repite en cada seccion (y no como `fixed` de
// pagina) porque entre secciones cambia el contexto: asi una seccion que
// arranca a mitad de hoja tambien lleva sus titulos encima.
const ColumnHeader = ({ conSistema }: { conSistema: boolean }) => (
  <View style={s.thRow} wrap={false}>
    <Text style={[s.th, s.cLoc]}>Loc.</Text>
    <Text style={[s.th, s.cSku]}>SKU</Text>
    <Text style={[s.th, s.cNom]}>Product</Text>
    <Text style={[s.th, s.cBox, { textAlign: "center" }]}>U/box</Text>
    {conSistema ? <Text style={[s.th, s.cSys, { textAlign: "center" }]}>Sys</Text> : null}
    <Text style={[s.th, s.cWrite, { textAlign: "center" }]}>Boxes</Text>
    <Text style={[s.th, s.cWrite, { textAlign: "center" }]}>Loose</Text>
    <Text style={[s.th, s.cTotal, { textAlign: "center" }]}>Total</Text>
    <Text style={[s.th, s.cTick, { textAlign: "center" }]}>OK</Text>
  </View>
);

const Fila = ({ p, conSistema }: { p: ProductoConteo; conSistema: boolean }) => (
  <View style={s.row} wrap={false}>
    <View style={s.cLoc}>
      {p.ubicacion ? <Text style={s.loc}>{p.ubicacion}</Text> : <View style={s.cellSmall} />}
    </View>
    <Text style={[s.sku, s.cSku]}>{p.sku || "—"}</Text>
    <Text style={[s.nom, s.cNom]}>{p.nom}</Text>
    <View style={s.cBox}>
      {/* Impresa si se conoce; casilla para anotarla si no (es lo normal hoy). */}
      {p.cajas && p.cajas > 0 ? <Text style={s.num}>{p.cajas}</Text> : <View style={s.cellSmall} />}
    </View>
    {conSistema ? <Text style={[s.sys, s.cSys]}>{p.stock}</Text> : null}
    <View style={s.cWrite}>
      <View style={s.cell} />
    </View>
    <View style={s.cWrite}>
      <View style={s.cell} />
    </View>
    <View style={s.cTotal}>
      <View style={s.cellTotal} />
    </View>
    <View style={s.cTick}>
      <View style={s.tick} />
    </View>
  </View>
);

export async function renderConteoPdf(d: DatosConteo): Promise<Buffer> {
  const doc = (
    <Document title="Physical Count">
      <Page size="LETTER" style={s.page}>
        <Header d={d} />
        {d.grupos.map((g, gi) => (
          <View key={`${g.titulo}-${gi}`}>
            {g.titulo ? (
              <View style={s.sectionHeader} wrap={false}>
                <Text style={s.sectionHeaderText}>{g.titulo}</Text>
                <Text style={s.sectionCount}>
                  {g.productos.length} item{g.productos.length === 1 ? "" : "s"}
                </Text>
              </View>
            ) : null}
            <ColumnHeader conSistema={d.conSistema} />
            {g.productos.map((p, i) => (
              <Fila key={i} p={p} conSistema={d.conSistema} />
            ))}
          </View>
        ))}
        <Footer d={d} />
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
