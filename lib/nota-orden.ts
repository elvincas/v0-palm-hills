// Lector de "nota de pedido": el usuario pega su lista de pedido tal cual la
// tiene en el telefono y esto la convierte en lineas producto + cantidad.
//
// Formato esperado (libre, a proposito):
//
//   PALM HILLS
//   12 hair plus ampolla banana
//   hapl18 x6
//   CASTILLO
//   bt-56 3
//   silicon mix ampollas coco - 2
//
// - Una linea que es solo el nombre de un almacen es un HEADER: lo que sigue
//   se busca primero en ese almacen.
// - La cantidad se detecta al principio, al final o con marcas ("x6", "6 pcs",
//   "qty 6", "2 dz"). Numeros pegados a una unidad ("8 oz", "500ml") o en
//   formato de empaque ("24/1") son parte de la descripcion, no la cantidad.
// - El producto se reconoce por codigo (SKU / barcode, tolerando guiones,
//   espacios y ceros a la izquierda: "bt56" = "BT-056") o por texto parcial
//   y con errores de escritura (mismo motor fonetico que el buscador).
//
// Nada de esto se guarda: produce una propuesta que el usuario revisa linea
// por linea antes de que entre a la orden.

import { normTag, tokenWordScore } from "./search"

export interface ProductoNota {
  id: string
  nom: string
  sku?: string
  barcode?: string
  fabricante?: string
  almacen?: string
}

export interface AlmacenNota {
  id: string
  nombre: string
}

export type Confianza = "codigo" | "alta" | "media" | "baja" | "ninguna"

export interface Candidato {
  id: string
  score: number
}

export interface LineaNota {
  /** Numero de linea en la nota (1-based), para cotejar con el papel. */
  num: number
  texto: string
  tipo: "producto" | "header"
  /** Almacen del header vigente (null = antes de cualquier header). */
  almacen: string | null
  /** Texto que se uso para buscar (la linea sin la cantidad). */
  consulta: string
  qty: number
  qtyDetectada: boolean
  candidatos: Candidato[]
  elegido: string | null
  confianza: Confianza
}

// ── Normalizacion ──────────────────────────────────────────────────────────

const STOP = new Set(
  ["de", "del", "la", "el", "los", "las", "y", "con", "para", "en", "por", "the", "of", "and", "with", "for", "a", "e"].map(
    (w) => normTag(w),
  ),
)
const UNIDADES = new Set(
  ["oz", "ml", "gr", "g", "mg", "lb", "lbs", "l", "lt", "cc", "kg", "fl", "pk", "ct"].map((w) => normTag(w)),
)

interface Tok {
  /** Forma fonetica (normTag): "cabeyo" = "cabello". */
  v: string
  /** Forma simple sin acentos ni letras dobles: "colagen" = "collagen", que la fonetica separa (ll -> i). */
  p: string
  num: boolean
}

const plano = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").replace(/(.)\1+/g, "$1")

// Separa numeros de letras ("500ml" -> "500 ml") y signos de empaque ("24/1"
// -> "24 1") ANTES de normTag, que si no pegaria todo en un solo numero.
const prep = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/(\d)[.,](\d)/g, "$1$2") // 0.75 -> 075: un solo numero (igual en nota y catalogo)
    .replace(/[\/\-+(),.;:&*#'"_]/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")

function tokens(s: string): Tok[] {
  const out: Tok[] = []
  for (const raw of prep(s).split(/\s+/)) {
    if (!raw) continue
    if (/^\d+$/.test(raw)) {
      const n = String(parseInt(raw, 10))
      out.push({ v: n, p: n, num: true })
    } else {
      const v = normTag(raw)
      if (v) out.push({ v, p: plano(raw) || v, num: false })
    }
  }
  return out
}

// "BT-056" / "bt 56" / "Bt056" -> "bt56". "HAPL0018" -> "hapl18".
export const claveCodigo = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(^|[a-z])0+(?=\d)/g, "$1")

const esCodigo = (k: string) => /[a-z]/.test(k) && /\d/.test(k) && k.length >= 3

// ── Catalogo preparado (una vez por pantalla) ────────────────────────────

interface ProdIdx {
  p: ProductoNota
  almacen: string
  palabras: Tok[]
  /** Palabras del NOMBRE sin stopwords/unidades: para medir cuanto del nombre se cubrio. */
  nombreUtil: Tok[]
}

export interface CatalogoNota {
  items: ProdIdx[]
  porCodigo: Map<string, ProdIdx[]>
  porBarcode: Map<string, ProdIdx>
  almacenDefault: string
}

export function prepararCatalogo(productos: ProductoNota[], almacenDefault: string): CatalogoNota {
  const items: ProdIdx[] = []
  const porCodigo = new Map<string, ProdIdx[]>()
  const porBarcode = new Map<string, ProdIdx>()
  for (const p of productos) {
    const nombreToks = tokens(p.nom)
    const marcaToks = p.fabricante ? tokens(p.fabricante) : []
    const it: ProdIdx = {
      p,
      almacen: p.almacen || almacenDefault,
      palabras: [...nombreToks, ...marcaToks],
      nombreUtil: nombreToks.filter((t) => !STOP.has(t.v) && !UNIDADES.has(t.v)),
    }
    items.push(it)
    if (p.sku) {
      const k = claveCodigo(p.sku)
      if (k) {
        const arr = porCodigo.get(k) || []
        arr.push(it)
        porCodigo.set(k, arr)
      }
    }
    const bc = String(p.barcode || "").replace(/\D/g, "")
    if (bc.length >= 6) porBarcode.set(bc, it)
  }
  return { items, porCodigo, porBarcode, almacenDefault }
}

// ── Puntaje texto -> producto ──────────────────────────────────────────────

function matchTok(q: Tok, palabras: Tok[]): number {
  let best = 0
  for (const w of palabras) {
    let s = 0
    if (q.num || w.num) {
      // Los numeros (tamaños, tonos) solo cuentan si son exactamente iguales:
      // "8" no puede matchear "800 ml".
      if (q.num && w.num && q.v === w.v) s = 1
    } else {
      const a = tokenWordScore(q.v, w.v)
      const b = tokenWordScore(q.p, w.p)
      const r = a === null ? b : b === null ? a : Math.min(a, b)
      if (r === 0) s = q.v === w.v || q.v.length >= 3 ? 1 : 0.6
      else if (r === 2) s = 0.7
      else if (r === 3) s = 0.5
    }
    if (s > best) best = s
    if (best === 1) break
  }
  return best
}

const pesoTok = (t: Tok) => (t.num ? 1.2 : UNIDADES.has(t.v) ? 0.3 : t.v.length < 3 ? 0.5 : 1)

function puntaje(q: Tok[], it: ProdIdx): number {
  let num = 0
  let den = 0
  for (const t of q) {
    const w = pesoTok(t)
    den += w
    num += w * matchTok(t, it.palabras)
  }
  if (!den) return 0
  const cobertura = num / den
  if (cobertura < 0.3) return 0
  // Precision: que parte del nombre del producto quedo explicada por la
  // linea. Desempata "shampoo" entre 40 shampoos a favor del mas parecido.
  let cubiertas = 0
  for (const w of it.nombreUtil) if (matchTok(w, q) >= 0.7) cubiertas++
  const precision = it.nombreUtil.length ? cubiertas / it.nombreUtil.length : 0
  return cobertura * 0.85 + precision * 0.15
}

export interface OpcionesBusqueda {
  /** Almacen donde buscar primero (header de la nota). */
  almacen?: string | null
  /** Productos que este cliente ya compra: desempatan a su favor. */
  favoritos?: Map<string, number>
  limite?: number
  /**
   * Nunca devolver vacio: si nada pasa el umbral, se devuelve lo mas parecido
   * por letras (pedido explicito: ninguna linea de la nota queda sin producto,
   * todas quedan como propuesta editable).
   */
  siempre?: boolean
}

// Parecido por trigramas (Dice) entre dos textos planos. Ultimo recurso
// cuando ninguna palabra matchea: siempre da un "lo mas parecido".
function trigramas(s: string): Set<string> {
  const t = `  ${s} `
  const out = new Set<string>()
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3))
  return out
}
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let comun = 0
  for (const x of a) if (b.has(x)) comun++
  return (2 * comun) / (a.size + b.size)
}
const textoPlano = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()

/** Busca productos para un texto libre (sin cantidad). Tambien la usa el editor. */
export function buscarEnCatalogo(cat: CatalogoNota, texto: string, op: OpcionesBusqueda = {}): Candidato[] {
  const limite = op.limite ?? 6
  const crudos = texto.split(/\s+/).filter(Boolean)

  // 1) Codigo: SKU (token suelto o letras+numero separados: "bt 56") o barcode.
  const porCodigo: Candidato[] = []
  const vistos = new Set<string>()
  const probar = (k: string) => {
    if (!esCodigo(k)) return
    for (const it of cat.porCodigo.get(k) || []) {
      if (vistos.has(it.p.id)) continue
      vistos.add(it.p.id)
      porCodigo.push({ id: it.p.id, score: 1 })
    }
  }
  for (let i = 0; i < crudos.length; i++) {
    probar(claveCodigo(crudos[i]))
    if (i + 1 < crudos.length && /^[a-z]+[-.]?$/i.test(crudos[i]) && /^\d+$/.test(crudos[i + 1])) {
      probar(claveCodigo(crudos[i] + crudos[i + 1]))
    }
    const bc = crudos[i].replace(/\D/g, "")
    if (bc.length >= 6 && bc.length === crudos[i].length) {
      const it = cat.porBarcode.get(bc)
      if (it && !vistos.has(it.p.id)) {
        vistos.add(it.p.id)
        porCodigo.push({ id: it.p.id, score: 1 })
      }
    }
  }
  if (porCodigo.length) {
    // Si el codigo existe en el almacen del header, ese va primero.
    if (op.almacen) {
      porCodigo.sort((a, b) => {
        const ia = cat.items.find((x) => x.p.id === a.id)!
        const ib = cat.items.find((x) => x.p.id === b.id)!
        return Number(ib.almacen === op.almacen) - Number(ia.almacen === op.almacen)
      })
    }
    return porCodigo.slice(0, limite)
  }

  // 2) Texto
  const q = tokens(texto).filter((t) => !STOP.has(t.v))
  const respaldo = (): Candidato[] => {
    if (!op.siempre || !cat.items.length) return []
    // Por debajo de 0.4 a proposito: un respaldo nunca le gana a un match real.
    const qt = trigramas(textoPlano(texto))
    const pool = op.almacen ? cat.items.filter((it) => it.almacen === op.almacen) : cat.items
    return (pool.length ? pool : cat.items)
      .map((it) => ({ id: it.p.id, score: 0.39 * dice(qt, trigramas(textoPlano(`${it.p.nom} ${it.p.sku || ""}`))) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limite)
  }
  if (!q.length) return respaldo()
  const calificar = (soloAlmacen: string | null) => {
    const res: Candidato[] = []
    for (const it of cat.items) {
      if (soloAlmacen && it.almacen !== soloAlmacen) continue
      let s = puntaje(q, it)
      if (s <= 0) continue
      const veces = op.favoritos?.get(it.p.id)
      if (veces) s += 0.03 * Math.min(veces, 5) / 5
      res.push({ id: it.p.id, score: Math.min(1, s) })
    }
    return res.sort((a, b) => b.score - a.score)
  }

  let res = op.almacen ? calificar(op.almacen) : calificar(null)
  // Nada convincente en el almacen del header: se busca en todos (puede ser
  // un producto anotado bajo el header equivocado).
  if (op.almacen && (!res.length || res[0].score < 0.6)) {
    const todos = calificar(null)
    if (todos.length && (!res.length || todos[0].score > res[0].score + 0.1)) res = todos
  }
  const buenos = res.filter((c) => c.score >= 0.4).slice(0, limite)
  if (buenos.length || !op.siempre) return buenos
  // Nada paso el umbral: lo mejor que haya por palabras, y si no, por letras.
  return res.length ? res.slice(0, limite).map((c) => ({ ...c, score: Math.min(c.score, 0.39) })) : respaldo()
}

export function confianzaDe(c: Candidato[], porCodigo: boolean): Confianza {
  if (!c.length) return "ninguna"
  if (porCodigo) return "codigo"
  const [a, b] = c
  if (a.score >= 0.88 && (!b || b.score < a.score - 0.06)) return "alta"
  if (a.score >= 0.72) return "media"
  // Incluye el respaldo "lo mas parecido" (< 0.4): propuesta a revisar, no vacio.
  return "baja"
}

// ── Cantidad ──────────────────────────────────────────────────────────────

const RE_UNIDAD_TRAS = /^\s*(oz|ml|gr|g|mg|lb|lbs|l|lt|cc|kg|fl|%|\/|in|cm|mm|pk|ct)\b/i

interface Interpretacion {
  qty: number
  detectada: boolean
  resto: string
}

function interpretaciones(linea: string): Interpretacion[] {
  const out: Interpretacion[] = []
  const limpiar = (s: string) => s.replace(/\s+/g, " ").trim()

  // Marcas explicitas: la cantidad no admite duda.
  const explicitas: [RegExp, number][] = [
    [/(?:^|\s)(?:x|qty|cant(?:idad)?|cnt)\s*[:=]?\s*(\d{1,4})(?=\s|$|[.,;])/i, 1],
    [/(?:^|\s)(\d{1,4})\s*(?:dz|dzn|doc|docena|docenas)(?=\s|$|[.,;])/i, 12],
    [/(?:^|\s)(\d{1,4})\s*(?:x|pcs?|pzs?|pz|piezas?|unid(?:ades)?|unds?|uds?|u|units?|ea|cajas?|cjs?|cj|bx|box(?:es)?)(?=\s|$|[.,;])/i, 1],
    [/[:=]\s*(\d{1,4})\s*$/, 1],
    [/\(\s*(\d{1,4})\s*\)\s*$/, 1],
    [/\s[-–—]\s*(\d{1,4})\s*$/, 1],
  ]
  for (const [re, mult] of explicitas) {
    const m = linea.match(re)
    if (m && m.index !== undefined) {
      const resto = linea.slice(0, m.index) + " " + linea.slice(m.index + m[0].length)
      out.push({ qty: parseInt(m[1], 10) * mult, detectada: true, resto: limpiar(resto) })
      return out
    }
  }

  // Implicitas: numero suelto al principio o al final. Se prueban ambas (y
  // "sin cantidad") y gana la que mejor explica el producto: asi el "280" de
  // "Nutrisse 280" queda como tono y no como cantidad.
  const ini = linea.match(/^(\d{1,4})\s+(.*)$/)
  if (ini && !RE_UNIDAD_TRAS.test(ini[2])) {
    out.push({ qty: parseInt(ini[1], 10), detectada: true, resto: limpiar(ini[2]) })
  }
  const fin = linea.match(/^(.*\S)\s+(\d{1,4})$/)
  if (fin && !/[\/.,]$/.test(fin[1])) {
    out.push({ qty: parseInt(fin[2], 10), detectada: true, resto: limpiar(fin[1]) })
  }
  out.push({ qty: 1, detectada: false, resto: limpiar(linea) })
  return out
}

// ── Headers ──────────────────────────────────────────────────────────────

function headerDe(linea: string, almacenes: AlmacenNota[]): string | null {
  if (/\d/.test(linea)) return null
  const n = normTag(linea)
  if (!n) return null
  const palabras = n.split(" ").length
  for (const a of almacenes) {
    for (const nombre of [a.nombre, a.id]) {
      const k = normTag(nombre)
      if (!k) continue
      const sinEspacio = n.replace(/ /g, "")
      if (n === k || sinEspacio === k.replace(/ /g, "")) return a.id
      if ((` ${n} `).includes(` ${k} `) && palabras <= k.split(" ").length + 2) return a.id
    }
  }
  return null
}

// ── Parser principal ─────────────────────────────────────────────────────

export function parsearNota(
  texto: string,
  cat: CatalogoNota,
  almacenes: AlmacenNota[],
  favoritos?: Map<string, number>,
): LineaNota[] {
  const out: LineaNota[] = []
  let actual: string | null = null
  const lineas = String(texto || "").split(/\r?\n/)

  lineas.forEach((original, i) => {
    // Viñetas y enumeracion de listas ("- ", "• ", "3) ", "3. ")
    let linea = original.replace(/^[\s\-*•·>◦▪–—]+/, "").replace(/\s+$/, "")
    if (!/[a-z0-9]/i.test(linea)) return

    const h = headerDe(linea, almacenes)
    if (h) {
      actual = h
      out.push({
        num: i + 1, texto: original.trim(), tipo: "header", almacen: h, consulta: "",
        qty: 0, qtyDetectada: false, candidatos: [], elegido: null, confianza: "ninguna",
      })
      return
    }

    // "3) shampoo x 6": la enumeracion solo se quita si hay otra cantidad.
    const enumerada = linea.match(/^\d{1,3}[.)]\s+(.*)$/)
    if (enumerada) {
      const sin = interpretaciones(enumerada[1])
      if (sin[0].detectada) linea = enumerada[1]
      else linea = linea.replace(/^(\d{1,3})[.)]/, "$1")
    }

    let mejor: { int: Interpretacion; cand: Candidato[]; valor: number; codigo: boolean } | null = null
    for (const int of interpretaciones(linea)) {
      const cand = buscarEnCatalogo(cat, int.resto, { almacen: actual, favoritos, siempre: true })
      const codigo = cand.length > 0 && cand[0].score === 1 && esCodigoEn(int.resto, cat)
      let valor = cand[0]?.score ?? 0
      if (int.qty > 200) valor -= 0.1 // un pedido de 280 unidades es mas probable un tono/tamaño
      if (int.detectada) valor += 0.01 // casi toda linea trae cantidad
      if (!mejor || valor > mejor.valor) mejor = { int, cand, valor, codigo }
    }
    let m = mejor!
    // Si el producto es solo una suposicion (nada coincidio bien), el numero
    // de la nota casi seguro es la cantidad: no se lo regala a un "4 oz".
    if ((m.cand[0]?.score ?? 0) < 0.4 && !m.int.detectada) {
      const conQty = interpretaciones(linea).find((x) => x.detectada)
      if (conQty) {
        const cand = buscarEnCatalogo(cat, conQty.resto, { almacen: actual, favoritos, siempre: true })
        m = { int: conQty, cand, valor: cand[0]?.score ?? 0, codigo: false }
      }
    }
    out.push({
      num: i + 1,
      texto: original.trim(),
      tipo: "producto",
      almacen: actual,
      consulta: m.int.resto,
      qty: Math.max(1, m.int.qty),
      qtyDetectada: m.int.detectada,
      candidatos: m.cand,
      elegido: m.cand[0]?.id ?? null,
      confianza: confianzaDe(m.cand, m.codigo),
    })
  })
  return out
}

function esCodigoEn(texto: string, cat: CatalogoNota): boolean {
  const crudos = texto.split(/\s+/).filter(Boolean)
  for (let i = 0; i < crudos.length; i++) {
    const k = claveCodigo(crudos[i])
    if (esCodigo(k) && cat.porCodigo.has(k)) return true
    if (i + 1 < crudos.length && esCodigo(claveCodigo(crudos[i] + crudos[i + 1])) && cat.porCodigo.has(claveCodigo(crudos[i] + crudos[i + 1]))) return true
    const bc = crudos[i].replace(/\D/g, "")
    if (bc.length >= 6 && bc.length === crudos[i].length && cat.porBarcode.has(bc)) return true
  }
  return false
}
