// Motor de busqueda flexible compartido por Inventario, New Order, New Invoice
// y la pagina de Nueva Orden del cliente.
//
// Objetivo: el usuario no tiene que escribir el nombre exacto ni en el mismo
// orden. "bambu silicon 8" o "silica liv" deben encontrar
// "Silicon Mix Bambu Leave In Cond 8 oz".
//
// Estrategia:
// 1. Normalizar (sin acentos, minusculas, variantes foneticas ES comunes).
// 2. Partir el query en palabras (tokens). Cada token se busca por separado
//    contra cada palabra del texto del producto (nombre + sku + barcode + tags),
//    sin importar el orden.
// 3. Un token matchea si es substring exacto, o si esta a poca distancia de
//    edicion (Levenshtein) de alguna palabra del producto — eso es lo que
//    permite que "silica"/"silico" matcheen "silicon".
// 4. El producto entra al resultado si TODOS los tokens del query matchean
//    en algun lado (orden ignorado). Se ordena por que tan buenos fueron los matches.

// Normaliza texto para tolerar typos/acentos/variantes foneticas en espanol
// (ej. "risos" -> "rizos", "kabello" -> "cabello").
export const normTag = (s: string) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[^a-z0-9ñ ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/z/g, "s") // rizos / risos
    .replace(/c([ei])/g, "s$1") // celular / selular
    .replace(/qu/g, "k")
    .replace(/c/g, "k") // cabello / kabello
    .replace(/v/g, "b") // vello / bello
    .replace(/h/g, "") // hair / air (h muda)
    .replace(/y/g, "i")
    .replace(/ll/g, "i")
    .replace(/(.)\1+/g, "$1"); // colapsa letras dobladas

const tokenize = (q: string): string[] => normTag(q).split(" ").filter(Boolean);

// Distancia de edicion (Levenshtein), con corte temprano para mantenerlo rapido
// en listas de cientos/miles de productos.
function levenshtein(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = cur;
  }
  return prev[n];
}

// Que tan tolerante es la distancia permitida segun el largo del token:
// tokens cortos (3-4 letras) casi no toleran error para evitar falsos positivos,
// tokens largos toleran 1-2 letras distintas (typos / variantes foneticas).
const maxDistFor = (len: number) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

// Score de match de un token contra una palabra del producto.
// 0 = substring exacto/prefijo, mayor = mas distante (peor).
function tokenWordScore(token: string, word: string): number | null {
  if (!word) return null;
  // token.includes(word) solo cuenta si `word` tiene un largo minimo: si no,
  // cualquier palabra suelta de una letra (tallas, unidades, sku sueltos como
  // "g"/"w"/"8") matchea por pura casualidad contra cualquier token.
  if (word.includes(token) || (word.length >= 2 && token.includes(word))) return 0;

  const maxDist = maxDistFor(Math.min(token.length, word.length));
  if (maxDist === 0) return null;

  // Anclar por las primeras letras antes de medir distancia de edicion.
  // Sin esto, un token de 5-6 letras esta a distancia 1 de demasiadas
  // palabras al azar del catalogo (cientos de productos, miles de palabras
  // entre nombre/sku/tags) y el buscador termina devolviendo casi todo.
  // Exigir que arranquen igual reduce drasticamente esos falsos positivos
  // sin perder tolerancia real a typos ("silica" -> "silicon").
  const anchorLen = Math.min(2, token.length, word.length);
  if (token.slice(0, anchorLen) !== word.slice(0, anchorLen)) return null;

  const dist = levenshtein(token, word, maxDist);
  if (dist > maxDist) return null;
  return 1 + dist;
}

// Mejor score de un token contra todo el texto normalizado de un producto
// (probando contra cada palabra individual, no la frase completa).
function tokenBestScore(token: string, normWords: string[]): number | null {
  let best: number | null = null;
  for (const w of normWords) {
    const s = tokenWordScore(token, w);
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

export interface SearchableFields {
  id: string;
  text: string; // texto plano sin normalizar (nombre + sku + barcode + tags...)
}

// Filtra y ordena `items` por relevancia contra `query`. `getText` debe
// devolver el texto combinado (nombre, sku, barcode, tags, etc.) de cada item.
// `getName` opcional devuelve solo el nombre del producto para dar mas peso a
// matches exactos en el nombre vs SKU/tags.
// Si el query esta vacio, devuelve `items` sin tocar.
export function flexibleSearch<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  getName?: (item: T) => string
): T[] {
  const tokens = tokenize(query);
  if (!tokens.length) return items;

  const normQuery = normTag(query);

  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const fullText = getText(item);
    const normFull = normTag(fullText);
    const normWords = normFull.split(" ").filter(Boolean);

    let total = 0;
    let allMatch = true;
    for (const tok of tokens) {
      const s = tokenBestScore(tok, normWords);
      if (s === null) {
        allMatch = false;
        break;
      }
      total += s;
    }
    if (!allMatch) continue;

    // Bonus por match exacto de frase completa en el nombre
    const normName = getName ? normTag(getName(item)) : normWords.slice(0, 4).join(" ");
    if (normName.includes(normQuery)) {
      total -= 20; // fuerte bonus: sube al tope
    } else {
      // Bonus por cada token que aparece en el nombre (no solo en SKU/tags)
      const nameWords = normName.split(" ").filter(Boolean);
      for (const tok of tokens) {
        if (tokenBestScore(tok, nameWords) !== null) total -= 3;
      }
    }

    scored.push({ item, score: total });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.item);
}
