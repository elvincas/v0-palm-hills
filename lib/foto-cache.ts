// ── Cache de fotos en IndexedDB (persiste entre sesiones en el dispositivo) ──
//
// Las fotos de productos/clientes son base64 dentro de la propia tabla y pesan
// ~160MB en total. Re-descargarlas en cada apertura agoto el Disk IO Budget de
// Supabase el 2026-07-13 y tumbo la base. Cada entrada guarda la foto (o null si
// el registro no tiene) junto con la version `foto_v` del servidor, que un
// trigger incrementa cuando la foto cambia: asi solo se baja lo que cambio.
//
// Este modulo se comparte entre el DataProvider (app/page.tsx) y las paginas
// standalone que tambien listan productos con foto (ej. nueva-orden). Usan la
// MISMA base y los mismos stores a proposito: la foto que bajo el Home ya le
// sirve a New Order sin volver a pedirla.

const IDB_NAME = "ph-fotos-v1";

export type FotoCache = { foto: string | null; v: number };

export const idbOpen = (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("prod")) db.createObjectStore("prod");
      if (!db.objectStoreNames.contains("cli")) db.createObjectStore("cli");
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => resolve(null);
  });
};

// Entradas viejas (string suelto, del formato anterior a foto_v) se tratan como version 1.
export const idbGetAll = (db: IDBDatabase, store: string): Promise<Map<string, FotoCache>> =>
  new Promise((resolve) => {
    const map = new Map<string, FotoCache>();
    let req: IDBRequest<IDBCursorWithValue | null>;
    try {
      req = db.transaction(store, "readonly").objectStore(store).openCursor();
    } catch {
      resolve(map);
      return;
    }
    req.onsuccess = (e) => {
      const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cur) {
        if (cur.value != null) {
          const val: FotoCache = typeof cur.value === "string" ? { foto: cur.value, v: 1 } : cur.value;
          map.set(cur.key as string, val);
        }
        cur.continue();
      } else resolve(map);
    };
    req.onerror = () => resolve(map);
  });

export const idbPut = (db: IDBDatabase, store: string, key: string, val: FotoCache) => {
  try {
    db.transaction(store, "readwrite").objectStore(store).put(val, key);
  } catch {
    /* ignore */
  }
};
