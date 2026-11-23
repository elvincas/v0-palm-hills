// Prueba del lector de notas de pedido (lib/nota-orden.ts) contra el catalogo real.
// Uso: npx tsx scripts/test-nota-orden.ts <productos.json>
//   productos.json = [{id, nom, sku, barcode, fabricante, almacen}, ...]
//   (select id, nom, sku, barcode, fabricante, almacen from productos)
import { readFileSync } from "fs"
import { parsearNota, prepararCatalogo, type ProductoNota } from "../lib/nota-orden"

const ruta = process.argv[2]
if (!ruta) {
  console.error("Uso: npx tsx scripts/test-nota-orden.ts <productos.json>")
  process.exit(1)
}
const productos: ProductoNota[] = JSON.parse(readFileSync(ruta, "utf8"))
const almacenes = [
  { id: "palmhills", nombre: "Palm Hills" },
  { id: "castillo", nombre: "Castillo" },
]
const cat = prepararCatalogo(productos, "palmhills")
const porId = new Map(productos.map((p) => [p.id, p]))

// [linea de la nota, sku esperado, qty esperada]
const casos: [string, string | null, number | null][] = [
  ["PALM HILLS", null, null],
  ["12 hair plus ampolla banana", "HAPL0005", 12],
  ["hapl18 x6", "HAPL0018", 6],
  ["- borasol gel 4oz 3", "BORA0005", 3],
  ["hapl 5 - 10", "HAPL0005", 10],
  ["x3 carotone crema", "CATO0004", 3],
  ["CT plus lotion 500ml 2", "CTPL0004", 2],
  ["karseel colagen mask purple x 4", "KARS0010", 4],
  ["motrin 200mg 5 pcs", "MOTR0001", 5],
  ["algho azul 2 dz", "ALGH0004", 24],
  ["Castillo:", null, null],
  ["bt-56 3", "BT-056", 3],
  ["BT 056 - 2", "BT-056", 2],
  ["2 silicon mix ampollas coco", "RB-102", 2],
  ["nutrisse colorissimos 280 negro zafiro 4", "US-010", 4],
  ["Q27 x10", "Q-027", 10],
  ["head shoulders classic clean 13.53oz 6", "HS-017", 6],
  ["sedal liso perfecto sh 340ml (3)", "SE-076", 3],
  ["eko tincture arnica 2oz", "Q-065", 1],
  ["silicom mix ampolla coco x 2", "RB-102", 2],
  ["Head and shoulders 400ml x2", "HS-017", 2],
  ["Pedido de Maria", "NONE", null],
  ["zzqx wrrt 4", "NONE", 4],
]
const nota = casos.map((c) => c[0]).join("\n")

const t0 = Date.now()
const res = parsearNota(nota, cat, almacenes)
const ms = Date.now() - t0

let ok = 0
let total = 0
const porNum = new Map(res.map((l) => [l.num, l]))
casos.forEach(([linea, sku, qty], i) => {
  const l = porNum.get(i + 1)
  if (!l) return console.log(`  ?? linea ${i + 1} no aparece: ${linea}`)
  if (l.tipo === "header") return console.log(`  [header -> ${l.almacen}]  ${linea}`)
  total++
  const p = l.elegido ? porId.get(l.elegido) : undefined
  const bien = (sku === "NONE" ? !!l.elegido && l.confianza === "baja" : !sku || p?.sku === sku) && (qty == null || l.qty === qty)
  if (bien) ok++
  console.log(
    `${bien ? "OK " : "XX "} ${linea.padEnd(45)} -> ${String(l.qty).padStart(3)} × ${p ? `${p.sku} ${p.nom}` : "(nada)"}  [${l.confianza}]` +
      (bien ? "" : `   esperado ${qty} × ${sku}`),
  )
})
// Ninguna linea de producto puede quedar sin propuesta (pedido explicito).
const vacias = res.filter((l) => l.tipo === "producto" && !l.elegido).length
if (vacias) {
  console.log(`XX ${vacias} lineas quedaron sin producto`)
  ok = -1
}
console.log(`\n${ok}/${total} correctas · ${ms} ms para ${res.length} lineas sobre ${productos.length} productos`)

// ── Familias ("Nutrisse Tintes:" + "10 - 6") y "(3 c/u)" ──
const nota2 = `Nutrisse Tintes:

10 - 6
6660 - 6
51U - 4

Rompe Pecho (3 c/u)
hapl18 x6`
const res2 = parsearNota(nota2, cat, almacenes)
const prods2 = res2.filter((l) => l.tipo === "producto").map((l) => ({ l, p: l.elegido ? porId.get(l.elegido) : undefined }))
const chequeos: [string, boolean][] = [
  ["'Nutrisse Tintes:' es encabezado de familia", res2[0]?.tipo === "grupo"],
  ["10 - 6 -> 6 × Nutrisse Tinte 10 (US-008)", prods2[0]?.p?.sku === "US-008" && prods2[0].l.qty === 6],
  ["6660 - 6 -> 6 × Tinte 6660 (US-012)", prods2[1]?.p?.sku === "US-012" && prods2[1].l.qty === 6],
  ["51U - 4 -> 4 × Ultra Cobertura 51u (US-036), no 51 unidades", prods2[2]?.p?.sku === "US-036" && prods2[2].l.qty === 4],
  [
    "Rompe Pecho (3 c/u) -> los 7 Rompe Pecho × 3, sin el Pechito",
    (() => {
      const cu = prods2.filter((x) => x.l.cadaUno)
      return cu.length === 7 && cu.every((x) => x.l.qty === 3 && /rompe pecho /i.test(x.p?.nom || ""))
    })(),
  ],
  ["la familia termina en la linea con palabras", prods2.filter((x) => x.l.cadaUno).every((x) => !x.l.grupo)],
  ["hapl18 x6 sigue normal", prods2[prods2.length - 1]?.p?.sku === "HAPL0018" && prods2[prods2.length - 1].l.qty === 6],
  ["ids unicos", new Set(res2.map((l) => l.id)).size === res2.length],
]
let ok2 = 0
for (const [nombre, bien] of chequeos) {
  if (bien) ok2++
  console.log(`${bien ? "OK " : "XX "} ${nombre}`)
}
console.log(`${ok2}/${chequeos.length} familias / c/u`)
process.exit(ok === total && ok2 === chequeos.length ? 0 : 1)
