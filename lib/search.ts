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
//    contra cada PALABRA del texto del producto — solo matchea si la palabra
//    del producto EMPIEZA con el token (prefix match), no si lo contiene en
//    cualquier posicion. Esto evita falsos positivos como "gel" -> "angel".
// 3. Fallback a Levenshtein para typos ("silica" -> "silicon").
// 4. El producto entra si TODOS los tokens del query matchean. Se ordena por
//    relevancia: match exacto en nombre > prefix en nombre > match en SKU/tags.

export const normTag = (s: string) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[^a-z0-9ñ ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/z/g, "s")           // rizos / risos
    .replace(/c([ei])/g, "s$1")   // celular / selular
    .replace(/qu/g, "k")
    .replace(/c/g, "k")           // cabello / kabello
    .replace(/v/g, "b")           // vello / bello
    .replace(/h/g, "")            // hair / air (h muda)
    .replace(/y/g, "i")
    .replace(/ll/g, "i")
    .replace(/(.)\1+/g, "$1");    // colapsa letras dobladas

const tokenize = (q: string): string[] => normTag(q).split(" ").filter(Boolean);

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

// Tolerancia Levenshtein segun largo: tokens <= 3 deben ser exactos,
// 4-6 toleran 1 typo, 7+ toleran 2.
const maxDistFor = (len: number) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

// Score de match de un token contra una sola palabra del producto.
// Retorna null si no hay match.
// Score 0 = exacto o prefix (mejor), 1-3 = fuzzy (peor).
function tokenWordScore(token: string, word: string): number | null {
  if (!word) return null;

  // Coincidencia exacta → mejor score
  if (token === word) return 0;

  // Prefix match: la palabra del producto empieza con el token
  // Ej: token "sil" matchea "silicon", "silka", "silicone"
  if (word.startsWith(token)) return 0;

  // Reverse prefix: el token empieza con la palabra (usuario escribió más
  // que la palabra completa). Solo para palabras largas (>=3) para evitar
  // que "a" o "de" matcheen todo.
  if (token.length > word.length && word.length >= 3 && token.startsWith(word)) return 0;

  // Fuzzy Levenshtein — solo para tokens suficientemente largos y
  // con las primeras letras en comun (ancla de 3 chars para mayor precision).
  const maxDist = maxDistFor(Math.min(token.length, word.length));
  if (maxDist === 0) return null;

  const anchorLen = Math.min(3, token.length, word.length);
  if (token.slice(0, anchorLen) !== word.slice(0, anchorLen)) return null;

  const dist = levenshtein(token, word, maxDist);
  if (dist > maxDist) return null;
  return 1 + dist;
}

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
  text: string;
}

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
    const normFull = normTag(getText(item));
    const normWords = normFull.split(" ").filter(Boolean);

    let total = 0;
    let allMatch = true;
    for (const tok of tokens) {
      const s = tokenBestScore(tok, normWords);
      if (s === null) { allMatch = false; break; }
      total += s;
    }
    if (!allMatch) continue;

    // Bonus de relevancia basado en el nombre del producto
    const normName = getName ? normTag(getName(item)) : normWords.slice(0, 5).join(" ");
    const nameWords = normName.split(" ").filter(Boolean);

    if (normName === normQuery || normName.startsWith(normQuery + " ")) {
      // El nombre empieza exactamente con el query → tope de relevancia
      total -= 30;
    } else if (normName.includes(normQuery)) {
      // Query aparece en algun lugar del nombre
      total -= 20;
    } else {
      // Bonus por cada token que hace prefix-match en el nombre
      for (const tok of tokens) {
        if (tokenBestScore(tok, nameWords) !== null) total -= 4;
      }
    }

    scored.push({ item, score: total });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.item);
}
