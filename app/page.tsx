"use client";

import { useState, useEffect, useMemo, createContext, useContext, useRef, type ReactNode, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { flexibleSearch, normTag } from "@/lib/search";
import "react-easy-crop/react-easy-crop.css";
import JSZip from "jszip";
import type { CropperProps } from "react-easy-crop";
import { BottomNav, NAV_TABS, ALL_TAB_IDS, NAV_ICONS } from "@/components/bottom-nav";
import { proximaFechaEntrega } from "@/lib/delivery";
import { MoneyInput } from "@/components/ui/money-input";
import { Switch } from "@/components/ui/switch";

const Cropper = dynamic(() => import("react-easy-crop"), { ssr: false }) as ComponentType<
  Partial<CropperProps>
>;

// ------------------------------
// Types
// ------------------------------
interface TelefonoContacto {
  rol: string;
  nombre?: string;
  establecimiento?: string;
  num: string;
}

// Formatea un numero mientras se escribe: (xxx) xxx-xxxx (formato US).
// Ignora cualquier caracter que no sea digito y trunca a 10 digitos.
const formatPhone = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

interface NotaVisita {
  id: string;
  fecha: string;
  texto: string;
  ts: string;
}

interface Todo {
  id: string;
  cliente_id?: string;
  cliente_nom?: string;
  texto: string;
  completado: boolean;
  completado_at?: string;
  created_at: string;
}

interface Cliente {
  id: string;
  nom: string;
  codigo_cliente?: string;
  tel?: string;
  email?: string;
  dir?: string;
  ciudad?: string;
  estado_dir?: string;
  contacto?: string;
  estado: string;
  abierto_sabados?: boolean;
  foto_local?: string;
  foto_local_v?: number;
  telefonos?: TelefonoContacto[];
  fax?: string;
  notas_visita?: NotaVisita[];
  lista_precio_id?: string | null;
  vendedor_id?: string | null;
}

// Vendedor: comision configurable por venta facturada y/o por cobro real
// (pedido explicito del usuario, ambos porcentajes son independientes). El
// prefijo de 2 digitos es el mismo que ya usaba codigo_cliente (antes fijo
// en "01" para todos) — ahora cada vendedor tiene el suyo y los clientes
// nuevos se numeran por separado dentro del prefijo de su vendedor.
interface Vendedor {
  id: string;
  nombre: string;
  prefijo: string;
  comision_venta_pct: number;
  comision_cobro_pct: number;
  base_comision: "venta" | "cobros" | "ambas";
  activo: boolean;
}

// Lista de precios por cliente: precios especiales por producto (prodId -> precio).
// Un cliente tiene a lo sumo UNA lista; los productos fuera de la lista usan el
// precio base del inventario.
interface ListaPrecio {
  id: string;
  nombre: string;
  precios: Record<string, number>;
}

// Categoria (ej. "Tipo de Negocio") + sus valores posibles (ej. "Farmacias",
// "Supermercados"...). Un producto guarda a cuales valores pertenece por
// categoria en `Producto.categorias`.
interface Categoria {
  id: string;
  nombre: string;
  valores: string[];
  created_at?: string;
}

interface Producto {
  id: string;
  nom: string;
  sku?: string;
  barcode?: string;
  fabricante?: string;
  etiquetas: string[];
  precio: number;
  costo: number;
  cajas: number;
  stock: number;
  min: number;
  reservado?: number;
  icon?: string;
  foto?: string | null;
  foto_v?: number;
  almacen?: "palmhills" | "castillo";
  categorias?: Record<string, string[]>;
}

interface LineaFactura {
  prodNom: string;
  sku?: string;
  barcode?: string;
  qty: number;
  precio: number;
  precioOriginal?: number;
  // Precio de catalogo puro (sin lista de precios ni ajuste manual), guardado
  // solo para poder mostrar el descuento de lista como opcional en la factura.
  precioCatalogo?: number;
  almacen?: "palmhills" | "castillo";
}

interface Factura {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  estado: string;
  total: number;
  lineas?: LineaFactura[];
  pagos?: { monto: number; fecha: string; nota?: string }[];
  // Orden que genero esta factura (via completePick). Permite "revertir" la
  // factura reabriendo esa orden para ajustarla y volver a facturar.
  orden_id?: string | null;
}

interface LineaNC {
  prodNom: string;
  sku?: string;
  qty: number;
  precio: number;
}

interface NotaCredito {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  monto: number;
  motivo: string;
  tipo?: "amount" | "product";
  lineas?: LineaNC[];
  // Una NC aplicada ya se uso (contra una factura) y deja de restar del balance
  aplicada?: boolean;
  aplicada_en?: string; // descripcion libre: a que factura se aplico
  aplicada_fecha?: string;
}

interface Remito {
  id: string;
  num: number;
  orden_id: string;
  orden_num: number;
  cli: string;
  fecha: string;
  lineas?: LineaOrden[];
  enviado: boolean;
  fecha_envio?: string;
  total?: number;
}

interface LineaOrden {
  prodId: string;
  prodNom: string;
  barcode: string;
  sku: string;
  precio: number;
  precioFinal?: number;
  precioCatalogo?: number;
  qty: number;
  qtyEnviada?: number;
  picked?: boolean;
  almacen?: "palmhills" | "castillo";
}

interface Orden {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  estado: string;
  total: number;
  lineas?: LineaOrden[];
}

interface Mejora {
  id: string;
  titulo: string;
  descripcion: string;
  costo: number;
  prioridad: string;
  estado: string;
  created_at?: string;
}

interface LogEntry {
  msg: string;
  ts: string;
}

// Categorias fijas de gastos operativos para un negocio B2B tipo almacen.
// "Other" siempre disponible para lo que no encaje.
const CATEGORIAS_GASTO = [
  "Payroll",
  "Rent",
  "Phone",
  "Electricity",
  "Water",
  "Gas",
  "Internet",
  "Parking Meter",
  "Supplies",
  "Insurance",
  "Vehicle Maintenance",
  "Facility Maintenance",
  "Software & Subscriptions",
  "Professional Fees",
  "Advertising & Marketing",
  "Licenses & Permits",
  "Bank & Card Fees",
  "Other",
] as const;

interface Gasto {
  id: string;
  categoria: string;
  descripcion?: string;
  monto: number;
  fecha: string;
  pagado: boolean;
  fecha_pago?: string | null;
  comprobante?: string | null;
  created_at?: string;
}

interface LineaCompra {
  prodId: string;
  prodNom: string;
  sku?: string;
  qty: number;
  costoUnitario: number;
  almacen?: "palmhills" | "castillo";
}

interface Compra {
  id: string;
  num: number;
  proveedor: string;
  num_factura_proveedor?: string;
  fecha: string;
  total: number;
  lineas: LineaCompra[];
  nota?: string;
  // Comprobante de la factura del proveedor (foto, PDF o Excel) como data URI
  // base64, con el nombre original para mostrarlo y para el tipo (data:<mime>;base64,...).
  comprobante?: string | null;
  comprobante_nombre?: string | null;
  created_at?: string;
}

type TipoEvento = "delivery" | "visit" | "collect_money" | "order_request";

interface EventoCalendario {
  id: string;
  fecha: string;
  tipos: TipoEvento[];
  cliente_id: string | null;
  nota?: string;
  created_at?: string;
}

// ------------------------------
// Formatting utilities
// ------------------------------
const fmt = (n: number) =>
  "$" +
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

// Estilos de botones tipo "vidrio" (glassmorphism), reutilizables en toda la app
const GLASS_BTN =
  "backdrop-blur-md bg-white/50 border border-white/60 shadow-sm hover:bg-white/70 active:scale-[0.97] transition-all text-card-foreground";
const GLASS_BTN_PRIMARY =
  "backdrop-blur-md bg-primary/85 border border-white/30 shadow-md hover:bg-primary/95 active:scale-[0.97] transition-all text-primary-foreground";
const GLASS_BTN_DESTRUCTIVE =
  "backdrop-blur-md bg-red-50/80 border border-red-200/60 shadow-sm hover:bg-red-100/80 active:scale-[0.97] transition-all text-destructive";

// ------------------------------
// Badge component
// ------------------------------
const BM: Record<string, string> = {
  Paid: "bg-green-50 text-green-800",
  Pending: "bg-amber-50 text-amber-800",
  "In Review": "bg-sky-50 text-sky-800",
  "In Progress": "bg-sky-50 text-sky-800",
  Delivered: "bg-green-50 text-green-800",
  Cancelled: "bg-red-50 text-red-700",
  Current: "bg-green-50 text-green-800",
  Issue: "bg-amber-50 text-amber-800",
  Active: "bg-green-50 text-green-800",
  Inactive: "bg-red-50 text-red-700",
  Waiting: "bg-amber-50 text-amber-800",
  "Out of stock": "bg-red-50 text-red-700",
  "Low stock": "bg-amber-50 text-amber-800",
  "In Stock": "bg-green-50 text-green-800",
  High: "bg-red-50 text-red-700",
  Medium: "bg-amber-50 text-amber-800",
  Low: "bg-sky-50 text-sky-800",
  Completed: "bg-green-50 text-green-800",
};

const Badge = ({ e }: { e: string }) => (
  <span
    className={`pl-2 pr-2.5 py-0.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 ${BM[e] || "bg-sky-50 text-sky-800"}`}
  >
    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" aria-hidden="true" />
    {e}
  </span>
);

// ------------------------------
// UI Components
// ------------------------------
const Field = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <div className="mb-3">
    <label className="text-sm font-semibold text-muted-foreground block mb-1.5">
      {label}
    </label>
    {children}
  </div>
);

const Row2 = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-2.5">{children}</div>
);

const Empty = ({ text }: { text: string }) => (
  <div className="text-center py-7 text-muted-foreground text-sm">{text}</div>
);

const LIST_PAGE_SIZE = 40;

// Pagina listas largas (clientes, facturas, ordenes, productos, etc.) para no
// renderizar de una sola vez listas de miles de filas.
//
// El reinicio a la primera pagina se controla con `resetDeps` (busqueda,
// filtros, almacen, orden) en vez de la propia `list`: las fotos de
// productos/clientes se cargan en segundo plano en lotes y eso cambia la
// referencia de `productos`/`clientes` (y por lo tanto de `list`) muchas
// veces mientras cargan, sin que el filtro haya cambiado. Si el reinicio
// dependiera de `list`, un "Cargar mas" se deshacia solo cada vez que
// llegaba un lote de fotos.
function usePagedList<T>(list: T[], resetDeps: unknown[] = [], pageSize: number = LIST_PAGE_SIZE) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setVisibleCount(pageSize);
  }, resetDeps);
  return {
    visible: list.slice(0, visibleCount),
    hasMore: visibleCount < list.length,
    remaining: Math.max(0, list.length - visibleCount),
    loadMore: () => setVisibleCount((c) => c + pageSize),
  };
}

const LoadMoreButton = ({
  hasMore,
  remaining,
  onClick,
}: {
  hasMore: boolean;
  remaining: number;
  onClick: () => void;
}) => {
  if (!hasMore) return null;
  return (
    <button
      onClick={onClick}
      className="w-full mt-3 py-2.5 rounded-xl border border-border text-sm font-bold text-secondary-foreground"
    >
      Load more ({remaining} remaining)
    </button>
  );
};

// Boton "+" en pildora: relleno verde solido con un degradado sutil (sin
// brillo/highlight — el usuario lo pidio quitar), mismo verde/borde/sombra
// que los botones planos de documentos (ej. Print/PDF) pero ovalado.
// Flota fijo en la esquina inferior (ubicacion que el usuario prefiere),
// un poco mas arriba que el circulo original.
const ADD_PILL_POS = "fixed bottom-24 right-4 z-[6]";
const AddPillButton = ({
  onClick,
  active,
  "aria-label": ariaLabel,
  className = "",
}: {
  onClick: () => void;
  active?: boolean;
  "aria-label"?: string;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className={`shrink-0 w-12 h-9 rounded-full bg-gradient-to-b from-[#5c7d52] via-[#4a6741] to-[#3c5536] border border-[#3c5536] shadow-[0_3px_8px_rgba(28,31,25,0.16),0_1px_2px_rgba(28,31,25,0.08)] active:scale-[0.97] transition-all flex items-center justify-center text-white ${className}`}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      aria-hidden="true"
      className={`transition-transform ${active ? "rotate-45" : ""}`}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  </button>
);

const Li = ({ left, right }: { left: ReactNode; right: ReactNode }) => (
  <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0 gap-2.5">
    <div className="flex-1 min-w-0">{left}</div>
    <div className="text-right shrink-0">{right}</div>
  </div>
);

const Modal = ({
  title,
  onClose,
  children,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <div
    className="fixed inset-0 bg-black/50 z-20 flex items-end justify-center"
    onClick={(e) => e.target === e.currentTarget && onClose()}
  >
    <div className="bg-card rounded-t-3xl p-5 pb-8 w-full max-w-[480px] max-h-[90svh] overflow-y-auto">
      <div className="w-10 h-1 bg-border rounded-full mx-auto mb-4" />
      {title && (
        <div className="flex items-center justify-between mb-4">
          <span className="text-lg font-bold text-card-foreground">{title}</span>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-xl cursor-pointer text-muted-foreground hover:text-foreground"
          >
            X
          </button>
        </div>
      )}
      {children}
    </div>
  </div>
);



// ------------------------------
// Data Context
// ------------------------------
interface DataContextType {
  role: "admin" | "visitante";
  readOnly: boolean;
  clientes: Cliente[];
  productos: Producto[];
  facturas: Factura[];
  ordenes: Orden[];
  remitos: Remito[];
  mejoras: Mejora[];
  eventosCalendario: EventoCalendario[];
  proximasFechasEntrega: string[];
  logs: LogEntry[];
  loading: boolean;
  addCliente: (c: Omit<Cliente, "id">) => Promise<void>;
  deleteCliente: (id: string) => Promise<void>;
  updateCliente: (id: string, c: Omit<Cliente, "id">) => Promise<void>;
  addClientesBulk: (rows: Omit<Cliente, "id">[]) => Promise<number>;
  addProducto: (p: Omit<Producto, "id">) => Promise<void>;
  addProductosBulk: (
    rows: Omit<Producto, "id">[],
    skipDuplicates?: boolean,
    updatePrices?: boolean
  ) => Promise<{ insertados: number; duplicados: number; actualizados: number }>;
  updateProducto: (id: string, p: Omit<Producto, "id">) => Promise<void>;
  updateProductoFoto: (id: string, foto: string) => Promise<void>;
  deleteProducto: (id: string) => Promise<void>;
  addFactura: (f: Omit<Factura, "id" | "num">) => Promise<void>;
  deleteFactura: (id: string) => Promise<void>;
  notasCredito: NotaCredito[];
  addNotaCredito: (n: Omit<NotaCredito, "id" | "num">) => Promise<void>;
  deleteNotaCredito: (id: string) => Promise<void>;
  setNotaCreditoAplicada: (id: string, aplicada: boolean, aplicadaEn?: string) => Promise<void>;
  addOrden: (o: Omit<Orden, "id" | "num">) => Promise<void>;
  deleteOrden: (id: string) => Promise<void>;
  updateOrden: (id: string, o: Orden) => Promise<void>;
  addRemito: (r: Omit<Remito, "id" | "num">) => Promise<void>;
  marcarRemitoEnviado: (id: string) => Promise<void>;
  ajustarInventario: (
    cambios: { prodId: string; deltaReservado?: number; deltaStock?: number }[]
  ) => Promise<void>;
  addMejora: (m: Omit<Mejora, "id">) => Promise<void>;
  deleteMejora: (id: string) => Promise<void>;
  updateMejora: (id: string, m: Omit<Mejora, "id">) => Promise<void>;
  addEvento: (e: Omit<EventoCalendario, "id">) => Promise<void>;
  updateEvento: (id: string, e: Omit<EventoCalendario, "id">) => Promise<void>;
  deleteEvento: (id: string) => Promise<void>;
  listasPrecios: ListaPrecio[];
  addListaPrecio: (l: Omit<ListaPrecio, "id">) => Promise<ListaPrecio>;
  updateListaPrecio: (id: string, l: Omit<ListaPrecio, "id">) => Promise<void>;
  deleteListaPrecio: (id: string) => Promise<void>;
  asignarListaAClientes: (listaId: string | null, clienteIds: string[]) => Promise<void>;
  categorias: Categoria[];
  addCategoria: (c: Omit<Categoria, "id">) => Promise<Categoria>;
  updateCategoria: (id: string, c: Omit<Categoria, "id">) => Promise<void>;
  deleteCategoria: (id: string) => Promise<void>;
  setProductoCategoriaValor: (prodId: string, categoriaId: string, valor: string, activo: boolean) => Promise<void>;
  setProductoFabricante: (prodId: string, fabricante: string) => Promise<void>;
  refreshLogs: () => void;
  refreshAll: () => Promise<void>;
  todos: Todo[];
  addTodo: (t: Omit<Todo, "id" | "created_at" | "completado">) => Promise<void>;
  toggleTodo: (id: string) => Promise<void>;
  gastos: Gasto[];
  addGasto: (g: Omit<Gasto, "id">) => Promise<void>;
  updateGasto: (id: string, g: Omit<Gasto, "id">) => Promise<void>;
  deleteGasto: (id: string) => Promise<void>;
  compras: Compra[];
  addCompra: (c: Omit<Compra, "id" | "num">) => Promise<void>;
  deleteCompra: (id: string) => Promise<void>;
  vendedores: Vendedor[];
  addVendedor: (v: Omit<Vendedor, "id">) => Promise<Vendedor>;
  updateVendedor: (id: string, v: Omit<Vendedor, "id">) => Promise<void>;
  deleteVendedor: (id: string) => Promise<void>;
}

const DataContext = createContext<DataContextType | null>(null);

// ── IndexedDB cache para fotos (persiste entre sesiones en el dispositivo) ──
const IDB_NAME = "ph-fotos-v1";
const idbOpen = (): Promise<IDBDatabase | null> => {
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
// Cada entrada guarda la foto (o null si el registro no tiene) junto con la
// version foto_v del servidor: asi solo se re-descarga una foto cuando su
// version cambia. Entradas viejas (string suelto) se tratan como version 1.
type FotoCache = { foto: string | null; v: number };
const idbGetAll = (db: IDBDatabase, store: string): Promise<Map<string, FotoCache>> =>
  new Promise((resolve) => {
    const map = new Map<string, FotoCache>();
    const req = db.transaction(store, "readonly").objectStore(store).openCursor();
    req.onsuccess = (e) => {
      const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cur) {
        if (cur.value != null) {
          const val: FotoCache = typeof cur.value === "string" ? { foto: cur.value, v: 1 } : cur.value;
          map.set(cur.key as string, val);
        }
        cur.continue();
      }
      else resolve(map);
    };
    req.onerror = () => resolve(map);
  });
const idbPut = (db: IDBDatabase, store: string, key: string, val: FotoCache) => {
  try { db.transaction(store, "readwrite").objectStore(store).put(val, key); } catch { /* ignore */ }
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

const DataProvider = ({ children }: { children: ReactNode }) => {
  const supabase = useMemo(() => createClient(), []);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const fotosProdRunRef = useRef(0);
  const fotosCliRunRef = useRef(0);
  const idbRef = useRef<IDBDatabase | null>(null);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [notasCredito, setNotasCredito] = useState<NotaCredito[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [remitos, setRemitos] = useState<Remito[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [mejoras, setMejoras] = useState<Mejora[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [eventosCalendario, setEventosCalendario] = useState<EventoCalendario[]>([]);
  const [listasPrecios, setListasPrecios] = useState<ListaPrecio[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"admin" | "visitante">("admin");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const r = data.user?.user_metadata?.role;
      setRole(r === "visitante" ? "visitante" : "admin");
    }).catch(() => {});
  }, [supabase]);

  const refreshLogs = async () => {
    const { data } = await supabase
      .from("actividad")
      .select("msg, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setLogs((data || []).map((r) => ({ msg: r.msg, ts: fmtTime(r.created_at) })));
  };

  const logAct = async (msg: string) => {
    await supabase.from("actividad").insert({ msg });
    await refreshLogs();
  };

  // Columnas livianas: las fotos (base64) se cargan despues, en segundo plano,
  // para que la app no tenga que esperar varios MB de imagenes antes de mostrar nada.
  const CLIENTE_COLS =
    "id, nom, codigo_cliente, tel, email, dir, ciudad, estado_dir, contacto, estado, abierto_sabados, telefonos, fax, notas_visita, lista_precio_id, vendedor_id, foto_local_v, created_at";
  const PRODUCTO_COLS =
    "id, nom, sku, barcode, fabricante, etiquetas, precio, costo, cajas, stock, min, reservado, almacen, foto_v, categorias, created_at";

  // Las fotos pesan varios MB en total: pedirlas todas de una vez supera el
  // timeout de la base de datos. Con fotos de hasta 500KB, 10 por request = ~5MB,
  // bien dentro del limite de Supabase (10MB por response).
  const FOTO_CHUNK = 10;

  // Recibe solo los registros cuya foto falta en el cache o cambio de version
  // (foto_v); las fotos sin cambios se sirven desde IndexedDB sin tocar la red.
  const loadFotosProductos = async (items: { id: string; v: number }[]) => {
    const run = ++fotosProdRunRef.current;
    const idb = idbRef.current;
    for (let i = 0; i < items.length; i += FOTO_CHUNK) {
      if (fotosProdRunRef.current !== run) return; // nueva carga iniciada, abortar
      const lote = items.slice(i, i + FOTO_CHUNK);
      try {
        const { data, error } = await supabase.from("productos").select("id, foto").in("id", lote.map((x) => x.id));
        if (error) { console.error("[v0] Error cargando fotos de productos:", error.message); continue; }
        if (!data || data.length === 0) continue;
        const vPorId = new Map(lote.map((x) => [x.id, x.v]));
        const updates = new Map<string, string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of data as any[]) {
          // Se cachea tambien foto=null: sin esa marca, los productos sin foto
          // se volverian a pedir en cada apertura.
          if (idb) idbPut(idb, "prod", r.id, { foto: r.foto ?? null, v: vPorId.get(r.id) ?? 1 });
          if (r.foto) updates.set(r.id, r.foto);
        }
        if (updates.size > 0) {
          setProductos((prev) => prev.map((p) => (updates.has(p.id) ? { ...p, foto: updates.get(p.id) } : p)));
        }
      } catch (err) {
        console.error("[v0] Error inesperado en lote de fotos de productos:", err);
      }
    }
  };

  const loadFotosClientes = async (items: { id: string; v: number }[]) => {
    const run = ++fotosCliRunRef.current;
    const idb = idbRef.current;
    for (let i = 0; i < items.length; i += FOTO_CHUNK) {
      if (fotosCliRunRef.current !== run) return; // nueva carga iniciada, abortar
      const lote = items.slice(i, i + FOTO_CHUNK);
      try {
        const { data, error } = await supabase.from("clientes").select("id, foto_local").in("id", lote.map((x) => x.id));
        if (error) { console.error("[v0] Error cargando fotos de clientes:", error.message); continue; }
        if (!data || data.length === 0) continue;
        const vPorId = new Map(lote.map((x) => [x.id, x.v]));
        const updates = new Map<string, string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of data as any[]) {
          if (idb) idbPut(idb, "cli", r.id, { foto: r.foto_local ?? null, v: vPorId.get(r.id) ?? 1 });
          if (r.foto_local) updates.set(r.id, r.foto_local);
        }
        if (updates.size > 0) {
          setClientes((prev) => prev.map((c) => (updates.has(c.id) ? { ...c, foto_local: updates.get(c.id) } : c)));
        }
      } catch (err) {
        console.error("[v0] Error inesperado en lote de fotos de clientes:", err);
      }
    }
  };

  // PostgREST limita cada respuesta a 1000 filas por defecto: con mas de 1000
  // registros en una tabla, una sola llamada .select() se trunca en silencio.
  // Se pagina con .range() hasta que una pagina vuelva incompleta.
  const PAGE_SIZE = 1000;
  const selectAll = async <T,>(
    table: string,
    cols: string,
    orderCol: string,
    ascending: boolean
  ): Promise<T[]> => {
    const rows: T[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(cols)
        .order(orderCol, { ascending })
        // Desempate por id: si orderCol tiene valores repetidos (ej. una
        // importacion masiva deja el mismo created_at en miles de productos),
        // el orden entre paginas no es estable y .range() puede duplicar
        // filas en una pagina y saltarse otras.
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data) break;
      rows.push(...(data as T[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return rows;
  };

  const loadAll = async () => {
    try {
      const [c, p, f, nc, o, r, e, ev, lp, ga, co, cat, ven] = await Promise.all([
        selectAll<Cliente>("clientes", CLIENTE_COLS, "created_at", false),
        selectAll<Producto>("productos", PRODUCTO_COLS, "created_at", false),
        selectAll<Factura>("facturas", "*", "num", false),
        selectAll<NotaCredito>("notas_credito", "*", "num", false),
        selectAll<Orden>("ordenes", "*", "num", false),
        selectAll<Remito>("remitos", "*", "num", false),
        selectAll<Mejora>("mejoras", "*", "created_at", false),
        selectAll<EventoCalendario>("eventos_calendario", "*", "fecha", true),
        selectAll<ListaPrecio>("listas_precios", "*", "created_at", true),
        selectAll<Gasto>("gastos", "*", "fecha", false),
        selectAll<Compra>("compras", "*", "num", false),
        selectAll<Categoria>("categorias", "*", "created_at", true),
        selectAll<Vendedor>("vendedores", "*", "created_at", true),
      ]);
      setClientes(c);
      setProductos(p.map((row) => ({ ...row, etiquetas: row.etiquetas || [], categorias: row.categorias || {} })));
      setFacturas(f);
      setNotasCredito(nc);
      setOrdenes(o.map((row) => ({ ...row, lineas: row.lineas || [] })));
      setRemitos(r.map((row) => ({ ...row, lineas: row.lineas || [] })));
      setMejoras(e);
      setEventosCalendario(ev.map((row) => ({ ...row, tipos: row.tipos || [] })));
      setListasPrecios(lp.map((row) => ({ ...row, precios: row.precios || {} })));
      setGastos(ga);
      setCategorias(cat.map((row) => ({ ...row, valores: row.valores || [] })));
      setCompras(co.map((row) => ({ ...row, lineas: row.lineas || [] })));
      setVendedores(ven);
      await refreshLogs();

      // Abrir IndexedDB y aplicar fotos cacheadas al instante (sin esperar red)
      if (!idbRef.current) idbRef.current = await idbOpen();
      const idb = idbRef.current;
      let cachedProd = new Map<string, FotoCache>();
      let cachedCli = new Map<string, FotoCache>();
      if (idb) {
        [cachedProd, cachedCli] = await Promise.all([
          idbGetAll(idb, "prod"),
          idbGetAll(idb, "cli"),
        ]);
        if (cachedProd.size > 0) {
          setProductos((prev) => prev.map((pd) => cachedProd.get(pd.id)?.foto ? { ...pd, foto: cachedProd.get(pd.id)!.foto } : pd));
        }
        if (cachedCli.size > 0) {
          setClientes((prev) => prev.map((cl) => cachedCli.get(cl.id)?.foto ? { ...cl, foto_local: cachedCli.get(cl.id)!.foto! } : cl));
        }
      }

      // Background: bajar SOLO las fotos sin cachear o cuya version (foto_v)
      // cambio en el servidor. Re-descargar los ~160MB de fotos en cada
      // apertura agotaba el Disk IO Budget de Supabase y tumbaba la base.
      // (palm hills primero)
      const prodPendiente = (r: Producto) => {
        const cache = cachedProd.get(r.id);
        return !cache || cache.v !== (r.foto_v ?? 1);
      };
      const phIds = p.filter((r) => (!r.almacen || r.almacen === "palmhills") && prodPendiente(r)).map((r) => ({ id: r.id, v: r.foto_v ?? 1 }));
      const castIds = p.filter((r) => r.almacen === "castillo" && prodPendiente(r)).map((r) => ({ id: r.id, v: r.foto_v ?? 1 }));
      loadFotosProductos([...phIds, ...castIds]).catch(() => {});
      const cliPendientes = c
        .filter((r) => {
          const cache = cachedCli.get(r.id);
          return !cache || cache.v !== (r.foto_local_v ?? 1);
        })
        .map((r) => ({ id: r.id, v: r.foto_local_v ?? 1 }));
      loadFotosClientes(cliPendientes).catch(() => {});
      // Load pending todos
      const { data: td } = await supabase.from("todos").select("*").eq("completado", false).order("created_at", { ascending: false });
      setTodos((td as Todo[]) || []);
    } catch (err) {
      // Si la carga inicial falla (ej. corte de red), no dejamos la app
      // congelada en "Loading..." para siempre.
      console.error("[v0] loadAll failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Numeracion consultada a la base al momento de insertar (no del estado en
  // memoria): reduce el riesgo de numeros duplicados cuando dos dispositivos
  // crean documentos a la vez con datos locales desactualizados.
  const nextNumDb = async (table: string, start: number): Promise<number> => {
    const { data } = await supabase
      .from(table)
      .select("num")
      .order("num", { ascending: false })
      .limit(1);
    const max = data && data.length ? Number(data[0].num) || 0 : 0;
    return Math.max(start - 1, max) + 1;
  };

  // Una orden "activa" retiene reservas de inventario; al completarse o
  // cancelarse las libera.
  const ordenActiva = (estado: string) => estado !== "Completed" && estado !== "Cancelled";

  // Ajusta reservas y/o stock de varios productos. Lee los valores actuales de
  // la base (no del estado local) para no pisar cambios de otras sesiones, y
  // nunca deja valores negativos. Castillo no lleva stock en vivo: se omite.
  const ajustarInventario = async (
    cambios: { prodId: string; deltaReservado?: number; deltaStock?: number }[]
  ) => {
    const efectivos = cambios.filter(
      (c) => c.prodId && ((c.deltaReservado || 0) !== 0 || (c.deltaStock || 0) !== 0)
    );
    if (!efectivos.length) return;
    const { data } = await supabase
      .from("productos")
      .select("id, stock, reservado, almacen")
      .in("id", efectivos.map((c) => c.prodId));
    if (!data) return;
    const porId = new Map(
      (data as { id: string; stock: number; reservado: number | null; almacen: string | null }[]).map((r) => [r.id, r])
    );
    const updates: { id: string; stock: number; reservado: number }[] = [];
    for (const c of efectivos) {
      const row = porId.get(c.prodId);
      if (!row || (row.almacen || "palmhills") === "castillo") continue;
      updates.push({
        id: row.id,
        stock: Math.max(0, Number(row.stock || 0) + (c.deltaStock || 0)),
        reservado: Math.max(0, Number(row.reservado || 0) + (c.deltaReservado || 0)),
      });
    }
    if (!updates.length) return;
    await Promise.all(
      updates.map((u) =>
        supabase.from("productos").update({ stock: u.stock, reservado: u.reservado }).eq("id", u.id)
      )
    );
    const porIdUpd = new Map(updates.map((u) => [u.id, u]));
    setProductos((prev) =>
      prev.map((p) => {
        const u = porIdUpd.get(p.id);
        return u ? { ...p, stock: u.stock, reservado: u.reservado } : p;
      })
    );
  };

  // --- Clientes ---
  const addCliente = async (cliente: Omit<Cliente, "id">) => {
    const { data, error } = await supabase.from("clientes").insert(cliente).select().single();
    if (error) throw new Error(error.message);
    setClientes((prev) => [data as Cliente, ...prev]);
    await logAct(`New client: ${cliente.nom}`);
  };

  const deleteCliente = async (id: string) => {
    const { error } = await supabase.from("clientes").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setClientes((prev) => prev.filter((c) => c.id !== id));
    await logAct(`Client deleted`);
  };

  const updateCliente = async (id: string, updated: Omit<Cliente, "id">) => {
    const anterior = clientes.find((c) => c.id === id);
    // foto_local_v lo administra el trigger de la base; no se escribe desde el cliente.
    const { foto_local_v: _flv, ...payload } = updated;
    const { data, error } = await supabase.from("clientes").update(payload).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setClientes((prev) => prev.map((c) => (c.id === id ? (data as Cliente) : c)));
    const cliRow = data as Cliente;
    if (idbRef.current) idbPut(idbRef.current, "cli", id, { foto: cliRow.foto_local ?? null, v: cliRow.foto_local_v ?? 1 });
    // Facturas, notas de credito, ordenes y remitos quedan ligados por NOMBRE:
    // si el nombre cambia, se renombran en cascada para no dejar huerfanos.
    if (anterior && anterior.nom !== updated.nom) {
      await Promise.all([
        supabase.from("facturas").update({ cli: updated.nom }).eq("cli", anterior.nom),
        supabase.from("notas_credito").update({ cli: updated.nom }).eq("cli", anterior.nom),
        supabase.from("ordenes").update({ cli: updated.nom }).eq("cli", anterior.nom),
        supabase.from("remitos").update({ cli: updated.nom }).eq("cli", anterior.nom),
      ]);
      setFacturas((prev) => prev.map((f) => (f.cli === anterior.nom ? { ...f, cli: updated.nom } : f)));
      setNotasCredito((prev) => prev.map((n) => (n.cli === anterior.nom ? { ...n, cli: updated.nom } : n)));
      setOrdenes((prev) => prev.map((o) => (o.cli === anterior.nom ? { ...o, cli: updated.nom } : o)));
      setRemitos((prev) => prev.map((r) => (r.cli === anterior.nom ? { ...r, cli: updated.nom } : r)));
    }
    await logAct(`Client updated: ${updated.nom}`);
  };

  const addClientesBulk = async (rows: Omit<Cliente, "id">[]): Promise<number> => {
    const { data, error } = await supabase.from("clientes").insert(rows).select();
    if (error) throw new Error(error.message);
    if (data) setClientes((prev) => [...(data as Cliente[]), ...prev]);
    await logAct(`Bulk import: ${rows.length} clients`);
    return data?.length ?? 0;
  };

  // --- Productos ---
  const sanitizeProducto = (prod: Omit<Producto, "id">) => {
    const validated = {
      ...prod,
      precio: Math.max(0, Number(prod.precio) || 0),
      costo: Math.max(0, Number(prod.costo) || 0),
      cajas: Math.max(0, Number(prod.cajas) || 0),
      stock: Math.max(0, Number(prod.stock) || 0),
      min: Math.max(0, Number(prod.min) || 5),
      // Cada etiqueta es una sola palabra (como las keywords de busqueda de
      // Amazon); si llega una frase de varias palabras se separa en palabras sueltas.
      etiquetas: Array.isArray(prod.etiquetas)
        ? Array.from(
            new Set(
              prod.etiquetas
                .flatMap((t) => String(t).trim().toLowerCase().split(/\s+/))
                .filter(Boolean)
            )
          )
        : [],
      fabricante: (prod.fabricante || "").trim(),
    };
    delete (validated as { icon?: string }).icon;
    return validated;
  };

  const addProducto = async (prod: Omit<Producto, "id">) => {
    const { data, error } = await supabase.from("productos").insert(sanitizeProducto(prod)).select().single();
    if (error) throw new Error(error.message);
    setProductos((prev) => [data as Producto, ...prev]);
    await logAct(`New product: ${prod.nom}`);
  };

  const addProductosBulk = async (
    rows: Omit<Producto, "id">[],
    skipDuplicates = false,
    updatePrices = false
  ) => {
    const payload = rows.map(sanitizeProducto);

    // El SKU es el identificador dominante dentro de cada almacen: dos productos
    // con el mismo SKU en almacenes distintos son entradas independientes.
    const dupKey = (sku: string, almacen: string) => `${sku}__${almacen || "palmhills"}`;

    const skusToCheck = payload.filter((p) => p.sku).map((p) => p.sku);
    let duplicados: Producto[] = [];

    if (skusToCheck.length > 0) {
      const almacenes = Array.from(new Set(payload.map((p) => p.almacen || "palmhills")));
      const { data: existentes } = await supabase
        .from("productos")
        .select("*")
        .in("sku", skusToCheck)
        .in("almacen", almacenes);
      duplicados = (existentes || []) as Producto[];
    }

    // Si hay duplicados y no se autorizo saltarlos ni actualizar precios, avisa primero.
    if (duplicados.length > 0 && !skipDuplicates && !updatePrices) {
      throw new Error(`${duplicados.length} products already exist (by SKU). Check the duplicate SKUs.`);
    }

    const duplicadosMap = new Map(
      duplicados.map((d) => [dupKey(d.sku || "", d.almacen || "palmhills"), d])
    );
    const nuevos = payload.filter(
      (p) => !duplicadosMap.has(dupKey(p.sku || "", p.almacen || "palmhills"))
    );

    // Actualizar precio: solo toca el precio de los productos existentes, conserva
    // foto, descripcion, stock y todo lo demas.
    let actualizados = 0;
    if (updatePrices) {
      // key -> nuevo precio subido a granel para ese SKU/almacen existente
      const preciosNuevos = new Map<string, number>();
      for (const p of payload) {
        const key = dupKey(p.sku || "", p.almacen || "palmhills");
        if (duplicadosMap.has(key)) preciosNuevos.set(key, p.precio);
      }
      await Promise.all(
        Array.from(preciosNuevos.entries()).map(([key, precio]) =>
          supabase.from("productos").update({ precio }).eq("id", duplicadosMap.get(key)!.id)
        )
      );
      actualizados = preciosNuevos.size;
      if (actualizados > 0) {
        setProductos((prev) =>
          prev.map((prod) => {
            const key = dupKey(prod.sku || "", prod.almacen || "palmhills");
            return preciosNuevos.has(key) ? { ...prod, precio: preciosNuevos.get(key)! } : prod;
          })
        );
      }
    }

    if (nuevos.length === 0) {
      if (updatePrices) {
        await logAct(`Bulk price update: ${actualizados} products updated`);
        return { insertados: 0, duplicados: duplicados.length, actualizados };
      }
      throw new Error("All products already exist in the database.");
    }

    try {
      const { data, error } = await supabase.from("productos").insert(nuevos).select();
      if (error) {
        console.error("[v0] Bulk insert error:", error.message, error.details, error.hint);
        throw new Error(`Error de Supabase: ${error.message}${error.details ? ` - ${error.details}` : ""}`);
      }
      if (data) setProductos((prev) => [...(data as Producto[]), ...prev]);
      await logAct(
        `Bulk upload: ${data?.length || 0} new products${
          updatePrices ? `, ${actualizados} prices updated` : skipDuplicates ? ` (${duplicados.length} duplicates skipped)` : ""
        }`
      );
      return { insertados: data?.length || 0, duplicados: duplicados.length, actualizados };
    } catch (err) {
      console.error("[v0] Bulk operation failed:", err);
      throw err;
    }
  };

  const updateProducto = async (id: string, prod: Omit<Producto, "id">) => {
    // foto_v lo administra el trigger de la base; un valor viejo del cliente
    // no debe pisarlo.
    const { foto_v: _fv, ...sinFotoV } = sanitizeProducto(prod);
    const validated = sinFotoV;
    const { data, error } = await supabase.from("productos").update(validated).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setProductos((prev) => prev.map((p) => (p.id === id ? (data as Producto) : p)));
    const prodRow = data as Producto;
    if (idbRef.current) idbPut(idbRef.current, "prod", id, { foto: prodRow.foto ?? null, v: prodRow.foto_v ?? 1 });
    await logAct(`Product updated: ${prod.nom}`);
  };

  const updateProductoFoto = async (id: string, foto: string) => {
    const { data, error } = await supabase.from("productos").update({ foto }).eq("id", id).select("foto_v").single();
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (data as any)?.foto_v ?? 1;
    setProductos((prev) => prev.map((p) => (p.id === id ? { ...p, foto, foto_v: v } : p)));
    if (idbRef.current) idbPut(idbRef.current, "prod", id, { foto, v });
  };

  const deleteProducto = async (id: string) => {
    const { error } = await supabase.from("productos").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setProductos((prev) => prev.filter((p) => p.id !== id));
    await logAct(`Product deleted`);
  };

  // --- Facturas ---
  const addFactura = async (factura: Omit<Factura, "id" | "num">) => {
    const num = await nextNumDb("facturas", 1001);
    let { data, error } = await supabase.from("facturas").insert({ ...factura, num }).select().single();
    // Si la columna orden_id aun no existe en la base (migracion pendiente),
    // reintentar sin ella para no bloquear la facturacion.
    if (error && /orden_id/i.test(error.message) && "orden_id" in factura) {
      const { orden_id: _skip, ...sinOrden } = factura;
      ({ data, error } = await supabase.from("facturas").insert({ ...sinOrden, num }).select().single());
    }
    if (error) throw new Error(error.message);
    setFacturas((prev) => [data as Factura, ...prev]);
    await logAct(`Invoice #${num} → ${factura.cli}`);
  };

  // --- Remitos (Constancia de Retiro Castillo) ---
  const addRemito = async (remito: Omit<Remito, "id" | "num">) => {
    const num = await nextNumDb("remitos", 5001);
    const { data, error } = await supabase.from("remitos").insert({ ...remito, num }).select().single();
    if (error) throw new Error(error.message);
    setRemitos((prev) => [data as Remito, ...prev]);
    await logAct(`Remito #${num} (Castillo) → ${remito.cli}`);
  };

  const marcarRemitoEnviado = async (remitoId: string) => {
    const { error } = await supabase
      .from("remitos")
      .update({ enviado: true, fecha_envio: new Date().toISOString().split("T")[0] })
      .eq("id", remitoId);
    if (error) throw new Error(error.message);
    setRemitos((prev) =>
      prev.map((r) =>
        r.id === remitoId ? { ...r, enviado: true, fecha_envio: new Date().toISOString().split("T")[0] } : r
      )
    );
    await logAct(`Remito marked as sent`);
  };

  const deleteFactura = async (id: string) => {
    const { error } = await supabase.from("facturas").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setFacturas((prev) => prev.filter((f) => f.id !== id));
    await logAct(`Invoice deleted`);
  };

  // --- Notas de Crédito ---
  const addNotaCredito = async (nota: Omit<NotaCredito, "id" | "num">) => {
    const num = await nextNumDb("notas_credito", 1);
    const { data, error } = await supabase.from("notas_credito").insert({ ...nota, num }).select().single();
    if (error) throw new Error(error.message);
    setNotasCredito((prev) => [data as NotaCredito, ...prev]);
    await logAct(`Credit note #${num} → ${nota.cli} — $${nota.monto}`);
  };

  const deleteNotaCredito = async (id: string) => {
    const { error } = await supabase.from("notas_credito").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setNotasCredito((prev) => prev.filter((n) => n.id !== id));
    await logAct(`Credit note deleted`);
  };

  // Marca/desmarca una NC como aplicada. Una NC aplicada ya se uso contra una
  // factura (descrita en aplicada_en) y deja de restar del balance del cliente.
  const setNotaCreditoAplicada = async (id: string, aplicada: boolean, aplicadaEn?: string) => {
    const cambios = aplicada
      ? { aplicada: true, aplicada_en: aplicadaEn || null, aplicada_fecha: today() }
      : { aplicada: false, aplicada_en: null, aplicada_fecha: null };
    const { error } = await supabase.from("notas_credito").update(cambios).eq("id", id);
    if (error) throw new Error(error.message);
    setNotasCredito((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, aplicada, aplicada_en: aplicada ? aplicadaEn : undefined, aplicada_fecha: aplicada ? today() : undefined }
          : n
      )
    );
    const nc = notasCredito.find((n) => n.id === id);
    await logAct(
      aplicada
        ? `Credit note #${nc?.num ?? "?"} marked as applied${aplicadaEn ? ` (${aplicadaEn})` : ""}`
        : `Credit note #${nc?.num ?? "?"} unmarked as applied`
    );
  };

  // --- Ordenes ---
  const addOrden = async (orden: Omit<Orden, "id" | "num">) => {
    const num = await nextNumDb("ordenes", 1);
    const { data, error } = await supabase.from("ordenes").insert({ ...orden, num }).select().single();
    if (error) throw new Error(error.message);
    setOrdenes((prev) => [{ ...(data as Orden), lineas: (data as Orden).lineas || [] }, ...prev]);
    if (ordenActiva(orden.estado)) {
      await ajustarInventario(
        (orden.lineas || []).map((l) => ({ prodId: l.prodId, deltaReservado: l.qty }))
      );
    }
    await logAct(`Order #${num} → ${orden.cli}`);
  };

  const deleteOrden = async (id: string) => {
    const orden = ordenes.find((o) => o.id === id);
    const { error } = await supabase.from("ordenes").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setOrdenes((prev) => prev.filter((o) => o.id !== id));
    // Liberar las reservas que la orden retenia (las completadas ya las
    // consumieron al generar la factura).
    if (orden && ordenActiva(orden.estado)) {
      await ajustarInventario(
        (orden.lineas || []).map((l) => ({ prodId: l.prodId, deltaReservado: -l.qty }))
      );
    }
    await logAct(`Order deleted`);
  };

  const updateOrden = async (id: string, updated: Orden) => {
    const anterior = ordenes.find((o) => o.id === id);
    const { id: _omit, ...payload } = updated;
    const { data, error } = await supabase.from("ordenes").update(payload).eq("id", id).select().single();
    if (error) {
      console.error("[v0] Supabase error actualizando orden:", error);
      throw new Error(error.message);
    }
    setOrdenes((prev) => prev.map((o) => (o.id === id ? { ...(data as Orden), lineas: (data as Orden).lineas || [] } : o)));
    // Ajustar reservas por la DIFERENCIA entre lo que la orden retenia antes y
    // lo que retiene ahora. Una orden Completed/Cancelled ya no retiene nada,
    // asi que completarla o cancelarla libera sus reservas automaticamente.
    const qtyMap = (o?: { estado: string; lineas?: LineaOrden[] } | null) => {
      const m = new Map<string, number>();
      if (o && ordenActiva(o.estado)) {
        for (const l of o.lineas || []) m.set(l.prodId, (m.get(l.prodId) || 0) + l.qty);
      }
      return m;
    };
    const antes = qtyMap(anterior);
    const despues = qtyMap(updated);
    const idsProd = new Set([...antes.keys(), ...despues.keys()]);
    const deltas = Array.from(idsProd)
      .map((prodId) => ({ prodId, deltaReservado: (despues.get(prodId) || 0) - (antes.get(prodId) || 0) }))
      .filter((c) => c.deltaReservado !== 0);
    if (deltas.length) await ajustarInventario(deltas);
    await logAct(`Order #${updated.num} updated`);
  };

  // --- Mejoras ---
  const sanitizeMejora = (m: Omit<Mejora, "id">) => ({
    titulo: (m.titulo || "").trim(),
    descripcion: (m.descripcion || "").trim(),
    costo: Math.max(0, Number(m.costo) || 0),
    prioridad: m.prioridad || "Medium",
    estado: m.estado || "Pending",
  });

  const addMejora = async (m: Omit<Mejora, "id">) => {
    const { data, error } = await supabase.from("mejoras").insert(sanitizeMejora(m)).select().single();
    if (error) throw new Error(error.message);
    setMejoras((prev) => [data as Mejora, ...prev]);
    await logAct(`Improvement added: ${m.titulo}`);
  };

  const deleteMejora = async (id: string) => {
    const { error } = await supabase.from("mejoras").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setMejoras((prev) => prev.filter((e) => e.id !== id));
    await logAct(`Improvement deleted`);
  };

  const updateMejora = async (id: string, m: Omit<Mejora, "id">) => {
    const { data, error } = await supabase.from("mejoras").update(sanitizeMejora(m)).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setMejoras((prev) => prev.map((e) => (e.id === id ? (data as Mejora) : e)));
    await logAct(`Improvement updated: ${m.titulo}`);
  };

  // --- Gastos (P&L: solo los pagados cuentan como gasto real del periodo) ---
  const sanitizeGasto = (g: Omit<Gasto, "id">) => ({
    categoria: g.categoria || "Other",
    descripcion: (g.descripcion || "").trim(),
    monto: Math.max(0, Number(g.monto) || 0),
    fecha: g.fecha,
    pagado: !!g.pagado,
    fecha_pago: g.pagado ? g.fecha_pago || null : null,
    comprobante: g.pagado ? g.comprobante || null : null,
  });

  const addGasto = async (g: Omit<Gasto, "id">) => {
    const { data, error } = await supabase.from("gastos").insert(sanitizeGasto(g)).select().single();
    if (error) throw new Error(error.message);
    setGastos((prev) => [data as Gasto, ...prev]);
    await logAct(`Expense added: ${g.categoria} — ${fmt(g.monto)}`);
  };

  const updateGasto = async (id: string, g: Omit<Gasto, "id">) => {
    const { data, error } = await supabase.from("gastos").update(sanitizeGasto(g)).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setGastos((prev) => prev.map((e) => (e.id === id ? (data as Gasto) : e)));
    await logAct(g.pagado ? `Expense marked as paid: ${g.categoria} — ${fmt(g.monto)}` : `Expense updated: ${g.categoria}`);
  };

  const deleteGasto = async (id: string) => {
    const { error } = await supabase.from("gastos").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setGastos((prev) => prev.filter((e) => e.id !== id));
    await logAct(`Expense deleted`);
  };

  // --- Compras (ingresado de inventario): suma stock (solo palmhills, igual
  // que ajustarInventario) y actualiza el costo del producto al mas reciente.
  const addCompra = async (c: Omit<Compra, "id" | "num">) => {
    const { data: maxRow } = await supabase.from("compras").select("num").order("num", { ascending: false }).limit(1);
    const num = (maxRow && maxRow.length ? Number(maxRow[0].num) || 0 : 0) + 1;
    const { data, error } = await supabase
      .from("compras")
      .insert({ ...c, num, proveedor: (c.proveedor || "").trim() })
      .select()
      .single();
    if (error) throw new Error(error.message);
    setCompras((prev) => [data as Compra, ...prev]);

    // Actualizar costo de cada producto y sumar stock (palmhills en vivo; castillo no lleva stock)
    await Promise.all(
      c.lineas.map((l) => supabase.from("productos").update({ costo: l.costoUnitario }).eq("id", l.prodId))
    );
    setProductos((prev) =>
      prev.map((p) => {
        const l = c.lineas.find((x) => x.prodId === p.id);
        return l ? { ...p, costo: l.costoUnitario } : p;
      })
    );
    await ajustarInventario(c.lineas.map((l) => ({ prodId: l.prodId, deltaStock: Number(l.qty) || 0 })));

    await logAct(`Purchase #${num} from ${c.proveedor}: ${c.lineas.length} product(s), ${fmt(c.total)}`);
  };

  const deleteCompra = async (id: string) => {
    const { error } = await supabase.from("compras").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setCompras((prev) => prev.filter((e) => e.id !== id));
    await logAct(`Purchase deleted`);
  };

  // --- Calendario (agenda de ruta) ---
  const addEvento = async (ev: Omit<EventoCalendario, "id">) => {
    const { data, error } = await supabase.from("eventos_calendario").insert(ev).select().single();
    if (error) throw new Error(error.message);
    setEventosCalendario((prev) => [...prev, data as EventoCalendario]);
    await logAct(`Calendar event added: ${ev.tipos.join(" + ")} on ${ev.fecha}`);
  };

  const updateEvento = async (id: string, ev: Omit<EventoCalendario, "id">) => {
    const { data, error } = await supabase.from("eventos_calendario").update(ev).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setEventosCalendario((prev) => prev.map((e) => (e.id === id ? (data as EventoCalendario) : e)));
    await logAct(`Calendar event updated: ${ev.tipos.join(" + ")} on ${ev.fecha}`);
  };

  const deleteEvento = async (id: string) => {
    const { error } = await supabase.from("eventos_calendario").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setEventosCalendario((prev) => prev.filter((e) => e.id !== id));
    await logAct(`Calendar event deleted`);
  };

  // Fechas (>= hoy) ya marcadas como dia de entrega en el calendario: de aca
  // se eligen las fechas de entrega de ordenes/facturas, en vez de un campo
  // de fecha libre.
  const proximasFechasEntrega = useMemo(
    () =>
      Array.from(
        new Set(
          eventosCalendario
            .filter((e) => e.tipos.includes("delivery") && e.fecha >= today())
            .map((e) => e.fecha)
        )
      ).sort(),
    [eventosCalendario]
  );

  // --- Listas de precios ---
  const addListaPrecio = async (l: Omit<ListaPrecio, "id">) => {
    const { data, error } = await supabase.from("listas_precios").insert(l).select().single();
    if (error) throw new Error(error.message);
    const lista = { ...(data as ListaPrecio), precios: (data as ListaPrecio).precios || {} };
    setListasPrecios((prev) => [...prev, lista]);
    await logAct(`Price list created: ${l.nombre}`);
    return lista;
  };

  const updateListaPrecio = async (id: string, l: Omit<ListaPrecio, "id">) => {
    const { data, error } = await supabase.from("listas_precios").update(l).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setListasPrecios((prev) => prev.map((x) => (x.id === id ? { ...(data as ListaPrecio), precios: (data as ListaPrecio).precios || {} } : x)));
    await logAct(`Price list updated: ${l.nombre}`);
  };

  const deleteListaPrecio = async (id: string) => {
    const nombre = listasPrecios.find((x) => x.id === id)?.nombre || "";
    // Desasignar de los clientes que la tenian antes de borrarla
    const { error: eCli } = await supabase.from("clientes").update({ lista_precio_id: null }).eq("lista_precio_id", id);
    if (eCli) throw new Error(eCli.message);
    const { error } = await supabase.from("listas_precios").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setListasPrecios((prev) => prev.filter((x) => x.id !== id));
    setClientes((prev) => prev.map((c) => (c.lista_precio_id === id ? { ...c, lista_precio_id: null } : c)));
    await logAct(`Price list deleted: ${nombre}`);
  };

  // Asignacion grupal: fija (o quita, con null) la lista de varios clientes a la vez
  const asignarListaAClientes = async (listaId: string | null, clienteIds: string[]) => {
    if (clienteIds.length === 0) return;
    const { error } = await supabase.from("clientes").update({ lista_precio_id: listaId }).in("id", clienteIds);
    if (error) throw new Error(error.message);
    const ids = new Set(clienteIds);
    setClientes((prev) => prev.map((c) => (ids.has(c.id) ? { ...c, lista_precio_id: listaId } : c)));
    const nombre = listaId ? listasPrecios.find((x) => x.id === listaId)?.nombre || "" : "none";
    await logAct(`Price list "${nombre}" assigned to ${clienteIds.length} client(s)`);
  };

  // --- Categorias (Tipo de Negocio, etc.) ---
  const addCategoria = async (c: Omit<Categoria, "id">) => {
    const { data, error } = await supabase.from("categorias").insert(c).select().single();
    if (error) throw new Error(error.message);
    const cat = { ...(data as Categoria), valores: (data as Categoria).valores || [] };
    setCategorias((prev) => [...prev, cat]);
    await logAct(`Category created: ${c.nombre}`);
    return cat;
  };

  const updateCategoria = async (id: string, c: Omit<Categoria, "id">) => {
    const { data, error } = await supabase.from("categorias").update(c).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setCategorias((prev) => prev.map((x) => (x.id === id ? { ...(data as Categoria), valores: (data as Categoria).valores || [] } : x)));
  };

  const deleteCategoria = async (id: string) => {
    const nombre = categorias.find((x) => x.id === id)?.nombre || "";
    const { error } = await supabase.from("categorias").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setCategorias((prev) => prev.filter((x) => x.id !== id));
    // Limpiar la categoria borrada de todos los productos que la tuvieran
    setProductos((prev) =>
      prev.map((p) => {
        if (!p.categorias?.[id]) return p;
        const rest = { ...p.categorias };
        delete rest[id];
        return { ...p, categorias: rest };
      })
    );
    await logAct(`Category deleted: ${nombre}`);
  };

  // Marca/desmarca UN valor de UNA categoria en UN producto, sin tocar el
  // resto del producto (a diferencia de updateProducto, que reemplaza todo).
  const setProductoCategoriaValor = async (prodId: string, categoriaId: string, valor: string, activo: boolean) => {
    const p = productos.find((x) => x.id === prodId);
    if (!p) return;
    const actuales = p.categorias?.[categoriaId] || [];
    const nuevos = activo ? Array.from(new Set([...actuales, valor])) : actuales.filter((v) => v !== valor);
    const categoriasNuevas = { ...(p.categorias || {}), [categoriaId]: nuevos };
    const { error } = await supabase.from("productos").update({ categorias: categoriasNuevas }).eq("id", prodId);
    if (error) throw new Error(error.message);
    setProductos((prev) => prev.map((x) => (x.id === prodId ? { ...x, categorias: categoriasNuevas } : x)));
  };

  // Asigna (o quita, con "") la marca de UN producto sin tocar el resto —
  // mismo espiritu que setProductoCategoriaValor, para el picker bidireccional
  // de Brands (escribir la marca una vez, marcar productos, en vez de entrar
  // al edit de cada uno).
  const setProductoFabricante = async (prodId: string, fabricante: string) => {
    const { error } = await supabase.from("productos").update({ fabricante }).eq("id", prodId);
    if (error) throw new Error(error.message);
    setProductos((prev) => prev.map((x) => (x.id === prodId ? { ...x, fabricante } : x)));
  };

  // --- Vendedores (comision por venta y/o por cobro) ---
  const addVendedor = async (v: Omit<Vendedor, "id">) => {
    const { data, error } = await supabase.from("vendedores").insert(v).select().single();
    if (error) throw new Error(error.message);
    const vend = data as Vendedor;
    setVendedores((prev) => [...prev, vend]);
    await logAct(`Salesperson created: ${v.nombre}`);
    return vend;
  };

  const updateVendedor = async (id: string, v: Omit<Vendedor, "id">) => {
    const { data, error } = await supabase.from("vendedores").update(v).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setVendedores((prev) => prev.map((x) => (x.id === id ? (data as Vendedor) : x)));
  };

  const deleteVendedor = async (id: string) => {
    const nombre = vendedores.find((x) => x.id === id)?.nombre || "";
    // Desasignar de los clientes que lo tenian antes de borrarlo
    const { error: eCli } = await supabase.from("clientes").update({ vendedor_id: null }).eq("vendedor_id", id);
    if (eCli) throw new Error(eCli.message);
    const { error } = await supabase.from("vendedores").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setVendedores((prev) => prev.filter((x) => x.id !== id));
    setClientes((prev) => prev.map((c) => (c.vendedor_id === id ? { ...c, vendedor_id: null } : c)));
    await logAct(`Salesperson deleted: ${nombre}`);
  };

  const addTodo = async (t: Omit<Todo, "id" | "created_at" | "completado">) => {
    const { data, error } = await supabase.from("todos").insert({ ...t, completado: false }).select().single();
    if (error) throw new Error(error.message);
    setTodos((prev) => [data as Todo, ...prev]);
  };

  const toggleTodo = async (id: string) => {
    const { error } = await supabase.from("todos").update({ completado: true, completado_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const value: DataContextType = {
    role,
    readOnly: role === "visitante",
    clientes,
    productos,
    facturas,
    ordenes,
    remitos,
    mejoras,
    eventosCalendario,
    proximasFechasEntrega,
    logs,
    loading,
    addCliente,
    deleteCliente,
    updateCliente,
    addClientesBulk,
    addProducto,
    addProductosBulk,
    updateProducto,
    updateProductoFoto,
    deleteProducto,
    addFactura,
    deleteFactura,
    notasCredito,
    addNotaCredito,
    deleteNotaCredito,
    setNotaCreditoAplicada,
    addOrden,
    deleteOrden,
    updateOrden,
    addRemito,
    marcarRemitoEnviado,
    ajustarInventario,
    addMejora,
    deleteMejora,
    updateMejora,
    addEvento,
    updateEvento,
    deleteEvento,
    listasPrecios,
    addListaPrecio,
    updateListaPrecio,
    deleteListaPrecio,
    asignarListaAClientes,
    categorias,
    addCategoria,
    updateCategoria,
    deleteCategoria,
    setProductoCategoriaValor,
    setProductoFabricante,
    refreshLogs,
    refreshAll: loadAll,
    todos,
    addTodo,
    toggleTodo,
    gastos,
    addGasto,
    updateGasto,
    deleteGasto,
    compras,
    addCompra,
    deleteCompra,
    vendedores,
    addVendedor,
    updateVendedor,
    deleteVendedor,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
};


// ------------------------------
// Dashboard
// ------------------------------
const mesActualKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
// Top de productos por monto facturado desde una fecha (YYYY-MM-DD)
const calcTopProductos = (facturas: Factura[], desde: string, limite = 15) => {
  const totals: Record<string, { nom: string; sku: string; qty: number; monto: number }> = {};
  for (const f of facturas) {
    if ((f.fecha || "") < desde) continue;
    for (const l of f.lineas || []) {
      const key = l.sku || l.prodNom;
      if (!totals[key]) totals[key] = { nom: l.prodNom, sku: l.sku || "", qty: 0, monto: 0 };
      totals[key].qty += Number(l.qty) || 0;
      totals[key].monto += (Number(l.qty) || 0) * (Number(l.precio) || 0);
    }
  }
  return Object.values(totals).sort((a, b) => b.monto - a.monto).slice(0, limite);
};

// Score honesto de clientes (últimos N meses): 60% volumen + 40% pago.
// - Volumen: total facturado relativo al mejor cliente.
// - Pago: % pagado × rapidez, con corte en TERMINOS DE 30 DIAS:
//     COD (0-2 dias)  → 1.0 (premio maximo)
//     3-30 dias       → 0.9 bajando suave a 0.7 en el dia 30
//     mas de 30 dias  → cae de golpe a 0.4 y sigue hasta 0.1 a los 90
//   (promedio de dias ponderado por monto pagado)
// Así un cliente COD mediano puede superar a uno grande que tarda meses.
const speedFactor30 = (dias: number) => {
  if (dias <= 2) return 1.0;
  if (dias <= 30) return 0.9 - 0.2 * ((dias - 2) / 28);
  return Math.max(0.1, 0.4 - 0.3 * ((dias - 30) / 60));
};

const calcTopClientes = (facturas: Factura[], meses = 6, limite = 10) => {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  const desde = d.toISOString().slice(0, 10);
  const porCli: Record<string, { comprado: number; pagado: number; diasPond: number }> = {};
  for (const f of facturas) {
    if ((f.fecha || "") < desde) continue;
    const e = (porCli[f.cli] ??= { comprado: 0, pagado: 0, diasPond: 0 });
    e.comprado += Number(f.total) || 0;
    const t0 = new Date(f.fecha + "T00:00:00").getTime();
    for (const p of f.pagos || []) {
      const dias = Math.max(0, (new Date(p.fecha + "T00:00:00").getTime() - t0) / 86400000);
      e.pagado += Number(p.monto) || 0;
      e.diasPond += dias * (Number(p.monto) || 0);
    }
  }
  const arr = Object.entries(porCli)
    .filter(([, e]) => e.comprado > 0)
    .map(([cli, e]) => {
      const diasProm = e.pagado > 0 ? e.diasPond / e.pagado : 0;
      const speed = e.pagado > 0 ? speedFactor30(diasProm) : 0.2;
      const pctPagado = Math.min(1, e.pagado / e.comprado);
      return { cli, comprado: e.comprado, pctPagado, diasProm, payScore: pctPagado * speed };
    });
  const maxComprado = Math.max(...arr.map((a) => a.comprado), 1);
  return arr
    .map((a) => ({ ...a, score: 0.6 * (a.comprado / maxComprado) + 0.4 * a.payScore }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limite);
};

// Lista compacta de top clientes (usada en Home y en el modal de Clientes)
const TopClientesLista = ({ facturas }: { facturas: Factura[] }) => {
  const top = useMemo(() => calcTopClientes(facturas), [facturas]);
  if (!top.length) return <Empty text="Not enough invoice data yet." />;
  const maxScore = top[0].score || 1;
  return (
    <div>
      {top.map((c, i) => (
        <div key={c.cli} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border last:border-b-0">
          <div className="w-5 text-center text-xs font-bold text-muted-foreground shrink-0">{i + 1}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-card-foreground truncate leading-tight">{c.cli}</div>
            <div className={`text-[10px] leading-tight mt-0.5 ${c.pctPagado > 0 && c.diasProm > 30 ? "text-red-600 font-semibold" : c.diasProm <= 2 && c.pctPagado >= 0.95 ? "text-green-700 font-semibold" : "text-muted-foreground"}`}>
              {c.diasProm <= 2 && c.pctPagado >= 0.95
                ? "Pays COD ⚡"
                : c.pctPagado === 0
                  ? "No payments yet"
                  : `Pays in ~${Math.round(c.diasProm)}d · ${Math.round(c.pctPagado * 100)}% paid`}
            </div>
            <div className="mt-1 h-1 rounded-full overflow-hidden bg-secondary">
              <div className="h-full rounded-full" style={{ width: `${Math.round((c.score / maxScore) * 100)}%`, background: "var(--primary)" }} />
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs font-bold text-card-foreground tabular-nums">{fmt(c.comprado)}</div>
            <div className="text-[9px] text-muted-foreground">score {(c.score * 100).toFixed(0)}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

const mesActualNombre = () => {
  const nombre = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
};

const Dashboard = () => {
  const { facturas, clientes, productos, logs, readOnly, remitos, marcarRemitoEnviado, todos, toggleTodo } = useData();
  const supabase = useMemo(() => createClient(), []);
  const [meta, setMeta] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem(`ph_meta_${mesActualKey()}`) || 0);
  });
  const [editMeta, setEditMeta] = useState(false);
  const [metaInp, setMetaInp] = useState("");

  // Correo fijo al que se envian los remitos (tabla config, compartido entre
  // dispositivos). Se ajusta desde la propia tarjeta de remitos pendientes.
  const [remitoEmail, setRemitoEmail] = useState("");
  const [editRemitoEmail, setEditRemitoEmail] = useState(false);
  const [remitoEmailInp, setRemitoEmailInp] = useState("");
  const [savingRemitoEmail, setSavingRemitoEmail] = useState(false);

  useEffect(() => {
    supabase
      .from("config")
      .select("value")
      .eq("key", "remito_email")
      .maybeSingle()
      .then(({ data }) => setRemitoEmail(data?.value || ""), () => {});
    // El sales goal vive en la tabla config (compartido entre dispositivos y
    // sobrevive reinstalar la PWA); localStorage queda solo como cache local.
    supabase
      .from("config")
      .select("value")
      .eq("key", `meta_${mesActualKey()}`)
      .maybeSingle()
      .then(({ data }) => {
        const v = Number(data?.value || 0);
        if (v > 0) {
          setMeta(v);
          localStorage.setItem(`ph_meta_${mesActualKey()}`, String(v));
        }
      }, () => {});
  }, [supabase]);

  const saveRemitoEmail = async () => {
    const v = remitoEmailInp.trim();
    setSavingRemitoEmail(true);
    const { error } = await supabase.from("config").upsert({ key: "remito_email", value: v });
    setSavingRemitoEmail(false);
    if (error) {
      alert("Could not save the email: " + error.message);
      return;
    }
    setRemitoEmail(v);
    setEditRemitoEmail(false);
  };


  const facturasDelMes = useMemo(
    () => facturas.filter((f) => (f.fecha || "").slice(0, 7) === mesActualKey()),
    [facturas]
  );

  const totalVentas = useMemo(
    () => facturasDelMes.reduce((sum, f) => sum + Number(f.total), 0),
    [facturasDelMes]
  );
  const lowStock = useMemo(
    // Castillo no lleva inventario vivo: solo cuenta el stock de Palm Hills
    () => productos.filter((p) => (p.almacen || "palmhills") === "palmhills" && Number(p.stock) <= Number(p.min || 5)).length,
    [productos]
  );
  const pct = meta > 0 ? Math.min(100, Math.round((totalVentas / meta) * 100)) : 0;

  const statusLabel =
    pct >= 100 ? "Goal reached!" : pct >= 70 ? "Almost there!" : pct >= 40 ? "On track" : "Getting started";

  const saveMeta = async () => {
    const v = Number(metaInp);
    if (!v) return;
    localStorage.setItem(`ph_meta_${mesActualKey()}`, String(v));
    setMeta(v);
    setEditMeta(false);
    const { error } = await supabase
      .from("config")
      .upsert({ key: `meta_${mesActualKey()}`, value: String(v) });
    if (error) console.error("[v0] Error guardando meta en config:", error.message);
  };


  const top15 = useMemo(() => {
    const hace3meses = new Date();
    hace3meses.setMonth(hace3meses.getMonth() - 3);
    return calcTopProductos(facturas, hace3meses.toISOString().slice(0, 10));
  }, [facturas]);

  return (
    <div>
      <div className="rounded-3xl p-5 mb-3 text-white shadow-sm bg-gradient-to-br from-[#82a175] via-primary to-[#3c5536]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/75">
              Sales goal · {mesActualNombre()}
            </div>
            {meta > 0 && (
              <div className="text-xs text-white/70 mt-0.5">
                {statusLabel}
              </div>
            )}
          </div>
          {!readOnly && (
            <button
              className="rounded-full px-3 py-1.5 text-xs font-bold bg-white/20 hover:bg-white/30 transition-colors"
              onClick={() => {
                setMetaInp(meta ? String(meta) : "");
                setEditMeta(true);
              }}
            >
              {meta > 0 ? "Change" : "+ Set goal"}
            </button>
          )}
        </div>
        {meta > 0 ? (
          <>
            <div className="flex justify-between items-baseline mb-2.5">
              <div>
                <span className="text-2xl font-extrabold tracking-tight">{fmt(totalVentas)}</span>
                <span className="text-sm text-white/70 ml-1">of {fmt(meta)}</span>
              </div>
              <span className="text-base font-extrabold bg-white/20 px-2.5 py-1 rounded-full">
                {pct}%
              </span>
            </div>
            <div className="bg-white/25 rounded-full h-2.5 overflow-hidden mb-1.5">
              <div
                className="h-full rounded-full bg-white transition-all duration-500"
                style={{ width: `${pct}%`, minWidth: pct > 0 ? 4 : 0 }}
              />
            </div>
            {pct < 100 && (
              <div className="text-xs text-white/75 text-right">
                Remaining <strong className="text-white">{fmt(meta - totalVentas)}</strong>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-white/80 text-center py-2">Tap &quot;+ Set goal&quot; for your target</p>
        )}
      </div>

      <div className="bg-card border border-border rounded-3xl overflow-hidden mb-3.5">
        {[
          { icon: "💵", tint: "bg-primary/15", label: "Sales this month", val: fmt(totalVentas), warn: false },
          { icon: "🧾", tint: "bg-accent/20", label: "Invoices", val: facturas.length, warn: false },
          { icon: "👥", tint: "bg-primary/10", label: "Clients", val: clientes.length, warn: false },
          { icon: "📦", tint: "bg-red-50", label: "Low stock", val: lowStock, warn: lowStock > 0 },
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0">
            <div className={`w-9 h-9 rounded-xl ${row.tint} flex items-center justify-center text-base shrink-0`}>{row.icon}</div>
            <div className="flex-1 text-sm font-semibold text-card-foreground">{row.label}</div>
            <div className={`text-base font-extrabold tabular-nums ${row.warn ? "text-destructive" : "text-card-foreground"}`}>{row.val}</div>
          </div>
        ))}
      </div>


      {todos.length > 0 && (
        <div className="bg-card rounded-3xl p-3.5 mb-3 border border-border">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
            To-do · {todos.length} pending
          </div>
          {todos.map((t) => (
            <div key={t.id} className="flex items-start gap-3 py-2.5 border-b border-border last:border-b-0">
              <button
                onClick={() => { if (!readOnly) toggleTodo(t.id); }}
                disabled={readOnly}
                className="w-5 h-5 rounded border-2 border-muted-foreground mt-0.5 shrink-0 hover:border-primary transition-colors flex items-center justify-center disabled:opacity-40 disabled:hover:border-muted-foreground"
                title={readOnly ? "View only" : "Mark done"}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-card-foreground">{t.texto}</div>
                {t.cliente_nom && <div className="text-xs text-muted-foreground mt-0.5">{t.cliente_nom}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TOP PRODUCTS ── */}
      <div className="bg-card rounded-3xl overflow-hidden mb-3 border border-border">
        {/* Header con acento verde del logo */}
        <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-border">
          <div>
            <div className="text-sm font-bold text-card-foreground">Top Products</div>
            <div className="text-[10px] text-muted-foreground">Last 3 months · by revenue</div>
          </div>
          <div className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--secondary)", color: "var(--primary)" }}>
            🏆 Top {Math.min(top15.length, 15)}
          </div>
        </div>

        {top15.length === 0 ? (
          <Empty text="No invoices yet" />
        ) : (
          <>
            {/* Podio top 3 */}
            <div className="px-3 pt-3 pb-4 grid grid-cols-3 gap-2.5">
              {top15.slice(0, 3).map((p, i) => {
                const prod = productos.find((pr) => (p.sku && pr.sku === p.sku) || pr.nom === p.nom);
                const medals = ["🥇", "🥈", "🥉"];
                // Verde primario, plateado sutil, dorado acento — todos del tema
                const ringColors = [
                  "var(--primary)",          // #4a6741 verde logo
                  "var(--muted-foreground)", // gris neutro
                  "var(--accent)",           // #b09060 dorado cálido
                ];
                return (
                  <div key={p.sku || p.nom} className="flex flex-col items-center gap-1.5">
                    <div
                      className="relative w-full aspect-square rounded-xl overflow-hidden border-2"
                      style={{ borderColor: ringColors[i], boxShadow: `0 2px 12px 0 ${ringColors[i]}33` }}
                    >
                      {prod?.foto ? (
                        <img src={prod.foto} alt={p.nom} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl bg-secondary">📦</div>
                      )}
                      <div className="absolute top-1 left-1 text-sm leading-none">{medals[i]}</div>
                      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1" style={{ background: "linear-gradient(to top,rgba(0,0,0,0.7) 0%,transparent 100%)" }}>
                        <div className="text-[8px] font-bold text-white leading-tight truncate uppercase">{p.nom}</div>
                      </div>
                    </div>
                    <div className="text-[9px] font-semibold text-card-foreground text-center leading-tight line-clamp-2 uppercase" style={{ minHeight: "1.8rem" }}>
                      {p.nom}
                    </div>
                    {p.sku && <div className="text-[8px] font-mono text-primary/60 text-center truncate w-full">{p.sku}</div>}
                    <div className="text-[10px] font-bold" style={{ color: "var(--accent)" }}>{fmt(p.monto)}</div>
                    <div className="text-[9px] text-muted-foreground">{p.qty.toLocaleString()} u</div>
                  </div>
                );
              })}
            </div>

            {/* Posiciones 4–15 */}
            <div className="border-t border-border">
              {top15.slice(3).map((p, i) => {
                const rank = i + 4;
                const prod = productos.find((pr) => (p.sku && pr.sku === p.sku) || pr.nom === p.nom);
                const maxMonto = top15[0]?.monto || 1;
                const barW = Math.round((p.monto / maxMonto) * 100);
                return (
                  <div key={p.sku || p.nom} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border last:border-b-0">
                    <div className="w-5 text-center text-xs font-bold text-muted-foreground shrink-0">{rank}</div>
                    <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 border border-border bg-secondary flex items-center justify-center">
                      {prod?.foto ? (
                        <img src={prod.foto} alt={p.nom} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm">📦</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-card-foreground uppercase break-words leading-tight">{p.nom}</div>
                      {p.sku && <div className="text-[9px] font-mono text-primary/60 truncate leading-none mb-1">{p.sku}</div>}
                      <div className="mt-1 h-1 rounded-full overflow-hidden bg-secondary">
                        <div className="h-full rounded-full" style={{ width: `${barW}%`, background: "var(--primary)" }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-card-foreground">{fmt(p.monto)}</div>
                      <div className="text-[9px] text-muted-foreground">{p.qty.toLocaleString()} u</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Top clientes: volumen + comportamiento de pago (ver calcTopClientes) */}
      <div className="bg-card rounded-3xl overflow-hidden mb-3 border border-border">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-border">
          <div>
            <div className="text-sm font-bold text-card-foreground">Top Clients</div>
            <div className="text-[10px] text-muted-foreground">Last 6 months · volume + payment (30-day terms)</div>
          </div>
          <div className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--secondary)", color: "var(--primary)" }}>
            ⭐ Top 10
          </div>
        </div>
        <TopClientesLista facturas={facturas} />
      </div>

      <div className="bg-card rounded-3xl p-3.5 border border-border">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
          Recent activity
        </div>
        {logs.length ? (
          logs.slice(0, 6).map((l, i) => (
            <div
              key={i}
              className="flex gap-2.5 py-2 border-b border-border last:border-b-0"
            >
              <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
              <div>
                <div className="text-sm text-card-foreground">{l.msg}</div>
                <div className="text-xs text-muted-foreground">{l.ts}</div>
              </div>
            </div>
          ))
        ) : (
          <Empty text="No activity" />
        )}
      </div>

      {/* Remitos pendientes por enviar */}
      <div className="bg-card rounded-3xl p-3.5 mt-3 border border-border">
        <div className="mb-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              📦 Remitos pending to send
            </div>
            {!readOnly && !editRemitoEmail && (
              <button
                onClick={() => { setRemitoEmailInp(remitoEmail); setEditRemitoEmail(true); }}
                className="text-[11px] font-semibold text-primary shrink-0"
              >
                {remitoEmail ? "✏️ Edit email" : "＋ Set email"}
              </button>
            )}
          </div>
          {editRemitoEmail ? (
            <div className="flex items-center gap-1.5 mt-1.5">
              <input
                type="email"
                value={remitoEmailInp}
                onChange={(e) => setRemitoEmailInp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveRemitoEmail()}
                placeholder="remitos@example.com"
                autoFocus
                autoComplete="off"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-input bg-card text-card-foreground text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={saveRemitoEmail}
                disabled={savingRemitoEmail}
                className="px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50"
              >
                {savingRemitoEmail ? "..." : "Save"}
              </button>
              <button
                onClick={() => setEditRemitoEmail(false)}
                className="text-muted-foreground text-base leading-none px-1"
              >
                ×
              </button>
            </div>
          ) : remitoEmail ? (
            <div className="text-[11px] text-muted-foreground mt-0.5">✉️ Send to: <span className="font-mono">{remitoEmail}</span></div>
          ) : null}
        </div>
        {remitos && remitos.filter((r) => !r.enviado).length > 0 ? (
          remitos
            .filter((r) => !r.enviado)
            .sort((a, b) => b.num - a.num)
            .map((r) => {
              const lineas = [...(r.lineas || [])].sort((a, b) =>
                (a.sku || "").localeCompare(b.sku || "", "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en")
              );
              return (
                <div key={r.id} className="py-2.5 border-b border-border last:border-b-0">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate text-card-foreground uppercase">{r.cli}</div>
                      <div className="text-xs text-muted-foreground">Remito #{r.num} · Order #{r.orden_num} · {fdate(r.fecha)}</div>
                      {lineas.length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground font-mono">
                          {lineas.slice(0, 4).map((l, i) => (
                            <span key={i} className="block">{l.sku || "—"} ×{l.qtyEnviada ?? l.qty}</span>
                          ))}
                          {lineas.length > 4 && <span className="not-italic font-sans">+{lineas.length - 4} more</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <a
                        href={`/remitos/${r.id}`}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-center"
                      >
                        📄 View Remito
                      </a>
                      {remitoEmail && (
                        <a
                          href={`mailto:${remitoEmail}?subject=${encodeURIComponent(`Remito #${r.num} — ${r.cli}`)}&body=${encodeURIComponent(
                            `Remito #${r.num} · Order #${r.orden_num} · ${fdate(r.fecha)}\n\n${typeof window !== "undefined" ? window.location.origin : ""}/remitos/${r.id}`
                          )}`}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-secondary text-secondary-foreground border border-border hover:opacity-90 text-center"
                        >
                          ✉️ Email
                        </a>
                      )}
                      {!readOnly && (
                        <button
                          onClick={() => { if (confirm("Confirm this remito was sent?")) marcarRemitoEnviado(r.id); }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-secondary text-secondary-foreground border border-border hover:opacity-90"
                        >
                          ✓ Sent
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
        ) : (
          <Empty text="No pending remitos" />
        )}
      </div>


      {editMeta && (
        <Modal title={`Sales goal · ${mesActualNombre()}`} onClose={() => setEditMeta(false)}>
          <Field label="Target amount ($)">
            <MoneyInput
              value={Number(metaInp) || 0}
              onChange={(n) => setMetaInp(String(n))}
              onKeyDown={(e) => e.key === "Enter" && saveMeta()}
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-lg font-semibold outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <div className="flex gap-2 flex-wrap mb-3.5">
            {[10000, 25000, 50000, 100000, 250000, 500000].map((v) => (
              <button
                key={v}
                onClick={() => setMetaInp(String(v))}
                className={`text-xs px-3 py-1.5 rounded-lg border ${Number(metaInp) === v ? "bg-secondary text-secondary-foreground border-primary" : "bg-muted text-muted-foreground border-border"}`}
              >
                {fmt(v)}
              </button>
            ))}
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={() => setEditMeta(false)}
              className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
            >
              Cancel
            </button>
            <button
              onClick={saveMeta}
              className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY}`}
            >
              Save goal
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ------------------------------
// Calendario de entregas
// ------------------------------
const MESES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DIAS_CORTOS = ["S", "M", "T", "W", "T", "F", "S"];

const EVENTO_INFO: Record<TipoEvento, { icon: string; label: string }> = {
  delivery: { icon: "🚚", label: "Delivery day" },
  visit: { icon: "📍", label: "Visit" },
  collect_money: { icon: "💰", label: "Collect money" },
  order_request: { icon: "📝", label: "Order request" },
};

const Calendario = () => {
  const { ordenes, clientes, facturas, eventosCalendario, addEvento, updateEvento, deleteEvento, updateOrden, readOnly } = useData();
  const [mesActual, setMesActual] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // El modal sirve tanto para crear como editar. modalTipos permite elegir
  // varios tipos a la vez para un mismo evento (ej. Collect money + Order
  // request) excepto "delivery", que no lleva cliente y se agrega aparte.
  const [modalAbierto, setModalAbierto] = useState<"delivery" | "client" | null>(null);
  const [editingEventoId, setEditingEventoId] = useState<string | null>(null);
  const [modalTipos, setModalTipos] = useState<TipoEvento[]>([]);
  const [formFecha, setFormFecha] = useState(today());
  const [formClienteId, setFormClienteId] = useState("");
  const [formClienteSearch, setFormClienteSearch] = useState("");
  const [formClienteOpen, setFormClienteOpen] = useState(false);
  const [formNota, setFormNota] = useState("");
  const [saving, setSaving] = useState(false);
  // Mover un delivery (orden) a otra fecha desde el calendario
  const [movingOrden, setMovingOrden] = useState<Orden | null>(null);
  const [nuevaFechaOrden, setNuevaFechaOrden] = useState("");
  const [movingSaving, setMovingSaving] = useState(false);

  // Factura generada por cada orden (via completePick): en el calendario se
  // muestra el total facturado final, no el estimado de la orden.
  const facturaPorOrden = useMemo(() => {
    const map = new Map<string, Factura>();
    facturas.forEach((f) => { if (f.orden_id) map.set(f.orden_id, f); });
    return map;
  }, [facturas]);

  const handleMoverOrden = async () => {
    if (!movingOrden || !nuevaFechaOrden || movingSaving) return;
    setMovingSaving(true);
    try {
      await updateOrden(movingOrden.id, { ...movingOrden, fecha: nuevaFechaOrden });
      // Si el dia destino no esta marcado como delivery en el calendario, se
      // marca para que se pinte y aparezca en los selectores de fecha.
      const yaMarcado = eventosCalendario.some((e) => e.fecha === nuevaFechaOrden && e.tipos.includes("delivery"));
      if (!yaMarcado) {
        await addEvento({ fecha: nuevaFechaOrden, tipos: ["delivery"], cliente_id: null });
      }
      setMovingOrden(null);
    } catch (err) {
      alert(`Could not move the delivery: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMovingSaving(false);
    }
  };

  const ordenesPorFecha = useMemo(() => {
    const map: Record<string, Orden[]> = {};
    ordenes.forEach((o) => {
      if (!o.fecha) return;
      if (!map[o.fecha]) map[o.fecha] = [];
      map[o.fecha].push(o);
    });
    return map;
  }, [ordenes]);

  const eventosPorFecha = useMemo(() => {
    const map: Record<string, EventoCalendario[]> = {};
    eventosCalendario.forEach((e) => {
      if (!map[e.fecha]) map[e.fecha] = [];
      map[e.fecha].push(e);
    });
    return map;
  }, [eventosCalendario]);

  const clienteFor = (cli: string) =>
    clientes.find((c) => c.id === cli) || clientes.find((c) => c.nom === cli);

  const primerDia = new Date(mesActual.year, mesActual.month, 1);
  const diasEnMes = new Date(mesActual.year, mesActual.month + 1, 0).getDate();
  const offsetInicial = primerDia.getDay();
  const celdas: (string | null)[] = [
    ...Array(offsetInicial).fill(null),
    ...Array.from({ length: diasEnMes }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      const m = String(mesActual.month + 1).padStart(2, "0");
      return `${mesActual.year}-${m}-${d}`;
    }),
  ];

  const cambiarMes = (delta: number) => {
    setDiaSeleccionado(null);
    setMesActual((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const TIPO_PRIORIDAD: Record<TipoEvento, number> = { delivery: 0, collect_money: 1, order_request: 2, visit: 3 };
  const prioridadEvento = (ev: EventoCalendario) => Math.min(...ev.tipos.map((t) => TIPO_PRIORIDAD[t] ?? 9), 9);
  const ordenesDelDia = diaSeleccionado ? ordenesPorFecha[diaSeleccionado] || [] : [];
  const eventosDelDia = (diaSeleccionado ? eventosPorFecha[diaSeleccionado] || [] : [])
    .slice()
    .sort((a, b) => prioridadEvento(a) - prioridadEvento(b));

  const abrirModalEvento = (modo: "delivery" | "client") => {
    setModalAbierto(modo);
    setEditingEventoId(null);
    setModalTipos(modo === "delivery" ? ["delivery"] : []);
    setFormFecha(diaSeleccionado ?? today());
    setFormClienteId("");
    setFormClienteSearch("");
    setFormClienteOpen(false);
    setFormNota("");
    setMenuOpen(false);
  };

  const abrirEditarEvento = (ev: EventoCalendario) => {
    const cInfo = ev.cliente_id ? clienteFor(ev.cliente_id) : null;
    setModalAbierto(ev.tipos.includes("delivery") ? "delivery" : "client");
    setEditingEventoId(ev.id);
    setModalTipos(ev.tipos);
    setFormFecha(ev.fecha);
    setFormClienteId(ev.cliente_id || "");
    setFormClienteSearch(cInfo?.nom || "");
    setFormClienteOpen(false);
    setFormNota(ev.nota || "");
  };

  const toggleModalTipo = (tipo: TipoEvento) => {
    setModalTipos((prev) => (prev.includes(tipo) ? prev.filter((t) => t !== tipo) : [...prev, tipo]));
  };

  const cerrarModalEvento = () => {
    setModalAbierto(null);
    setEditingEventoId(null);
  };

  const handleGuardarEvento = async () => {
    if (!modalAbierto) return;
    if (modalAbierto === "client" && !modalTipos.length) {
      alert("Select at least one type (Visit, Collect money, Order request)");
      return;
    }
    if (modalAbierto === "client" && !formClienteId) {
      alert("Select a client");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        fecha: formFecha,
        tipos: modalAbierto === "delivery" ? (["delivery"] as TipoEvento[]) : modalTipos,
        cliente_id: modalAbierto === "delivery" ? null : formClienteId,
        ...(formNota.trim() ? { nota: formNota.trim() } : {}),
      };
      if (editingEventoId) await updateEvento(editingEventoId, payload);
      else await addEvento(payload);
      cerrarModalEvento();
    } catch (err) {
      alert(`Could not save this to the calendar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvento = (ev: EventoCalendario) => {
    if (!confirm("Remove this from the calendar?")) return;
    deleteEvento(ev.id)
      .then(() => cerrarModalEvento())
      .catch((err) => alert(`Could not remove it: ${err instanceof Error ? err.message : String(err)}`));
  };

  return (
    <div>
      <div className="bg-card rounded-3xl p-3.5 border border-border mb-3">
        <div className="flex items-center justify-between mb-3.5">
          <div className="inline-flex items-center gap-1 bg-muted rounded-full p-1">
            <button
              onClick={() => cambiarMes(-1)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-card-foreground active:bg-card/70"
            >
              ‹
            </button>
            <span className="text-base font-extrabold text-card-foreground tracking-tight min-w-[112px] text-center px-1">
              {MESES[mesActual.month]} {mesActual.year}
            </span>
            <button
              onClick={() => cambiarMes(1)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-card-foreground active:bg-card/70"
            >
              ›
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="fixed inset-0 z-[6]" onClick={() => setMenuOpen(false)} aria-hidden="true" />
        )}
        {!readOnly && (
          <div className={`${ADD_PILL_POS} flex flex-col items-end gap-2`}>
            {menuOpen && (
              <div className="flex flex-col gap-2 mb-1">
                <button
                  onClick={() => abrirModalEvento("delivery")}
                  className="flex items-center gap-2 bg-card border border-border text-card-foreground rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium whitespace-nowrap"
                >
                  <span className="text-base" aria-hidden="true">{EVENTO_INFO.delivery.icon}</span>
                  {EVENTO_INFO.delivery.label}
                </button>
                <button
                  onClick={() => abrirModalEvento("client")}
                  className="flex items-center gap-2 bg-card border border-border text-card-foreground rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium whitespace-nowrap"
                >
                  <span className="text-base" aria-hidden="true">📍💰📝</span>
                  Client event
                </button>
              </div>
            )}
            <AddPillButton aria-label="Add to calendar" active={menuOpen} onClick={() => setMenuOpen((o) => !o)} />
          </div>
        )}

        <div className="grid grid-cols-7 gap-1 mb-1">
          {DIAS_CORTOS.map((d, i) => (
            <div key={i} className="text-center text-[10px] font-bold text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {celdas.map((fecha, i) => {
            if (!fecha) return <div key={i} />;
            const eventosDia = eventosPorFecha[fecha] || [];
            const esEntrega = eventosDia.some((e) => e.tipos.includes("delivery"));
            const tieneAgenda = eventosDia.some((e) => e.tipos.some((t) => t !== "delivery"));
            const ordenesDia = ordenesPorFecha[fecha] || [];
            const numDia = Number(fecha.slice(-2));
            const esHoy = fecha === today();
            const celdaBase = "aspect-square flex flex-col items-center justify-center relative text-xs transition-colors";
            const celdaClase =
              diaSeleccionado === fecha
                ? `${celdaBase} rounded-2xl bg-primary text-primary-foreground font-bold`
                : esHoy
                  ? `${celdaBase} rounded-full bg-primary text-primary-foreground font-extrabold`
                  : esEntrega
                    ? `${celdaBase} rounded-2xl bg-[#22c55e]/30 text-[#15803d] font-bold`
                    : `${celdaBase} rounded-2xl bg-muted text-card-foreground`;
            return (
              <button
                key={fecha}
                onClick={() => setDiaSeleccionado(fecha === diaSeleccionado ? null : fecha)}
                className={celdaClase}
              >
                {numDia}
                <span className="absolute bottom-0.5 flex gap-0.5">
                  {ordenesDia.length > 0 && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        diaSeleccionado === fecha ? "bg-white" : "bg-primary"
                      }`}
                    />
                  )}
                  {tieneAgenda && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        diaSeleccionado === fecha ? "bg-white" : "bg-accent"
                      }`}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-2.5 px-0.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-primary shrink-0" /> Today
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" /> Orders that day
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" /> Visit / Collect / Request
          </div>
        </div>
      </div>

      {diaSeleccionado && (
        <div className="bg-card rounded-3xl p-3.5 border border-border mb-3">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {fdate(diaSeleccionado)}
          </div>
          {eventosDelDia.length > 0 && (
            <div className="mb-2">
              {eventosDelDia.map((ev) => {
                const infos = ev.tipos.map((t) => EVENTO_INFO[t]);
                const cInfo = ev.cliente_id ? clienteFor(ev.cliente_id) : null;
                return (
                  <button
                    key={ev.id}
                    onClick={() => abrirEditarEvento(ev)}
                    className="w-full flex items-center justify-between gap-2 py-2 border-b border-border last:border-b-0 text-left"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-base shrink-0" aria-hidden="true">{infos.map((i) => i.icon).join("")}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold uppercase text-card-foreground break-words">
                          {cInfo ? cInfo.nom : infos.map((i) => i.label).join(" + ")}
                        </div>
                        <div className="text-xs text-muted-foreground">{infos.map((i) => i.label).join(" + ")}</div>
                        {ev.nota && <div className="text-xs text-muted-foreground italic mt-0.5 break-words">"{ev.nota}"</div>}
                      </div>
                    </div>
                    {!readOnly && (
                      <span
                        onClick={(e) => { e.stopPropagation(); handleDeleteEvento(ev); }}
                        role="button"
                        aria-label="Remove"
                        className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-red-50 shrink-0"
                      >
                        ×
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Deliveries for {fdate(diaSeleccionado)}
          </div>
          {ordenesDelDia.length ? (
            ordenesDelDia.map((o) => {
              const cInfo = clienteFor(o.cli);
              const fact = facturaPorOrden.get(o.id);
              return (
                <div key={o.id} className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold uppercase text-card-foreground truncate">
                      {cInfo ? cInfo.nom : o.cli}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Order #{o.num}{fact ? ` · Invoice #${fact.num}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-bold text-card-foreground">{fmt(fact ? fact.total : o.total)}</div>
                      <Badge e={o.estado} />
                    </div>
                    {!readOnly && (
                      <button
                        onClick={() => { setMovingOrden(o); setNuevaFechaOrden(o.fecha); }}
                        aria-label="Move delivery to another date"
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-card-foreground text-sm"
                      >
                        📅
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <Empty text="No deliveries scheduled for this day." />
          )}
        </div>
      )}

      {movingOrden && !readOnly && (
        <Modal title={`Move delivery — Order #${movingOrden.num}`} onClose={() => setMovingOrden(null)}>
          <div className="text-xs text-muted-foreground mb-2 uppercase font-semibold">
            {clienteFor(movingOrden.cli)?.nom || movingOrden.cli}
          </div>
          {(() => {
            const proximas = Array.from(
              new Set(
                eventosCalendario
                  .filter((e) => e.tipos.includes("delivery") && e.fecha >= today() && e.fecha !== movingOrden.fecha)
                  .map((e) => e.fecha)
              )
            ).sort().slice(0, 8);
            return proximas.length > 0 ? (
              <div className="mb-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Upcoming delivery days</div>
                <div className="flex flex-wrap gap-1.5">
                  {proximas.map((f) => (
                    <button
                      key={f}
                      onClick={() => setNuevaFechaOrden(f)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${
                        nuevaFechaOrden === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-card-foreground border-border"
                      }`}
                    >
                      🚚 {fdate(f)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null;
          })()}
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Or pick any date</div>
          <input
            type="date"
            value={nuevaFechaOrden}
            onChange={(e) => setNuevaFechaOrden(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring mb-3"
          />
          <button
            onClick={handleMoverOrden}
            disabled={movingSaving || !nuevaFechaOrden || nuevaFechaOrden === movingOrden.fecha}
            className={`w-full py-2.5 rounded-xl font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
          >
            {movingSaving ? "Moving..." : `Move to ${nuevaFechaOrden ? fdate(nuevaFechaOrden) : "..."}`}
          </button>
        </Modal>
      )}

      {modalAbierto && (
        <Modal
          title={editingEventoId ? "Edit calendar event" : modalAbierto === "delivery" ? EVENTO_INFO.delivery.label : "Client event"}
          onClose={cerrarModalEvento}
        >
          <Field label="Date">
            <input
              type="date"
              value={formFecha}
              onChange={(e) => setFormFecha(e.target.value)}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          {modalAbierto === "client" && (
            <Field label="Type (select one or more)">
              <div className="flex flex-wrap gap-1.5">
                {(["visit", "collect_money", "order_request"] as TipoEvento[]).map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => toggleModalTipo(tipo)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                      modalTipos.includes(tipo) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent"
                    }`}
                  >
                    <span aria-hidden="true">{EVENTO_INFO[tipo].icon}</span>
                    {EVENTO_INFO[tipo].label}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {modalAbierto !== "delivery" && (
            <Field label="Client">
              <div className="relative">
                <input
                  type="text"
                  value={formClienteSearch}
                  onChange={(e) => {
                    setFormClienteSearch(e.target.value);
                    setFormClienteId("");
                    setFormClienteOpen(true);
                  }}
                  onFocus={() => setFormClienteOpen(true)}
                  placeholder="Search client by name..."
                  autoComplete="off"
                  className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
                />
                {formClienteId ? (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary text-xs font-bold">✓</span>
                ) : formClienteSearch ? (
                  <button onClick={() => { setFormClienteSearch(""); setFormClienteId(""); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button>
                ) : null}
                {formClienteOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setFormClienteOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto w-full">
                      {clientes
                        .filter((c) => !formClienteSearch.trim() || c.nom.toLowerCase().includes(formClienteSearch.toLowerCase()) || (c.codigo_cliente || "").toLowerCase().includes(formClienteSearch.toLowerCase()))
                        .map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setFormClienteId(c.id);
                              setFormClienteSearch(c.nom);
                              setFormClienteOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2.5 hover:bg-muted ${formClienteId === c.id ? "bg-muted/50" : ""}`}
                          >
                            {c.codigo_cliente && <span className="block text-[11px] font-black font-mono text-primary leading-tight">{c.codigo_cliente}</span>}
                            <span className={`text-sm ${formClienteId === c.id ? "font-bold text-primary" : "text-card-foreground"}`}>{c.nom}</span>
                          </button>
                        ))}
                      {clientes.filter((c) => !formClienteSearch.trim() || c.nom.toLowerCase().includes(formClienteSearch.toLowerCase()) || (c.codigo_cliente || "").toLowerCase().includes(formClienteSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2.5 text-xs text-muted-foreground">No clients found</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </Field>
          )}
          <Field label="Note (optional)">
            <textarea
              value={formNota}
              onChange={(e) => setFormNota(e.target.value)}
              placeholder={modalTipos.includes("visit") ? "e.g. Before noon, ask for Rafael…" : "Add a note…"}
              rows={4}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <div className="flex gap-2.5 mt-2">
            {editingEventoId && !readOnly && (
              <button
                onClick={() => handleDeleteEvento({ id: editingEventoId, fecha: formFecha, tipos: modalTipos, cliente_id: formClienteId || null, nota: formNota })}
                className={`px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_DESTRUCTIVE}`}
              >
                Delete
              </button>
            )}
            <button
              onClick={handleGuardarEvento}
              disabled={saving}
              className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
            >
              {saving ? "Saving..." : editingEventoId ? "Save Changes" : "Add"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ------------------------------
// Facturas
// ------------------------------
const Facturas = () => {
  const { facturas, clientes, productos, proximasFechasEntrega, addFactura, deleteFactura, notasCredito, addNotaCredito, deleteNotaCredito, remitos, readOnly, listasPrecios } =
    useData();
  const router = useRouter();
  // Prefetch del codigo de la pagina de detalle: sin esto, el primer tap a una
  // factura tiene que descargar el chunk JS de la ruta y se percibe lento.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (facturas[0]) router.prefetch(`/facturas/${facturas[0].id}`);
  }, [facturas.length > 0]);
  const [subTab, setSubTab] = useState<"invoices" | "creditos" | "remitos">("invoices");
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [lineas, setLineas] = useState([{ prodId: "", qty: 1 }]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState("");
  const [fecha, setFecha] = useState("");
  const [estado, setEstado] = useState("Pending");
  const [invAlmacen, setInvAlmacen] = useState<"palmhills" | "castillo" | "all">("all");
  const [invSearches, setInvSearches] = useState<string[]>([""]);
  const [invFocus, setInvFocus] = useState<number | null>(null);
  // Credit notes form
  const [showNcForm, setShowNcForm] = useState(false);
  const [ncTipo, setNcTipo] = useState<"amount" | "product">("amount");
  const [ncForm, setNcForm] = useState({ cli: "", fecha: today(), monto: "", motivo: "" });
  const [ncCliSearch, setNcCliSearch] = useState("");
  const [ncCliOpen, setNcCliOpen] = useState(false);
  const [ncSaving, setNcSaving] = useState(false);
  const [ncLineas, setNcLineas] = useState<{ prodSearch: string; prodId: string; qty: number; precio: string }[]>([{ prodSearch: "", prodId: "", qty: 1, precio: "" }]);
  const [ncProdOpen, setNcProdOpen] = useState<number | null>(null);
  const [ncQ, setNcQ] = useState("");
  const [saving, setSaving] = useState(false);

  const clienteCodigo = (nom: string) =>
    clientes.find((c) => c.nom === nom)?.codigo_cliente || "—";

  const productosPorSku = useMemo(
    () =>
      [...productos].sort((a, b) => {
        const skuA = (a.sku || "").trim();
        const skuB = (b.sku || "").trim();
        if (!skuA && skuB) return 1;
        if (skuA && !skuB) return -1;
        return skuA.localeCompare(skuB, "en", { numeric: true }) || a.nom.localeCompare(b.nom, "en");
      }),
    [productos]
  );

  const productosInvAlmacen = useMemo(
    () =>
      productosPorSku.filter((p) => {
        if (invAlmacen === "all") return true;
        const alm = p.almacen ?? null;
        if (invAlmacen === "palmhills") return alm === "palmhills" || alm === null;
        return alm === invAlmacen;
      }),
    [productosPorSku, invAlmacen]
  );

  const getInvSugeridos = (search: string) => {
    if (!search.trim()) return productosInvAlmacen.slice(0, 30);
    return flexibleSearch(
      productosInvAlmacen,
      search,
      (p) => [p.nom, p.sku, p.barcode, ...(p.etiquetas || [])].filter(Boolean).join(" "),
      (p) => p.nom
    ).slice(0, 50);
  };

  const filtered = q
    ? facturas.filter(
        (f) =>
          f.cli.toLowerCase().includes(q.toLowerCase()) ||
          String(f.num).includes(q)
      )
    : facturas;

  const { visible: visibleFacturas, hasMore, remaining, loadMore } = usePagedList(filtered, [q]);

  // Lista de precios del cliente seleccionado (facturas.cli guarda el NOMBRE)
  const listaCliente = useMemo(() => {
    const c = clientes.find((x) => x.nom === clienteSeleccionado);
    if (!c?.lista_precio_id) return null;
    return listasPrecios.find((lp) => lp.id === c.lista_precio_id) || null;
  }, [clienteSeleccionado, clientes, listasPrecios]);
  const precioCliente = (p: Producto) => listaCliente?.precios?.[p.id] ?? Number(p.precio);

  // Sin impuestos: el total es la suma directa de las lineas.
  const total = lineas.reduce((acc, l) => {
    const p = productos.find((x) => x.id === l.prodId);
    return acc + (p ? precioCliente(p) * Number(l.qty || 1) : 0);
  }, 0);

  const handleSave = async () => {
    if (saving) return;
    if (!clienteSeleccionado) {
      alert("Select a client");
      return;
    }
    if (!fecha) {
      alert("Select a delivery date");
      return;
    }
    const items = lineas.filter((l) => l.prodId);
    if (items.length === 0) {
      alert("Add at least one product");
      return;
    }
    const lineasDetalle: LineaFactura[] = items.map((l) => {
      const p = productos.find((x) => x.id === l.prodId)!;
      return {
        prodNom: p.nom,
        sku: p.sku || "",
        barcode: p.barcode || "",
        qty: Number(l.qty),
        precio: precioCliente(p),
        precioOriginal: precioCliente(p),
        precioCatalogo: Number(p.precio),
        almacen: p.almacen || "palmhills",
      };
    });
    setSaving(true);
    try {
      await addFactura({
        cli: clienteSeleccionado,
        fecha,
        estado,
        total: +total.toFixed(2),
        lineas: lineasDetalle,
      });
      setShow(false);
      setLineas([{ prodId: "", qty: 1 }]);
      setClienteSeleccionado("");
      setFecha("");
      setEstado("Pending");
      setInvSearches([""]);
      setInvFocus(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Sub-tab toggle */}
      <div className="inline-flex backdrop-blur-md bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5 mb-4">
        <button onClick={() => setSubTab("invoices")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${subTab === "invoices" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
          🧾 Invoices
        </button>
        <button onClick={() => setSubTab("creditos")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${subTab === "creditos" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
          📋 Credit Notes
        </button>
        <button onClick={() => setSubTab("remitos")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${subTab === "remitos" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
          📦 Remitos
        </button>
      </div>

      {subTab === "creditos" ? (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <input value={ncQ} onChange={(e) => setNcQ(e.target.value)} placeholder="Search by client..." className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
              {ncQ && <button onClick={() => setNcQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button>}
            </div>
          </div>
          {!readOnly && (
            <AddPillButton
              className={ADD_PILL_POS}
              aria-label="New credit note"
              onClick={() => { setNcForm({ cli: "", fecha: today(), monto: "", motivo: "" }); setNcCliSearch(""); setNcTipo("amount"); setNcLineas([{ prodSearch: "", prodId: "", qty: 1, precio: "" }]); setShowNcForm(true); }}
            />
          )}
          {(() => {
            const ncs = notasCredito.filter(n => !ncQ || n.cli.toLowerCase().includes(ncQ.toLowerCase())).sort((a,b) => b.num - a.num);
            return ncs.length ? (
              <div className="bg-card border border-border rounded-3xl overflow-hidden mb-3">
                {ncs.map((n, i) => (
                  <div
                    key={n.id}
                    onClick={() => router.push(`/notas-credito/${n.id}`)}
                    className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/30 group ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <div className="shrink-0">
                      <div className="text-xs font-mono font-semibold text-[#a3814e] whitespace-nowrap">CN #{String(n.num).padStart(3, "0")}</div>
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap">{fdate(n.fecha)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-card-foreground truncate tracking-tight">{n.cli}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {n.aplicada ? `Applied${n.aplicada_en ? ` · ${n.aplicada_en}` : ""}` : n.motivo || ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`text-sm font-bold tabular-nums ${n.aplicada ? "text-muted-foreground line-through" : "text-card-foreground"}`}>{fmt(n.monto)}</span>
                        {n.aplicada ? (
                          <span className="pl-2 pr-2.5 py-0.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />Applied
                          </span>
                        ) : (
                          <Badge e="Active" />
                        )}
                      </div>
                      {!readOnly && <button onClick={(e) => { e.stopPropagation(); if (confirm("Delete this credit note?")) deleteNotaCredito(n.id); }} className="opacity-0 group-hover:opacity-100 text-destructive text-sm px-1">×</button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card rounded-3xl p-3.5 border border-border mb-3"><p className="text-sm text-muted-foreground text-center">No credit notes.</p></div>
            );
          })()}
          {showNcForm && !readOnly && (
            <Modal title="New Credit Note" onClose={() => setShowNcForm(false)}>
              {/* Tipo selector */}
              <div className="flex gap-1.5 p-1 bg-muted rounded-xl mb-1">
                {(["amount", "product"] as const).map(t => (
                  <button key={t} onClick={() => setNcTipo(t)} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${ncTipo === t ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>
                    {t === "amount" ? "By Amount" : "By Product"}
                  </button>
                ))}
              </div>

              {/* Client */}
              <Field label="Client">
                <div className="relative">
                  <input type="text" value={ncCliSearch} onChange={(e) => { setNcCliSearch(e.target.value); setNcForm(f => ({ ...f, cli: "" })); setNcCliOpen(true); }} onFocus={() => setNcCliOpen(true)} placeholder="Search client..." autoComplete="off" className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
                  {ncForm.cli ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary text-xs font-bold">✓</span> : ncCliSearch ? <button onClick={() => { setNcCliSearch(""); setNcForm(f => ({ ...f, cli: "" })); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button> : null}
                  {ncCliOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setNcCliOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto w-full">
                        {clientes.filter(c => !ncCliSearch || c.nom.toLowerCase().includes(ncCliSearch.toLowerCase()) || (c.codigo_cliente || "").toLowerCase().includes(ncCliSearch.toLowerCase())).map(c => (
                          <button key={c.id} onClick={() => { setNcForm(f => ({ ...f, cli: c.nom })); setNcCliSearch(c.nom); setNcCliOpen(false); }} className={`w-full text-left px-3 py-2.5 hover:bg-muted ${ncForm.cli === c.nom ? "bg-muted/50" : ""}`}>
                            {c.codigo_cliente && <span className="block text-[11px] font-black font-mono text-primary leading-tight">{c.codigo_cliente}</span>}
                            <span className={`text-sm ${ncForm.cli === c.nom ? "font-bold text-primary" : "text-card-foreground"}`}>{c.nom}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Field>

              {/* Date */}
              <Field label="Date">
                <input type="date" value={ncForm.fecha} onChange={(e) => setNcForm(f => ({ ...f, fecha: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
              </Field>

              {ncTipo === "amount" ? (
                <>
                  <Field label="Amount ($)">
                    <MoneyInput value={Number(ncForm.monto) || 0} onChange={(n) => setNcForm(f => ({ ...f, monto: String(n) }))} className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
                  </Field>
                  <Field label="Reason / Notes">
                    <input type="text" value={ncForm.motivo} onChange={(e) => setNcForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Reason for credit..." className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
                  </Field>
                </>
              ) : (
                <>
                  {/* Product lines */}
                  <div className="space-y-2">
                    {ncLineas.map((ln, idx) => {
                      const prod = productos.find(p => p.id === ln.prodId);
                      const lineTotal = prod ? (parseFloat(ln.precio) || 0) * ln.qty : 0;
                      return (
                        <div key={idx} className="bg-muted rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Product {idx + 1}</span>
                            {ncLineas.length > 1 && (
                              <button onClick={() => setNcLineas(prev => prev.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive text-lg leading-none">×</button>
                            )}
                          </div>
                          {/* Product search */}
                          <div className="relative">
                            <input
                              type="text"
                              value={ln.prodSearch}
                              onChange={(e) => {
                                const v = e.target.value;
                                setNcLineas(prev => prev.map((l, i) => i === idx ? { ...l, prodSearch: v, prodId: "", precio: "" } : l));
                                setNcProdOpen(idx);
                              }}
                              onFocus={() => setNcProdOpen(idx)}
                              placeholder="Search product..."
                              autoComplete="off"
                              className="w-full px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
                            />
                            {ln.prodId && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary text-xs font-bold">✓</span>}
                            {ncProdOpen === idx && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setNcProdOpen(null)} />
                                <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto w-full">
                                  {productos.filter(p => !ln.prodSearch || p.nom.toLowerCase().includes(ln.prodSearch.toLowerCase()) || (p.sku || "").toLowerCase().includes(ln.prodSearch.toLowerCase())).slice(0, 30).map(p => (
                                    <button key={p.id} onClick={() => {
                                      setNcLineas(prev => prev.map((l, i) => i === idx ? { ...l, prodId: p.id, prodSearch: p.nom, precio: String(p.precio) } : l));
                                      setNcProdOpen(null);
                                    }} className="w-full text-left px-3 py-2 hover:bg-muted border-b border-border last:border-0">
                                      <div className="text-sm font-medium text-card-foreground uppercase">{p.nom}</div>
                                      <div className="text-xs text-muted-foreground">{p.sku ? `SKU: ${p.sku} · ` : ""}${fmt(p.precio)}</div>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                          {/* Qty + Price */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Qty</label>
                              <input type="number" min="1" value={ln.qty} onChange={(e) => setNcLineas(prev => prev.map((l, i) => i === idx ? { ...l, qty: parseInt(e.target.value) || 1 } : l))} className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring" />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Unit Price ($)</label>
                              <MoneyInput value={Number(ln.precio) || 0} onChange={(n) => setNcLineas(prev => prev.map((l, i) => i === idx ? { ...l, precio: String(n) } : l))} className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring" />
                            </div>
                          </div>
                          {ln.prodId && <div className="text-right text-xs font-bold text-primary">Line total: {fmt(lineTotal)}</div>}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setNcLineas(prev => [...prev, { prodSearch: "", prodId: "", qty: 1, precio: "" }])} className={`w-full py-2 rounded-xl text-sm font-bold mt-1 ${GLASS_BTN}`}>
                    + Add Product
                  </button>
                  {/* Total preview */}
                  {ncLineas.some(l => l.prodId) && (
                    <div className="flex items-center justify-between bg-primary/10 rounded-xl px-4 py-2.5 mt-1">
                      <span className="text-sm font-bold text-card-foreground">Credit Total</span>
                      <span className="text-base font-black text-primary">{fmt(ncLineas.reduce((s, l) => s + (parseFloat(l.precio) || 0) * l.qty, 0))}</span>
                    </div>
                  )}
                  <Field label="Reason / Notes">
                    <input type="text" value={ncForm.motivo} onChange={(e) => setNcForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Reason for credit..." className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
                  </Field>
                </>
              )}

              <button
                disabled={ncSaving || !ncForm.cli || (ncTipo === "amount" ? !ncForm.monto : !ncLineas.some(l => l.prodId && parseFloat(l.precio) > 0))}
                onClick={async () => {
                  if (!ncForm.cli) { alert("Select a client"); return; }
                  setNcSaving(true);
                  try {
                    if (ncTipo === "amount") {
                      const m = parseFloat(ncForm.monto);
                      if (!m || m <= 0) { alert("Enter a valid amount"); return; }
                      await addNotaCredito({ cli: ncForm.cli, fecha: ncForm.fecha, monto: m, motivo: ncForm.motivo, tipo: "amount" });
                    } else {
                      const validLines = ncLineas.filter(l => l.prodId && parseFloat(l.precio) > 0);
                      if (!validLines.length) { alert("Add at least one product with a price"); return; }
                      const lineasNC: LineaNC[] = validLines.map(l => {
                        const p = productos.find(pr => pr.id === l.prodId)!;
                        return { prodNom: p.nom, sku: p.sku, qty: l.qty, precio: parseFloat(l.precio) };
                      });
                      const total = lineasNC.reduce((s, l) => s + l.precio * l.qty, 0);
                      await addNotaCredito({ cli: ncForm.cli, fecha: ncForm.fecha, monto: total, motivo: ncForm.motivo, tipo: "product", lineas: lineasNC });
                    }
                    setShowNcForm(false);
                  } catch (err) { alert(`Error: ${err instanceof Error ? err.message : String(err)}`); }
                  finally { setNcSaving(false); }
                }}
                className={`w-full mt-2 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
              >
                {ncSaving ? "Saving..." : "Create Credit Note"}
              </button>
            </Modal>
          )}
        </div>
      ) : subTab === "remitos" ? (
        <div>
          {(() => {
            const sent = [...remitos].filter(r => r.enviado).sort((a, b) => b.num - a.num);
            return sent.length ? (
              <div className="bg-card border border-border rounded-3xl overflow-hidden mb-3">
                {sent.map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => router.push(`/remitos/${r.id}`)}
                    className={`w-full grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 text-left ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <div className="shrink-0">
                      <div className="text-xs font-mono font-semibold text-[#a3814e] whitespace-nowrap">R #{String(r.num).padStart(4, "0")}</div>
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap">{fdate(r.fecha)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-card-foreground truncate tracking-tight">{r.cli}</div>
                      <div className="text-[11px] text-muted-foreground truncate">Order #{r.orden_num}</div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <Badge e="Delivered" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-card rounded-3xl p-3.5 border border-border mb-3"><p className="text-sm text-muted-foreground text-center">No sent remitos yet.</p></div>
            );
          })()}
        </div>
      ) : (
      <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search invoices..."
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
          />
          {q && <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button>}
        </div>
        <button
          onClick={() => router.push("/reportes/facturas-pendientes")}
          title="Aging report"
          className="shrink-0 w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center text-[#4a6741]"
        >
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3v18h18" />
            <path d="M18.7 8l-5.1 5.2-3-3L7 14" />
          </svg>
        </button>
      </div>
      {!readOnly && <AddPillButton className={ADD_PILL_POS} aria-label="New invoice" onClick={() => setShow(true)} />}
      {filtered.length ? (
        <div className="bg-card border border-border rounded-3xl overflow-hidden">
          {visibleFacturas.map((f, i) => (
            <div
              key={f.id}
              onClick={() => router.push(`/facturas/${f.id}`)}
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/30 ${i > 0 ? "border-t border-border" : ""}`}
            >
              {/* Columna 1: numero de factura sobre la fecha */}
              <div className="shrink-0">
                <div className="text-xs font-mono font-semibold text-[#a3814e] whitespace-nowrap">#{String(f.num).padStart(4, "0")}</div>
                <div className="text-[11px] text-muted-foreground whitespace-nowrap">{fdate(f.fecha)}</div>
              </div>
              {/* Columna 2: codigo de cliente sobre el nombre */}
              <div className="min-w-0">
                <div className="text-[11px] font-mono text-muted-foreground">{clienteCodigo(f.cli) !== "—" ? clienteCodigo(f.cli) : ""}</div>
                <div className="text-sm font-semibold text-card-foreground truncate tracking-tight">{f.cli}</div>
              </div>
              {/* Columna 3: monto sobre el estado */}
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className="text-sm font-bold text-card-foreground tabular-nums">{fmt(f.total)}</span>
                <Badge e={f.estado} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card rounded-3xl p-3.5 border border-border">
          <Empty text="No invoices. Tap + to create one." />
        </div>
      )}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={loadMore} />

      {show && !readOnly && (
        <Modal title="New Invoice" onClose={() => setShow(false)}>
          <Field label="Client">
            <select
              value={clienteSeleccionado}
              onChange={(e) => setClienteSeleccionado(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select...</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.nom}>
                  {c.nom}
                </option>
              ))}
            </select>
          </Field>
          <Row2>
            <Field label="Delivery date">
              {proximasFechasEntrega.length ? (
                <select
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select...</option>
                  {proximasFechasEntrega.map((f) => (
                    <option key={f} value={f}>
                      {fdate(f)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No delivery days marked — add one from the Calendar.
                </p>
              )}
            </Field>
            <Field label="Status">
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              >
                <option>Pending</option>
                <option>Paid</option>
                <option>In Review</option>
              </select>
            </Field>
          </Row2>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-muted-foreground">Products</div>
            <div className="flex gap-1">
              {(["all", "palmhills", "castillo"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => { setInvAlmacen(a); setInvSearches(lineas.map(() => "")); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${invAlmacen === a ? "bg-primary text-primary-foreground border-primary" : "bg-card text-card-foreground border-border"}`}
                >
                  {a === "all" ? "All" : a === "palmhills" ? "Palm Hills" : "Castillo"}
                </button>
              ))}
            </div>
          </div>
          {lineas.map((l, i) => {
            const selectedProd = productos.find((p) => p.id === l.prodId);
            const srch = invSearches[i] ?? "";
            const sugeridos = getInvSugeridos(srch);
            const isFocused = invFocus === i;
            return (
              <div key={i} className="mb-2 bg-muted rounded-lg p-2">
                <div className="flex gap-1.5 items-center">
                  <div className="flex-[2] relative">
                    {selectedProd ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-primary bg-card text-card-foreground text-sm">
                        <span className="flex-1 truncate">
                          {selectedProd.sku ? `${selectedProd.sku} — ` : ""}{selectedProd.nom}
                        </span>
                        <button
                          onClick={() => {
                            setLineas((ls) => ls.map((x, j) => j === i ? { ...x, prodId: "" } : x));
                            setInvSearches((ss) => ss.map((s, j) => j === i ? "" : s));
                          }}
                          className="text-muted-foreground text-xs ml-1"
                        >
                          X
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search product..."
                            value={srch}
                            onChange={(e) => setInvSearches((ss) => ss.map((s, j) => j === i ? e.target.value : s))}
                            onFocus={() => setInvFocus(i)}
                            onBlur={() => setTimeout(() => setInvFocus(null), 200)}
                            className="w-full px-2.5 py-2 pr-7 rounded-lg border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
                          />
                          {srch && <button onMouseDown={(e) => { e.preventDefault(); setInvSearches((ss) => ss.map((s, j) => j === i ? "" : s)); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-lg leading-none">×</button>}
                        </div>
                        {isFocused && sugeridos.length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                            {sugeridos.map((p) => (
                              <button
                                key={p.id}
                                onMouseDown={() => {
                                  setLineas((ls) => ls.map((x, j) => j === i ? { ...x, prodId: p.id } : x));
                                  setInvSearches((ss) => ss.map((s, j) => j === i ? "" : s));
                                  setInvFocus(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b border-border last:border-0 text-card-foreground"
                              >
                                <span className="font-medium uppercase">{p.sku ? `${p.sku} — ` : ""}{p.nom}</span>
                                <span className={listaCliente?.precios?.[p.id] !== undefined ? "text-[#b09060] font-semibold ml-1" : "text-muted-foreground ml-1"}>{fmt(precioCliente(p))}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={l.qty}
                    onChange={(e) =>
                      setLineas((ls) =>
                        ls.map((x, j) =>
                          j === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x
                        )
                      )
                    }
                    autoComplete="off"
                    className="w-14 px-1.5 py-2 rounded-lg border border-input bg-card text-card-foreground text-sm text-center outline-none"
                  />
                  <button
                    onClick={() => {
                      setLineas((ls) => ls.filter((_, j) => j !== i));
                      setInvSearches((ss) => ss.filter((_, j) => j !== i));
                    }}
                    className="bg-transparent border-none text-lg cursor-pointer text-muted-foreground"
                  >
                    X
                  </button>
                </div>
              </div>
            );
          })}
          <button
            onClick={() => {
              setLineas((l) => [...l, { prodId: "", qty: 1 }]);
              setInvSearches((ss) => [...ss, ""]);
            }}
            className="w-full px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm mb-3"
          >
            + Add product
          </button>
          <div className="border-t border-border pt-2.5 text-right mb-3">
            <strong className="text-lg text-card-foreground">Total: {fmt(total)}</strong>
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={() => setShow(false)}
              className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
            >
              {saving ? "Saving..." : "Save Invoice"}
            </button>
          </div>
        </Modal>
      )}
      </div>
      )}
    </div>
  );
};

// ------------------------------
// Clientes
const Clientes = () => {
  const router = useRouter();
  const { clientes, addCliente, addClientesBulk, deleteCliente, updateCliente, facturas, notasCredito, vendedores, readOnly } = useData();
  const [showVendedores, setShowVendedores] = useState(false);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"codigo_cliente" | "nom">("codigo_cliente");
  const [cliColumnas, setCliColumnas] = useState<1 | 3>(1);
  const [showTopClientes, setShowTopClientes] = useState(false);
  const [show, setShow] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [fotoLocal, setFotoLocal] = useState("");
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropImage, setCropImage] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [bulkRows, setBulkRows] = useState<ClienteBulkRow[]>([]);
  const [bulkErr, setBulkErr] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [form, setForm] = useState({
    nom: "",
    codigo_cliente: "",
    tel: "",
    email: "",
    dir: "",
    ciudad: "",
    estado_dir: "",
    contacto: "",
    estado: "Active",
    abierto_sabados: false,
    foto_local: "",
    telefonos: [] as TelefonoContacto[],
    fax: "",
    vendedor_id: "" as string,
  });

  // Siguiente numero de cliente DENTRO del prefijo de un vendedor especifico
  // (cada vendedor numera sus clientes por separado, ej. 02-0001 aunque el
  // vendedor 01 ya tenga cientos de clientes).
  const nextCodigoClienteFor = (prefijo: string) => {
    let maxNum = 0;
    let width = 4;
    clientes.forEach((c) => {
      const m = (c.codigo_cliente || "").match(/^(\d+)-(\d+)$/);
      if (m && m[1] === prefijo) {
        const num = parseInt(m[2], 10);
        if (num > maxNum) { maxNum = num; width = m[2].length; }
      }
    });
    return `${prefijo}-${String(maxNum + 1).padStart(width, "0")}`;
  };

  const balanceCliente = (nom: string) => {
    const deuda = facturas
      .filter(f => f.cli === nom && !["Paid", "Completed", "Cancelled"].includes(f.estado))
      .reduce((acc, f) => {
        const pagado = (f.pagos || []).reduce((s, p) => s + p.monto, 0);
        return acc + Math.max(0, f.total - pagado);
      }, 0);
    const credito = notasCredito
      .filter(nc => nc.cli === nom && !nc.aplicada)
      .reduce((acc, nc) => acc + nc.monto, 0);
    return deuda - credito;
  };

  const filtered = useMemo(() => {
    const nq = normTag(q);
    const base = nq
      ? clientes.filter((c) =>
          normTag(
            `${c.nom} ${c.codigo_cliente || ""} ${c.dir || ""} ${c.ciudad || ""} ${c.estado_dir || ""}`
          ).includes(nq)
        )
      : clientes;
    const sorted = [...base];
    if (sortBy === "codigo_cliente") {
      sorted.sort((a, b) =>
        (a.codigo_cliente || "").localeCompare(b.codigo_cliente || "", "en", { numeric: true })
      );
    } else {
      sorted.sort((a, b) => a.nom.localeCompare(b.nom, "en"));
    }
    return sorted;
  }, [clientes, q, sortBy]);

  const { visible: visibleClientes, hasMore, remaining, loadMore } = usePagedList(filtered, [q, sortBy]);

  const handleFotoUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setCropImage(e.target?.result as string);
      setShowCropModal(true);
      setZoom(1);
    };
    reader.readAsDataURL(file);
  };

  const handleCropComplete = (_: unknown, pixels: { x: number; y: number; width: number; height: number }) => {
    setCroppedAreaPixels(pixels);
  };

  const processCroppedImage = async () => {
    if (!cropImage) {
      alert("Please upload an image first");
      return;
    }

    try {
      // Convertir data URL a Blob sin usar fetch
      const byteString = atob(cropImage.split(",")[1]);
      const mimeType = cropImage.split(",")[0].split(":")[1].split(";")[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: mimeType });

      const bitmap = await createImageBitmap(blob);

      const sx = croppedAreaPixels?.x ?? 0;
      const sy = croppedAreaPixels?.y ?? 0;
      const sw = croppedAreaPixels?.width && croppedAreaPixels.width > 0 ? croppedAreaPixels.width : bitmap.width;
      const sh = croppedAreaPixels?.height && croppedAreaPixels.height > 0 ? croppedAreaPixels.height : bitmap.height;

      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 1024, 512);
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, 1024, 512);
      bitmap.close();

      let optimized = canvas.toDataURL("image/jpeg", 0.7);
      if (optimized.length > 500000) {
        const small = document.createElement("canvas");
        small.width = 800; small.height = 400;
        small.getContext("2d")?.drawImage(canvas, 0, 0, 800, 400);
        optimized = small.toDataURL("image/jpeg", 0.6);
      }

      setFotoLocal(optimized);
      setForm({ ...form, foto_local: optimized });
      setShowCropModal(false);
      setCropImage("");
    } catch (err) {
      console.error("[v0] Error:", err);
      alert("Error processing image. Please try again.");
    }
  };

  const reset = () => {
    setForm({ nom: "", codigo_cliente: "", tel: "", email: "", dir: "", ciudad: "", estado_dir: "", contacto: "", estado: "Active", abierto_sabados: false, foto_local: "", telefonos: [], fax: "", vendedor_id: "" });
    setFotoLocal("");
    setEditId(null);
    setShowCropModal(false);
    setCropImage("");
  };

  // Cerrar dropdown al tocar fuera
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAddMenu]);

  // Al cambiar el vendedor de un cliente NUEVO (nunca uno existente, para no
  // renumerar su codigo ya asignado), el numero de cliente se recalcula con
  // el prefijo del vendedor seleccionado.
  useEffect(() => {
    if (editId || !show) return;
    const v = vendedores.find((x) => x.id === form.vendedor_id);
    setForm((f) => ({ ...f, codigo_cliente: nextCodigoClienteFor(v?.prefijo || "01") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendedor_id]);

  const openEdit = (c: Cliente) => {
    setEditId(c.id);
    setForm({
      nom: c.nom,
      codigo_cliente: c.codigo_cliente || "",
      tel: c.tel || "",
      email: c.email || "",
      dir: c.dir || "",
      ciudad: c.ciudad || "",
      estado_dir: c.estado_dir || "",
      contacto: c.contacto || "",
      estado: c.estado,
      abierto_sabados: c.abierto_sabados || false,
      foto_local: c.foto_local || "",
      telefonos: c.telefonos || [],
      fax: c.fax || "",
      vendedor_id: c.vendedor_id || "",
    });
    setFotoLocal(c.foto_local || "");
    setShow(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) {
      alert("Enter the name");
      return;
    }
    if (!form.codigo_cliente.trim()) {
      alert("Enter the client number");
      return;
    }
    try {
      const payload = { ...form, vendedor_id: form.vendedor_id || null };
      if (editId) {
        await updateCliente(editId, payload);
      } else {
        await addCliente(payload);
      }
      reset();
      setShow(false);
    } catch (err) {
      alert(`Could not save the client: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div>
      {/* Header: buscador + botón + dropdown */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients..."
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
          />
          {q && <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button>}
        </div>
        {!readOnly && (
          <div className="relative shrink-0" ref={addMenuRef}>
            <button
              onClick={() => setShowAddMenu((v) => !v)}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-light"
              aria-label="Add client"
            >
              +
            </button>
            {showAddMenu && (
              <div className="absolute right-0 top-12 z-20 bg-card border border-border rounded-3xl shadow-lg overflow-hidden min-w-[180px]"
                onBlur={() => setShowAddMenu(false)}
              >
                <button
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-card-foreground hover:bg-muted text-left"
                  onClick={() => {
                    setShowAddMenu(false);
                    reset();
                    const defaultVendedor = vendedores.find((v) => v.activo) || null;
                    setForm((f) => ({
                      ...f,
                      vendedor_id: defaultVendedor?.id || "",
                      codigo_cliente: nextCodigoClienteFor(defaultVendedor?.prefijo || "01"),
                    }));
                    setShow(true);
                  }}
                >
                  <span className="text-base">+</span>
                  Add manually
                </button>
                <div className="h-px bg-border mx-3" />
                <button
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-card-foreground hover:bg-muted text-left"
                  onClick={() => { setShowAddMenu(false); setBulkRows([]); setBulkErr(""); setShowBulk(true); }}
                >
                  <span className="text-base">↑</span>
                  Bulk Upload
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mb-3">
        <label htmlFor="sortByCliente" className="text-xs text-muted-foreground shrink-0">
          Sort by
        </label>
        <select
          id="sortByCliente"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "codigo_cliente" | "nom")}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="nom">Name A-Z</option>
          <option value="codigo_cliente">Client Number A-Z</option>
        </select>
        <div className="inline-flex backdrop-blur-md bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5 shrink-0">
          <button
            onClick={() => setCliColumnas(1)}
            aria-label="1 column"
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all ${cliColumnas === 1 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            ▤ 1
          </button>
          <button
            onClick={() => setCliColumnas(3)}
            aria-label="3 columns"
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all ${cliColumnas === 3 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            ▦ 3
          </button>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{filtered.length} cli.</span>
      </div>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setShowTopClientes(true)}
          className="flex-1 py-2.5 rounded-xl border border-border bg-card text-sm font-bold text-primary flex items-center justify-center gap-1.5"
        >
          ⭐ Top 10 Clients
        </button>
        <button
          onClick={() => setShowVendedores(true)}
          className="flex-1 py-2.5 rounded-xl border border-border bg-card text-sm font-bold text-primary flex items-center justify-center gap-1.5"
        >
          🧑‍💼 Salespeople
        </button>
      </div>
      {showVendedores && <VendedoresModal onClose={() => setShowVendedores(false)} />}
      {showTopClientes && (
        <Modal title="Top 10 Clients" onClose={() => setShowTopClientes(false)}>
          <div className="text-[11px] text-muted-foreground mb-2 -mt-1">
            Last 6 months · 60% volume + 40% payment — COD is best, under 30 days is good, over 30 days hurts the score
          </div>
          <div className="border border-border rounded-3xl overflow-hidden -mx-1">
            <TopClientesLista facturas={facturas} />
          </div>
        </Modal>
      )}
      {filtered.length ? (
        cliColumnas === 3 ? (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {visibleClientes.map((c) => (
              <div
                key={c.id}
                onClick={() => router.push(`/clientes/${c.id}`)}
                className="bg-card border border-border rounded-3xl overflow-hidden cursor-pointer hover:border-primary transition-colors"
              >
                <div className="w-full aspect-square bg-gradient-to-b from-secondary to-secondary-foreground flex items-center justify-center overflow-hidden">
                  {c.foto_local ? (
                    <img src={c.foto_local} alt={c.nom} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-3xl">🏪</div>
                  )}
                </div>
                <div className="p-2">
                  <div className="text-[11px] font-bold uppercase text-card-foreground truncate leading-tight">{c.nom}</div>
                  {c.codigo_cliente && (
                    <div className="text-[10px] font-mono text-muted-foreground">#{c.codigo_cliente}</div>
                  )}
                  <Badge e={c.estado} />
                  {(() => { const b = balanceCliente(c.nom); return b > 0 ? <div className="text-[10px] font-bold text-amber-700 mt-0.5">{fmt(b)}</div> : null; })()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            {visibleClientes.map((c) => (
              <div key={c.id} className="bg-card rounded-3xl border border-border overflow-hidden">
                {/* Banner - clickeable */}
                <div
                  onClick={() => router.push(`/clientes/${c.id}`)}
                  className="w-full h-32 bg-gradient-to-r from-secondary to-secondary-foreground flex items-center justify-center relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                >
                  {c.foto_local ? (
                    <img src={c.foto_local} alt={c.nom} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-4xl">🏪</div>
                  )}
                </div>
                {/* Content */}
                <div className="p-3.5">
                  <div
                    onClick={() => router.push(`/clientes/${c.id}`)}
                    className="flex items-start justify-between gap-2.5 mb-2 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold uppercase tracking-wide text-card-foreground">{c.nom}</div>
                      {c.codigo_cliente && (
                        <div className="text-xs font-mono text-muted-foreground">#{c.codigo_cliente}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {c.email || c.tel || "No contact"}
                      </div>
                    </div>
                    <Badge e={c.estado} />
                  </div>
                  {(c.dir || c.ciudad) && (
                    <div className="text-xs text-muted-foreground mb-1">
                      📍 {[c.dir, c.ciudad, c.estado_dir].filter(Boolean).join(", ")}
                    </div>
                  )}
                  {c.contacto && (
                    <div className="text-xs text-muted-foreground mb-2.5">👤 {c.contacto}</div>
                  )}
                  {c.abierto_sabados && (
                    <div className="inline-block text-xs font-medium text-primary bg-secondary px-2 py-0.5 rounded-full mb-2.5">
                      Open on Saturdays
                    </div>
                  )}
                  {(() => {
                    const bal = balanceCliente(c.nom);
                    return bal !== 0 ? (
                      <div className={`flex items-center justify-between px-3 py-2 rounded-xl mb-2.5 ${bal > 0 ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200"}`}>
                        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Pending Balance</span>
                        <span className={`text-sm font-bold ${bal > 0 ? "text-amber-700" : "text-green-700"}`}>{bal < 0 ? "-" : ""}{fmt(Math.abs(bal))}</span>
                      </div>
                    ) : null;
                  })()}
                  {!readOnly && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => openEdit(c)}
                        className="flex-1 px-2.5 py-1.5 rounded-full backdrop-blur-md bg-primary/85 border border-white/30 shadow-sm hover:bg-primary/95 active:scale-[0.97] transition-all text-primary-foreground text-xs font-bold"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Delete client?")) {
                            deleteCliente(c.id).catch((err) =>
                              alert(`Could not delete the client: ${err instanceof Error ? err.message : String(err)}`)
                            );
                          }
                        }}
                        className="flex-1 px-2.5 py-1.5 rounded-full backdrop-blur-md bg-red-50/80 border border-red-200/60 shadow-sm hover:bg-red-100/80 active:scale-[0.97] transition-all text-destructive text-xs font-bold"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="bg-card rounded-3xl p-3.5 border border-border">
          <Empty text="No clients. Tap + to add one." />
        </div>
      )}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={loadMore} />

      {show && (
        <Modal title={editId ? "Edit Client" : "New Client"} onClose={() => { reset(); setShow(false); }}>
          <Field label="Store photo">
            <div
              onClick={() => document.getElementById("fotoClienteInput")?.click()}
              className="w-full h-24 rounded-xl border-2 border-dashed border-border flex items-center justify-center cursor-pointer bg-white mb-1"
            >
              {fotoLocal ? (
                <img
                  src={fotoLocal}
                  alt="Preview"
                  className="w-full h-full object-cover rounded-lg"
                  onError={() => {
                    console.log("[v0] Photo failed to load - may be corrupted or too large");
                    // Don't clear it, just leave it as is and let user replace it
                  }}
                />
              ) : (
                <div className="text-center">
                  <div className="text-2xl">📸</div>
                  <div className="text-xs text-muted-foreground mt-1">Tap to add photo</div>
                </div>
              )}
            </div>
            <input
              id="fotoClienteInput"
              type="file"
              accept="image/*"
              onChange={(e) => handleFotoUpload(e.target.files?.[0])}
              className="hidden"
            />
          </Field>
          <Field label="Name *">
            <input
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          {!editId && vendedores.length > 0 && (
            <Field label="Salesperson">
              <select
                value={form.vendedor_id}
                onChange={(e) => setForm({ ...form, vendedor_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              >
                {vendedores.filter((v) => v.activo).map((v) => (
                  <option key={v.id} value={v.id}>{v.nombre} ({v.prefijo})</option>
                ))}
              </select>
            </Field>
          )}
          <Row2>
            <Field label="Client Number *">
              <input
                value={form.codigo_cliente}
                onChange={(e) => setForm({ ...form, codigo_cliente: e.target.value })}
                readOnly={!editId}
                placeholder="E.g. 01-0001"
                autoComplete="off"
                className={`w-full px-3 py-2.5 rounded-xl border border-input text-base font-mono outline-none focus:ring-2 focus:ring-ring ${
                  !editId ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-card text-card-foreground"
                }`}
              />
              {!editId && (
                <p className="text-[11px] text-muted-foreground mt-1">Assigned automatically</p>
              )}
            </Field>
            <Field label="Phone">
              <input
                value={form.tel}
                onChange={(e) => setForm({ ...form, tel: formatPhone(e.target.value) })}
                placeholder="(xxx) xxx-xxxx"
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          {/* Additional phone numbers */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Contact Numbers</div>
            {(form.telefonos || []).map((t, i) => (
              <div key={i} className="flex flex-col gap-1.5 mb-2.5 p-2.5 rounded-xl border border-border bg-background">
                <div className="flex gap-1.5 items-center">
                  <select
                    value={t.rol}
                    onChange={(e) => setForm({ ...form, telefonos: (form.telefonos || []).map((x, j) => j === i ? { ...x, rol: e.target.value } : x) })}
                    className="px-2 py-2 rounded-lg border border-input bg-card text-card-foreground text-xs outline-none focus:ring-2 focus:ring-ring shrink-0"
                  >
                    <option>Store</option>
                    <option>Manager</option>
                    <option>Owner</option>
                    <option>Payments</option>
                    <option>Places orders</option>
                  </select>
                  <input
                    value={t.num}
                    onChange={(e) => setForm({ ...form, telefonos: (form.telefonos || []).map((x, j) => j === i ? { ...x, num: formatPhone(e.target.value) } : x) })}
                    placeholder="(xxx) xxx-xxxx"
                    autoComplete="off"
                    className="flex-1 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, telefonos: (form.telefonos || []).filter((_, j) => j !== i) })}
                    className="text-muted-foreground text-lg px-1 leading-none hover:text-card-foreground"
                  >
                    ×
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={t.nombre || ""}
                    onChange={(e) => setForm({ ...form, telefonos: (form.telefonos || []).map((x, j) => j === i ? { ...x, nombre: e.target.value } : x) })}
                    placeholder="Name (Pete, Rafael…)"
                    autoComplete="off"
                    className="flex-1 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <input
                    value={t.establecimiento || ""}
                    onChange={(e) => setForm({ ...form, telefonos: (form.telefonos || []).map((x, j) => j === i ? { ...x, establecimiento: e.target.value } : x) })}
                    placeholder="Establishment / location"
                    autoComplete="off"
                    className="flex-1 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setForm({ ...form, telefonos: [...(form.telefonos || []), { rol: "Manager", num: "" }] })}
              className="text-xs text-primary font-semibold mt-0.5"
            >
              + Add contact number
            </button>
          </div>
          <Field label="Fax">
            <input
              value={form.fax || ""}
              onChange={(e) => setForm({ ...form, fax: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Email">
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Address">
            <input
              value={form.dir}
              onChange={(e) => setForm({ ...form, dir: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Row2>
            <Field label="City">
              <input
                value={form.ciudad}
                onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="State">
              <input
                value={form.estado_dir}
                onChange={(e) => setForm({ ...form, estado_dir: e.target.value })}
                placeholder="E.g. New York"
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          <Field label="Contact">
            <input
              value={form.contacto}
              onChange={(e) => setForm({ ...form, contacto: e.target.value })}
              placeholder="Contact person's name"
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Client Status">
            <select
              value={form.estado}
              onChange={(e) => setForm({ ...form, estado: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            >
              <option>Active</option>
              <option>Inactive</option>
              <option>Waiting</option>
            </select>
          </Field>
          <div className="mt-1 p-3 bg-muted rounded-xl flex items-center justify-between">
            <span className="text-sm font-medium text-card-foreground">Open on Saturdays</span>
            <button
              type="button"
              onClick={() => setForm({ ...form, abierto_sabados: !form.abierto_sabados })}
              className={`relative w-12 h-7 rounded-full transition-all ${
                form.abierto_sabados ? "bg-primary" : "bg-gray-300"
              }`}
            >
              <div
                className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${
                  form.abierto_sabados ? "right-1" : "left-1"
                }`}
              />
            </button>
          </div>
          <div className="flex gap-2.5 mt-3.5">
            <button
              onClick={() => { reset(); setShow(false); }}
              className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY}`}
            >
              {editId ? "Save Changes" : "Save Client"}
            </button>
          </div>
        </Modal>
      )}
      {showCropModal && cropImage && (
        <Modal onClose={() => setShowCropModal(false)}>
          <div className="p-4 bg-card rounded-xl max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Adjust your photo</h2>
            <div style={{ position: "relative", width: "100%", height: "300px" }} className="mb-4 rounded-lg overflow-hidden bg-black">
              <Cropper
                image={cropImage}
                crop={crop}
                zoom={zoom}
                aspect={1024 / 512}
                onCropChange={setCrop}
                onCropComplete={handleCropComplete}
                onZoomChange={setZoom}
                objectFit="contain"
              />
            </div>
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Zoom: {(zoom * 100).toFixed(0)}%</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowCropModal(false)}
                className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
              >
                Cancel
              </button>
              <button
                onClick={processCroppedImage}
                className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY}`}
              >
                Save photo
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Subir Clientes A Granel */}
      {showBulk && (
        <Modal title="Bulk Upload Clients" onClose={() => setShowBulk(false)}>
          <div className="text-sm text-muted-foreground mb-3 leading-relaxed">
            Upload an Excel file (.xlsx) with these columns:{" "}
            <span className="font-medium text-card-foreground">
              Client Number, Name, Address, City, State, Contact, Phone, Email, Open Saturdays
            </span>. (State = the address state/province, e.g. "NY").
          </div>
          <button
            onClick={async () => {
              const XLSX = await import("xlsx");
              const ws = XLSX.utils.aoa_to_sheet([
                ["Client Number", "Name", "Address", "City", "State", "Contact", "Phone", "Email", "Open Saturdays"],
                ["CLI-0001", "Hamilton Meat Market", "123 St Nicholas Ave", "New York", "NY", "Hamilton Diaz", "2125550199", "hamilton@example.com", "Yes"],
              ]);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "Clients");
              XLSX.writeFile(wb, "clients_template.xlsx");
            }}
            className="w-full px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium text-sm mb-3"
          >
            Download sample template
          </button>
          <div
            onClick={() => document.getElementById("clienteExcelInput")?.click()}
            className="w-full h-28 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer bg-muted mb-3"
          >
            <div className="text-2xl">📊</div>
            <div className="text-sm text-muted-foreground mt-1">Tap to select Excel file</div>
          </div>
          <input
            id="clienteExcelInput"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBulkErr("");
              try {
                const XLSX = await import("xlsx");
                const buf = await file.arrayBuffer();
                const wb = XLSX.read(buf, { type: "array" });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
                if (!json.length) { setBulkErr("The file is empty."); return; }
                const normH = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                const headers = Object.keys(json[0]);
                const find = (aliases: string[]) => headers.find(h => aliases.includes(normH(h))) ?? null;
                const kNom = find(["nombre", "nom", "name", "cliente", "client", "razon"]);
                if (!kNom) { setBulkErr("Couldn't find the 'Name' column. Check the headers or download the template."); return; }
                const kCod = find(["numerodecliente", "numerocliente", "codigodecliente", "codigocliente", "codigo", "numero", "rfc", "clientnumber", "clientno", "number"]);
                if (!kCod) { setBulkErr("Couldn't find the 'Client Number' column. Check the headers or download the template."); return; }
                const kTel = find(["telefono", "tel", "phone"]);
                const kEmail = find(["email", "correo"]);
                const kDir = find(["direccion", "dir", "address"]);
                const kCiudad = find(["ciudad", "city"]);
                const kEstDir = find(["estado", "state", "provincia"]);
                const kContacto = find(["contacto", "persona", "personadecontacto", "contact"]);
                const kSab = find(["abiertosabados", "abiertolossabados", "sabados", "sabado", "opensaturdays", "saturdays"]);
                const rows: ClienteBulkRow[] = json.map((r) => {
                  const nom = String(kNom ? r[kNom] : "").trim();
                  const codigo_cliente = String(kCod ? r[kCod] : "").trim();
                  const sabVal = normH(String(kSab ? r[kSab] : ""));
                  let err: string | undefined;
                  if (!nom) err = "Missing name";
                  else if (!codigo_cliente) err = "Missing client number";
                  return {
                    nom,
                    codigo_cliente,
                    tel: String(kTel ? r[kTel] : "").trim(),
                    email: String(kEmail ? r[kEmail] : "").trim(),
                    dir: String(kDir ? r[kDir] : "").trim(),
                    ciudad: String(kCiudad ? r[kCiudad] : "").trim(),
                    estado_dir: String(kEstDir ? r[kEstDir] : "").trim(),
                    contacto: String(kContacto ? r[kContacto] : "").trim(),
                    estado: "Active",
                    abierto_sabados: ["si", "s", "yes", "y", "true", "1", "x"].includes(sabVal),
                    foto_local: "",
                    _error: err,
                  };
                });
                setBulkRows(rows);
              } catch {
                setBulkErr("Couldn't read the file. Make sure it's a valid Excel file (.xlsx).");
              }
            }}
          />
          {bulkErr && (
            <div className="text-sm text-destructive mb-3 bg-red-50 rounded-lg px-3 py-2">{bulkErr}</div>
          )}
          {bulkRows.length > 0 && (
            <>
              <div className="text-sm font-semibold text-card-foreground mb-2">
                Preview ({bulkRows.filter(r => !r._error).length} of {bulkRows.length} valid)
              </div>
              <div className="max-h-60 overflow-auto rounded-xl border border-border mb-3">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Name</th>
                      <th className="px-2 py-1.5 font-medium">Client No.</th>
                      <th className="px-2 py-1.5 font-medium">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((r, i) => (
                      <tr key={i} className={`border-t border-border ${r._error ? "bg-red-50" : "bg-green-50"}`}>
                        <td className="px-2 py-1.5">
                          {r._error ? <span className="text-destructive">✕</span> : <span className="text-green-600">✓</span>}
                        </td>
                        <td className="px-2 py-1.5 text-card-foreground max-w-[120px] truncate">
                          {r.nom || <span className="text-destructive italic">No name</span>}
                          {r._error && <div className="text-xs text-destructive">{r._error}</div>}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono">{r.codigo_cliente || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.tel || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                disabled={bulkSaving || !bulkRows.some(r => !r._error)}
                onClick={async () => {
                  const valid = bulkRows.filter(r => !r._error);
                  setBulkSaving(true);
                  try {
                    const n = await addClientesBulk(valid.map(({ _error, ...rest }) => rest));
                    alert(`${n} clients imported successfully.`);
                    setShowBulk(false);
                    setBulkRows([]);
                  } catch (err) {
                    setBulkErr(`Error saving: ${err instanceof Error ? err.message : "Unknown error"}`);
                  } finally {
                    setBulkSaving(false);
                  }
                }}
                className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50"
              >
                {bulkSaving ? "Importing..." : `Import ${bulkRows.filter(r => !r._error).length} clients`}
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
};

// ------------------------------
// Listas de precios por cliente
// ------------------------------
const ListasPreciosModal = ({ onClose }: { onClose: () => void }) => {
  const { listasPrecios, addListaPrecio, updateListaPrecio, deleteListaPrecio, asignarListaAClientes, clientes, productos, readOnly } = useData();
  const [selId, setSelId] = useState<string | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [seccion, setSeccion] = useState<"productos" | "clientes">("productos");
  const [prodSearch, setProdSearch] = useState("");
  const [cliSearch, setCliSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const lista = listasPrecios.find((l) => l.id === selId) || null;
  const clientesAsignados = (id: string) => clientes.filter((c) => c.lista_precio_id === id);

  const crearLista = async () => {
    const nombre = nuevoNombre.trim();
    if (!nombre || saving) return;
    setSaving(true);
    try {
      const l = await addListaPrecio({ nombre, precios: {} });
      setNuevoNombre("");
      setSelId(l.id);
      setSeccion("productos");
    } catch (err) {
      alert("Error creating list: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Guarda el precio especial de un producto en la lista (vacio o 0 = quitarlo)
  const setPrecioLista = async (prodId: string, valor: string) => {
    if (!lista) return;
    const num = Number(String(valor).replace(",", "."));
    const precios = { ...lista.precios };
    const actual = precios[prodId];
    const nuevo = !valor.trim() || !num || num <= 0 ? undefined : Math.round(num * 100) / 100;
    if (nuevo === actual) return;
    if (nuevo === undefined) delete precios[prodId];
    else precios[prodId] = nuevo;
    try {
      await updateListaPrecio(lista.id, { nombre: lista.nombre, precios });
    } catch (err) {
      alert("Error saving price: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const borrarLista = async () => {
    if (!lista) return;
    const n = clientesAsignados(lista.id).length;
    if (!confirm(`Delete list "${lista.nombre}"?${n ? ` ${n} client(s) will go back to base prices.` : ""}`)) return;
    try {
      await deleteListaPrecio(lista.id);
      setSelId(null);
    } catch (err) {
      alert("Error deleting list: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const toggleCliente = async (c: Cliente) => {
    if (!lista) return;
    try {
      await asignarListaAClientes(c.lista_precio_id === lista.id ? null : lista.id, [c.id]);
    } catch (err) {
      alert("Error assigning list: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Productos: los que ya tienen precio especial primero; busqueda flexible
  const prodResultadosTodos = useMemo(() => {
    if (!lista) return [];
    return prodSearch.trim()
      ? flexibleSearch(productos, prodSearch, (p) => [p.nom, p.sku, p.barcode, p.fabricante].filter(Boolean).join(" "), (p) => p.nom)
      : [...productos].sort((a, b) => {
          const aIn = lista.precios[a.id] !== undefined ? 0 : 1;
          const bIn = lista.precios[b.id] !== undefined ? 0 : 1;
          if (aIn !== bIn) return aIn - bIn;
          return (a.sku || "").localeCompare(b.sku || "", "en", { numeric: true }) || a.nom.localeCompare(b.nom, "en");
        });
  }, [lista, prodSearch, productos]);
  const { visible: prodResultados, hasMore: prodHasMore, remaining: prodRemaining, loadMore: prodLoadMore } = usePagedList(
    prodResultadosTodos,
    [lista?.id, prodSearch]
  );

  // Clientes: los asignados a ESTA lista primero
  const cliResultadosTodos = useMemo(() => {
    return cliSearch.trim()
      ? clientes.filter((c) => normTag(`${c.nom} ${c.codigo_cliente || ""} ${c.ciudad || ""}`).includes(normTag(cliSearch)))
      : lista
        ? [...clientes].sort((a, b) => {
            const aIn = a.lista_precio_id === lista.id ? 0 : 1;
            const bIn = b.lista_precio_id === lista.id ? 0 : 1;
            if (aIn !== bIn) return aIn - bIn;
            return a.nom.localeCompare(b.nom, "en");
          })
        : clientes;
  }, [clientes, cliSearch, lista]);
  const { visible: cliResultados, hasMore: cliHasMore, remaining: cliRemaining, loadMore: cliLoadMore } = usePagedList(
    cliResultadosTodos,
    [lista?.id, cliSearch]
  );

  return (
    <Modal title={lista ? lista.nombre : "Price Lists"} onClose={onClose}>
      {!lista ? (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            Special prices per client. Assign a list to one or many clients; their orders and invoices use these prices automatically.
          </p>
          {listasPrecios.length > 0 && (
            <div className="border border-border rounded-3xl overflow-hidden mb-3">
              {listasPrecios.map((l) => (
                <button
                  key={l.id}
                  onClick={() => { setSelId(l.id); setSeccion("productos"); setProdSearch(""); setCliSearch(""); }}
                  className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border last:border-b-0 bg-card text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-card-foreground truncate">{l.nombre}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {Object.keys(l.precios).length} product{Object.keys(l.precios).length === 1 ? "" : "s"} · {clientesAsignados(l.id).length} client{clientesAsignados(l.id).length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span className="text-muted-foreground text-lg">›</span>
                </button>
              ))}
            </div>
          )}
          {listasPrecios.length === 0 && <Empty text="No price lists yet." />}
          {!readOnly && (
            <div className="flex gap-2 mt-2">
              <input
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") crearLista(); }}
                placeholder="New list name (e.g. Yonkers)…"
                autoComplete="off"
                className="flex-1 px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={crearLista}
                disabled={!nuevoNombre.trim() || saving}
                className={`shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
              >
                {saving ? "..." : "Create"}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => { setSelId(null); setProdSearch(""); setCliSearch(""); }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-card border border-border text-[13px] font-medium text-primary"
            >
              ‹ Lists
            </button>
            {!readOnly && (
              <button onClick={borrarLista} className="text-xs font-medium text-destructive underline">
                Delete list
              </button>
            )}
          </div>
          <div className="flex gap-1.5 p-1 bg-muted rounded-xl mb-3">
            {(["productos", "clientes"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeccion(s)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${seccion === s ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}
              >
                {s === "productos" ? `Prices (${Object.keys(lista.precios).length})` : `Clients (${clientesAsignados(lista.id).length})`}
              </button>
            ))}
          </div>

          {seccion === "productos" ? (
            <>
              <input
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                placeholder="Search product by name, SKU…"
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring mb-2"
              />
              <div className="border border-border rounded-3xl overflow-hidden">
                {prodResultados.map((p) => {
                  const especial = lista.precios[p.id];
                  return (
                    <div key={p.id} className="flex items-center gap-2 px-3 py-2.5 border-b border-border last:border-b-0 bg-card">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-card-foreground leading-tight break-words uppercase">{p.nom}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {p.sku ? `${p.sku} · ` : ""}base {fmt(p.precio)}
                        </div>
                      </div>
                      <input
                        key={`${p.id}-${especial ?? ""}`}
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        autoComplete="off"
                        disabled={readOnly}
                        defaultValue={especial !== undefined ? String(especial) : ""}
                        placeholder={String(p.precio)}
                        onBlur={(e) => setPrecioLista(p.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        className={`w-20 shrink-0 px-2 py-1.5 rounded-lg border text-sm text-center font-bold outline-none focus:ring-2 focus:ring-ring ${
                          especial !== undefined ? "border-[#e9dcc4] bg-[#f5eee2] text-[#a3814e]" : "border-input bg-background text-card-foreground"
                        }`}
                      />
                    </div>
                  );
                })}
                {prodResultados.length === 0 && (
                  <div className="px-3 py-3 text-xs text-muted-foreground">No products found</div>
                )}
              </div>
              <LoadMoreButton hasMore={prodHasMore} remaining={prodRemaining} onClick={prodLoadMore} />
              <p className="text-[11px] text-muted-foreground mt-2">
                Leave a price empty to use the base price. Prices in gold are on this list.
              </p>
            </>
          ) : (
            <>
              <input
                value={cliSearch}
                onChange={(e) => setCliSearch(e.target.value)}
                placeholder="Search client by name, code, city…"
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring mb-2"
              />
              <div className="border border-border rounded-3xl overflow-hidden">
                {cliResultados.map((c) => {
                  const enEsta = c.lista_precio_id === lista.id;
                  const otraLista = !enEsta && c.lista_precio_id ? listasPrecios.find((l) => l.id === c.lista_precio_id) : null;
                  return (
                    <button
                      key={c.id}
                      onClick={() => !readOnly && toggleCliente(c)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-border last:border-b-0 bg-card text-left"
                    >
                      <span
                        className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center text-[11px] font-bold ${
                          enEsta ? "bg-primary border-primary text-primary-foreground" : "border-border bg-background text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-card-foreground truncate leading-tight">{c.nom}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {c.codigo_cliente ? `${c.codigo_cliente}` : ""}{c.ciudad ? ` · ${c.ciudad}` : ""}
                          {otraLista && <span className="text-[#b09060]"> · on “{otraLista.nombre}”</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {cliResultados.length === 0 && (
                  <div className="px-3 py-3 text-xs text-muted-foreground">No clients found</div>
                )}
              </div>
              <LoadMoreButton hasMore={cliHasMore} remaining={cliRemaining} onClick={cliLoadMore} />
              <p className="text-[11px] text-muted-foreground mt-2">
                Tap to assign or remove clients. A client can be on one list at a time.
              </p>
            </>
          )}
        </>
      )}
    </Modal>
  );
};

// ------------------------------
// Inventario
// ------------------------------
type BulkRow = {
  sku: string;
  nom: string;
  fabricante: string;
  stock: number;
  cajas: number;
  barcode: string;
  precio: number;
  costo: number;
  min: number;
  _error?: string;
  _warning?: string;
};

type SortKey = "nom" | "precio" | "stock" | "fabricante" | "barcode" | "sku";

type ClienteBulkRow = {
  nom: string;
  codigo_cliente: string;
  tel: string;
  email: string;
  dir: string;
  ciudad: string;
  estado_dir: string;
  contacto: string;
  estado: string;
  abierto_sabados: boolean;
  foto_local: string;
  _error?: string;
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "nom", label: "A-Z Description" },
  { key: "precio", label: "Price" },
  { key: "stock", label: "Current Stock" },
  { key: "fabricante", label: "Brand" },
  { key: "barcode", label: "Barcode" },
  { key: "sku", label: "SKU" },
];

// Miniatura chica para el catalogo (no la foto completa que se guarda en
// productos.foto): @react-pdf embeda los bytes de la imagen tal cual, sin
// recomprimir, asi que con miles de productos un catalogo con las fotos a
// tamaño completo pesaria cientos de MB. Se reduce aqui, en el navegador
// (mismo patron que otros compresores de foto de la app), para no depender
// de una libreria de imagenes nueva en el servidor.
const compressCatalogPhoto = (dataUrl: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 160;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no ctx"));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.55));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });

const CatalogoModal = ({ onClose }: { onClose: () => void }) => {
  const { productos } = useData();
  const [conPrecio, setConPrecio] = useState(true);
  const [conFotos, setConFotos] = useState(true);
  const [almacenCat, setAlmacenCat] = useState<"all" | "palmhills" | "castillo">("all");
  const [generando, setGenerando] = useState(false);
  const [progreso, setProgreso] = useState({ hecho: 0, total: 0 });

  const productosFiltrados = useMemo(
    () =>
      productos.filter((p) => {
        if (almacenCat === "all") return true;
        const a = p.almacen ?? null;
        if (almacenCat === "palmhills") return a === "palmhills" || a === null;
        return a === almacenCat;
      }),
    [productos, almacenCat]
  );

  const generar = async () => {
    if (generando) return;
    setGenerando(true);
    setProgreso({ hecho: 0, total: productosFiltrados.length });
    try {
      const ordenados = [...productosFiltrados].sort((a, b) => {
        const sa = (a.sku || "").trim();
        const sb = (b.sku || "").trim();
        if (!sa && sb) return 1;
        if (sa && !sb) return -1;
        return sa.localeCompare(sb, "en", { numeric: true }) || a.nom.localeCompare(b.nom, "en");
      });

      const items: { nom: string; sku?: string; precio: number; foto?: string }[] = [];
      for (const p of ordenados) {
        let foto: string | undefined;
        if (conFotos && p.foto) {
          try {
            foto = await compressCatalogPhoto(p.foto);
          } catch {
            foto = undefined;
          }
        }
        items.push({ nom: p.nom, sku: p.sku, precio: Number(p.precio), foto });
        setProgreso((s) => ({ ...s, hecho: s.hecho + 1 }));
      }

      const almacenLabel = almacenCat === "all" ? "Both Warehouses" : almacenCat === "palmhills" ? "Palm Hills" : "Castillo";
      const res = await fetch("/api/reportes/catalogo/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conPrecio, conFotos, almacenLabel, productos: items }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], "Product-Catalog.pdf", { type: "application/pdf" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        window.open(URL.createObjectURL(blob), "_blank");
      }
      onClose();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        alert("Could not generate the catalog: " + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setGenerando(false);
    }
  };

  return (
    <Modal title="Generate Catalog" onClose={onClose}>
      <Field label="Warehouse">
        <div className="flex gap-1.5 p-1 bg-muted rounded-xl">
          {([
            { id: "all", label: "Both" },
            { id: "palmhills", label: "🌴 Palm Hills" },
            { id: "castillo", label: "🏰 Castillo" },
          ] as const).map((o) => (
            <button
              key={o.id}
              onClick={() => setAlmacenCat(o.id)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${almacenCat === o.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1.5">{productosFiltrados.length} product(s) match this filter</div>
      </Field>

      <div className="flex items-center justify-between bg-muted rounded-xl px-3.5 py-2.5 mb-3">
        <div className="text-sm font-semibold text-card-foreground">Show prices</div>
        <Switch checked={conPrecio} onCheckedChange={setConPrecio} />
      </div>

      <div className="flex items-center justify-between bg-muted rounded-xl px-3.5 py-2.5 mb-4">
        <div>
          <div className="text-sm font-semibold text-card-foreground">Include photos</div>
          <div className="text-[11px] text-muted-foreground">Bigger file, takes longer to generate</div>
        </div>
        <Switch checked={conFotos} onCheckedChange={setConFotos} />
      </div>

      <button
        disabled={generando || !productosFiltrados.length}
        onClick={generar}
        className={`w-full px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
      >
        {generando ? `Preparing photos... ${progreso.hecho}/${progreso.total}` : "Generate PDF"}
      </button>
    </Modal>
  );
};

const CategoriasModal = ({ onClose }: { onClose: () => void }) => {
  const { categorias, addCategoria, updateCategoria, deleteCategoria, setProductoCategoriaValor, productos, readOnly } = useData();
  const [selId, setSelId] = useState<string | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [valorInput, setValorInput] = useState("");
  const [valorSel, setValorSel] = useState<string | null>(null);
  const [prodSearch, setProdSearch] = useState("");
  const [almacenFiltro, setAlmacenFiltro] = useState<"todos" | "palmhills" | "castillo">("todos");
  const [saving, setSaving] = useState(false);

  const categoria = categorias.find((c) => c.id === selId) || null;

  const productosConValor = (categoriaId: string, valor: string) =>
    productos.filter((p) => (p.categorias?.[categoriaId] || []).includes(valor));

  const crearCategoria = async () => {
    const nombre = nuevoNombre.trim();
    if (!nombre || saving) return;
    setSaving(true);
    try {
      const c = await addCategoria({ nombre, valores: [] });
      setNuevoNombre("");
      setSelId(c.id);
    } catch (err) {
      alert("Error creating category: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const agregarValor = async () => {
    if (!categoria) return;
    const valor = valorInput.trim();
    if (!valor || categoria.valores.some((v) => v.toLowerCase() === valor.toLowerCase())) { setValorInput(""); return; }
    try {
      await updateCategoria(categoria.id, { nombre: categoria.nombre, valores: [...categoria.valores, valor] });
      setValorInput("");
      setValorSel(valor);
    } catch (err) {
      alert("Error adding value: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const quitarValor = async (valor: string) => {
    if (!categoria) return;
    const n = productosConValor(categoria.id, valor).length;
    if (!confirm(`Remove "${valor}"?${n ? ` ${n} product(s) will lose this tag.` : ""}`)) return;
    try {
      await updateCategoria(categoria.id, { nombre: categoria.nombre, valores: categoria.valores.filter((v) => v !== valor) });
      if (valorSel === valor) setValorSel(null);
    } catch (err) {
      alert("Error removing value: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const borrarCategoria = async () => {
    if (!categoria) return;
    if (!confirm(`Delete category "${categoria.nombre}"? Products will lose all its tags.`)) return;
    try {
      await deleteCategoria(categoria.id);
      setSelId(null);
    } catch (err) {
      alert("Error deleting category: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const toggleProducto = async (prodId: string, tiene: boolean) => {
    if (!categoria || !valorSel) return;
    try {
      await setProductoCategoriaValor(prodId, categoria.id, valorSel, !tiene);
    } catch (err) {
      alert("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const prodResultadosTodos = useMemo(() => {
    if (!categoria || !valorSel) return [];
    const porAlmacen = almacenFiltro === "todos" ? productos : productos.filter((p) => (p.almacen || "palmhills") === almacenFiltro);
    return prodSearch.trim()
      ? flexibleSearch(porAlmacen, prodSearch, (p) => [p.nom, p.sku, p.barcode, p.fabricante].filter(Boolean).join(" "), (p) => p.nom)
      : [...porAlmacen].sort((a, b) => {
          const aIn = (a.categorias?.[categoria.id] || []).includes(valorSel) ? 0 : 1;
          const bIn = (b.categorias?.[categoria.id] || []).includes(valorSel) ? 0 : 1;
          if (aIn !== bIn) return aIn - bIn;
          return (a.sku || "").localeCompare(b.sku || "", "en", { numeric: true }) || a.nom.localeCompare(b.nom, "en");
        });
  }, [categoria, valorSel, prodSearch, productos, almacenFiltro]);
  const { visible: prodResultados, hasMore: prodHasMore, remaining: prodRemaining, loadMore: prodLoadMore } = usePagedList(
    prodResultadosTodos,
    [categoria?.id, valorSel, prodSearch, almacenFiltro]
  );

  return (
    <Modal title={categoria ? categoria.nombre : "Categories"} onClose={onClose}>
      {!categoria ? (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            Group products by business type, product type, or anything else — like "Tipo de Negocio" with values Farmacias, Supermercados, Beauty Supply...
          </p>
          {categorias.length > 0 && (
            <div className="border border-border rounded-3xl overflow-hidden mb-3">
              {categorias.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelId(c.id); setValorSel(null); setProdSearch(""); }}
                  className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border last:border-b-0 bg-card text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-card-foreground truncate">{c.nombre}</div>
                    <div className="text-[11px] text-muted-foreground">{c.valores.length} value{c.valores.length === 1 ? "" : "s"}</div>
                  </div>
                  <span className="text-muted-foreground text-lg">›</span>
                </button>
              ))}
            </div>
          )}
          {categorias.length === 0 && <Empty text="No categories yet." />}
          {!readOnly && (
            <div className="flex gap-2 mt-2">
              <input
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") crearCategoria(); }}
                placeholder="New category name (e.g. Tipo de Negocio)…"
                autoComplete="off"
                className="flex-1 px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={crearCategoria}
                disabled={!nuevoNombre.trim() || saving}
                className={`shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
              >
                {saving ? "..." : "Create"}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => { setSelId(null); setValorSel(null); setProdSearch(""); }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-card border border-border text-[13px] font-medium text-primary"
            >
              ‹ Categories
            </button>
            {!readOnly && (
              <button onClick={borrarCategoria} className="text-xs font-medium text-destructive underline">
                Delete category
              </button>
            )}
          </div>

          <Field label="Values">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {categoria.valores.map((v) => (
                <button
                  key={v}
                  onClick={() => setValorSel(v === valorSel ? null : v)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                    valorSel === v ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent"
                  }`}
                >
                  {v}
                  {!readOnly && (
                    <span onClick={(e) => { e.stopPropagation(); quitarValor(v); }} className="opacity-70 hover:opacity-100">×</span>
                  )}
                </button>
              ))}
              {categoria.valores.length === 0 && <span className="text-xs text-muted-foreground">No values yet — add one below.</span>}
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                <input
                  value={valorInput}
                  onChange={(e) => setValorInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") agregarValor(); }}
                  placeholder="Add value (e.g. Farmacias)…"
                  autoComplete="off"
                  className="flex-1 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button onClick={agregarValor} disabled={!valorInput.trim()} className={`shrink-0 px-3 py-2 rounded-xl font-bold text-xs ${GLASS_BTN_PRIMARY} disabled:opacity-50`}>
                  Add
                </button>
              </div>
            )}
          </Field>

          {valorSel ? (
            <>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                Products in "{valorSel}"
              </div>
              <div className="inline-flex bg-muted rounded-full p-1 shadow-sm gap-0.5 mb-2">
                {([
                  { id: "todos", label: "All" },
                  { id: "palmhills", label: "🌴 Palm Hills" },
                  { id: "castillo", label: "🏰 Castillo" },
                ] as const).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAlmacenFiltro(a.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${almacenFiltro === a.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <input
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                placeholder="Search product by name, SKU or brand…"
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring mb-2"
              />
              <div className="border border-border rounded-3xl overflow-hidden">
                {prodResultados.map((p) => {
                  const tiene = (p.categorias?.[categoria.id] || []).includes(valorSel);
                  return (
                    <button
                      key={p.id}
                      onClick={() => !readOnly && toggleProducto(p.id, tiene)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-border last:border-b-0 bg-card text-left"
                    >
                      <span
                        className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center text-[11px] font-bold ${
                          tiene ? "bg-primary border-primary text-primary-foreground" : "border-border bg-background text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-card-foreground truncate uppercase leading-tight">{p.nom}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{p.sku}</div>
                      </div>
                    </button>
                  );
                })}
                {prodResultados.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">No products found</div>}
              </div>
              <LoadMoreButton hasMore={prodHasMore} remaining={prodRemaining} onClick={prodLoadMore} />
              <p className="text-[11px] text-muted-foreground mt-2">Tap a product to add or remove this tag.</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">Pick a value above to see/assign its products.</p>
          )}
        </>
      )}
    </Modal>
  );
};

// Vendedores: alta de vendedores con comision por venta facturada y/o por
// cobro real (dos porcentajes independientes, pedido explicito del usuario),
// y el reporte de comision ganada en un periodo. El prefijo de 2 digitos es
// el mismo que usa codigo_cliente — cada vendedor numera sus clientes por
// separado dentro de su propio prefijo (ver nextCodigoClienteFor en Clientes).
const primerDiaMesVend = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

const VendedoresModal = ({ onClose }: { onClose: () => void }) => {
  const { vendedores, clientes, facturas, addVendedor, updateVendedor, deleteVendedor, readOnly } = useData();
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    nombre: "",
    prefijo: "",
    comision_venta_pct: "",
    comision_cobro_pct: "",
    base_comision: "ambas" as "venta" | "cobros" | "ambas",
    activo: true,
  });
  const [saving, setSaving] = useState(false);
  const [desde, setDesde] = useState(primerDiaMesVend());
  const [hasta, setHasta] = useState(today());

  const aplicarPreset = (p: "month" | "lastMonth" | "quarter" | "year") => {
    const now = new Date();
    if (p === "month") { setDesde(primerDiaMesVend(now)); setHasta(today()); }
    else if (p === "lastMonth") {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      setDesde(primerDiaMesVend(lm));
      setHasta(`${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`);
    } else if (p === "quarter") {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      setDesde(primerDiaMesVend(new Date(now.getFullYear(), qStartMonth, 1)));
      setHasta(today());
    } else {
      setDesde(`${now.getFullYear()}-01-01`);
      setHasta(today());
    }
  };

  const nextPrefijo = useMemo(() => {
    let max = 0;
    vendedores.forEach((v) => { const n = parseInt(v.prefijo, 10); if (!isNaN(n) && n > max) max = n; });
    return String(max + 1).padStart(2, "0");
  }, [vendedores]);

  // Clientes (por nombre, asi es como se guardan en facturas.cli) de cada vendedor
  const nombresPorVendedor = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of clientes) {
      if (!c.vendedor_id) continue;
      if (!m.has(c.vendedor_id)) m.set(c.vendedor_id, new Set());
      m.get(c.vendedor_id)!.add(c.nom);
    }
    return m;
  }, [clientes]);

  const comisionDe = (vendedorId: string) => {
    const nombres = nombresPorVendedor.get(vendedorId) || new Set<string>();
    let venta = 0, cobro = 0;
    for (const f of facturas) {
      if (!nombres.has(f.cli)) continue;
      if (f.fecha >= desde && f.fecha <= hasta) venta += Number(f.total) || 0;
      for (const p of f.pagos || []) {
        if (p.fecha >= desde && p.fecha <= hasta) cobro += Number(p.monto) || 0;
      }
    }
    return { venta, cobro, nClientes: nombres.size };
  };

  const openNew = () => {
    setEditId(null);
    setForm({ nombre: "", prefijo: nextPrefijo, comision_venta_pct: "", comision_cobro_pct: "", base_comision: "ambas", activo: true });
    setShowForm(true);
  };

  const openEdit = (v: Vendedor) => {
    setEditId(v.id);
    setForm({
      nombre: v.nombre,
      prefijo: v.prefijo,
      comision_venta_pct: String(v.comision_venta_pct),
      comision_cobro_pct: String(v.comision_cobro_pct),
      base_comision: v.base_comision,
      activo: v.activo,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) { alert("Enter the salesperson's name"); return; }
    if (!/^\d{2}$/.test(form.prefijo.trim())) { alert("The prefix must be 2 digits (e.g. 02)"); return; }
    setSaving(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        prefijo: form.prefijo.trim(),
        comision_venta_pct: Number(form.comision_venta_pct) || 0,
        comision_cobro_pct: Number(form.comision_cobro_pct) || 0,
        base_comision: form.base_comision,
        activo: form.activo,
      };
      if (editId) await updateVendedor(editId, payload);
      else await addVendedor(payload);
      setShowForm(false);
    } catch (err) {
      alert(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editId) return;
    if (!confirm("Delete this salesperson? Their clients keep their client number but stay unassigned.")) return;
    try {
      await deleteVendedor(editId);
      setShowForm(false);
    } catch (err) {
      alert(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Modal title="Salespeople" onClose={onClose}>
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {[
          { id: "month", label: "This Month" },
          { id: "lastMonth", label: "Last Month" },
          { id: "quarter", label: "This Quarter" },
          { id: "year", label: "This Year" },
        ].map((p) => (
          <button key={p.id} onClick={() => aplicarPreset(p.id as "month" | "lastMonth" | "quarter" | "year")} className="px-3 py-1.5 rounded-full text-xs font-bold bg-muted text-muted-foreground">
            {p.label}
          </button>
        ))}
      </div>
      <Row2>
        <Field label="From">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring" />
        </Field>
        <Field label="To">
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring" />
        </Field>
      </Row2>

      {vendedores.length === 0 ? (
        <Empty text="No salespeople yet." />
      ) : (
        <div className="space-y-2.5 mt-3">
          {vendedores.map((v) => {
            const { venta, cobro, nClientes } = comisionDe(v.id);
            const comVenta = venta * (v.comision_venta_pct / 100);
            const comCobro = cobro * (v.comision_cobro_pct / 100);
            return (
              <div key={v.id} className="bg-background border border-border rounded-2xl p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-card-foreground truncate">{v.nombre}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">Prefix {v.prefijo} · {nClientes} client(s){!v.activo ? " · Inactive" : ""}</div>
                  </div>
                  {!readOnly && (
                    <button onClick={() => openEdit(v)} className="shrink-0 px-2.5 py-1 rounded-lg bg-card border border-border text-xs font-bold text-primary">
                      Edit
                    </button>
                  )}
                </div>
                <div className="h-px bg-border my-2" />
                {(v.base_comision === "venta" || v.base_comision === "ambas") && (
                  <div className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-muted-foreground">Sales ({v.comision_venta_pct}%) · {fmt(venta)}</span>
                    <span className="font-bold text-primary">{fmt(comVenta)}</span>
                  </div>
                )}
                {(v.base_comision === "cobros" || v.base_comision === "ambas") && (
                  <div className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-muted-foreground">Collected ({v.comision_cobro_pct}%) · {fmt(cobro)}</span>
                    <span className="font-bold text-primary">{fmt(comCobro)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && (
        <button onClick={openNew} className={`w-full mt-3 py-2.5 rounded-xl font-bold text-sm ${GLASS_BTN_PRIMARY}`}>
          + Add salesperson
        </button>
      )}

      {showForm && (
        <Modal title={editId ? "Edit Salesperson" : "New Salesperson"} onClose={() => setShowForm(false)}>
          <Field label="Name *">
            <input
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Prefix (2 digits) *">
            <input
              value={form.prefijo}
              onChange={(e) => setForm({ ...form, prefijo: e.target.value.replace(/\D/g, "").slice(0, 2) })}
              placeholder="E.g. 02"
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base font-mono outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Used as the client number prefix (e.g. {form.prefijo || "02"}-0001) for clients assigned to this salesperson.</p>
          </Field>
          <Row2>
            <Field label="Commission on sales (%)">
              <MoneyInput
                value={Number(form.comision_venta_pct) || 0}
                onChange={(n) => setForm({ ...form, comision_venta_pct: String(n) })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Commission on collections (%)">
              <MoneyInput
                value={Number(form.comision_cobro_pct) || 0}
                onChange={(n) => setForm({ ...form, comision_cobro_pct: String(n) })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          <Field label="What counts as commission">
            <div className="flex gap-1.5">
              {(["venta", "cobros", "ambas"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setForm({ ...form, base_comision: b })}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border ${form.base_comision === b ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent"}`}
                >
                  {b === "venta" ? "Sales" : b === "cobros" ? "Collections" : "Both"}
                </button>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2.5 py-2 cursor-pointer">
            <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 accent-primary" />
            <span className="text-sm text-card-foreground">Active (selectable for new clients)</span>
          </label>
          <div className="flex gap-2.5 mt-2">
            {editId && (
              <button onClick={handleDelete} className={`px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_DESTRUCTIVE}`}>
                Delete
              </button>
            )}
            <button onClick={() => setShowForm(false)} className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
};

// Brands: mismo esquema bidireccional que Categories (escribir el nombre una
// vez, despues marcar productos) pero opera directo sobre productos.fabricante
// (string simple, un solo valor por producto) en vez del jsonb de categorias
// multi-valor — asi no hay que abrir el "edit" de cada producto para
// asignarle una marca.
const MarcasModal = ({ onClose }: { onClose: () => void }) => {
  const { productos, setProductoFabricante, readOnly } = useData();
  const [marcaSel, setMarcaSel] = useState<string | null>(null);
  const [nuevaMarca, setNuevaMarca] = useState("");
  const [prodSearch, setProdSearch] = useState("");
  const [almacenFiltro, setAlmacenFiltro] = useState<"todos" | "palmhills" | "castillo">("todos");

  const marcas = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of productos) {
      const m = (p.fabricante || "").trim();
      if (!m) continue;
      map.set(m, (map.get(m) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "en"));
  }, [productos]);

  const seleccionarOCrear = () => {
    const nombre = nuevaMarca.trim();
    if (!nombre) return;
    setMarcaSel(nombre);
    setNuevaMarca("");
    setProdSearch("");
  };

  const toggleProducto = async (prodId: string, tiene: boolean) => {
    if (!marcaSel) return;
    try {
      await setProductoFabricante(prodId, tiene ? "" : marcaSel);
    } catch (err) {
      alert("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const eliminarMarca = async () => {
    if (!marcaSel) return;
    if (!confirm(`Remove "${marcaSel}" from all its products? This cannot be undone.`)) return;
    try {
      await Promise.all(
        productos.filter((p) => p.fabricante === marcaSel).map((p) => setProductoFabricante(p.id, ""))
      );
      setMarcaSel(null);
    } catch (err) {
      alert("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const prodResultadosTodos = useMemo(() => {
    if (!marcaSel) return [];
    const porAlmacen = almacenFiltro === "todos" ? productos : productos.filter((p) => (p.almacen || "palmhills") === almacenFiltro);
    return prodSearch.trim()
      ? flexibleSearch(porAlmacen, prodSearch, (p) => [p.nom, p.sku, p.barcode, p.fabricante].filter(Boolean).join(" "), (p) => p.nom)
      : [...porAlmacen].sort((a, b) => {
          const aIn = a.fabricante === marcaSel ? 0 : 1;
          const bIn = b.fabricante === marcaSel ? 0 : 1;
          if (aIn !== bIn) return aIn - bIn;
          return (a.sku || "").localeCompare(b.sku || "", "en", { numeric: true }) || a.nom.localeCompare(b.nom, "en");
        });
  }, [marcaSel, prodSearch, productos, almacenFiltro]);
  const { visible: prodResultados, hasMore: prodHasMore, remaining: prodRemaining, loadMore: prodLoadMore } = usePagedList(
    prodResultadosTodos,
    [marcaSel, prodSearch, almacenFiltro]
  );

  return (
    <Modal title={marcaSel || "Brands"} onClose={onClose}>
      {!marcaSel ? (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            Type a brand name once, then mark which products belong to it — no need to open each product's edit form.
          </p>
          {marcas.length > 0 && (
            <div className="border border-border rounded-3xl overflow-hidden mb-3">
              {marcas.map(([nombre, count]) => (
                <button
                  key={nombre}
                  onClick={() => { setMarcaSel(nombre); setProdSearch(""); }}
                  className="w-full flex items-center justify-between px-4 py-3 border-b border-border last:border-b-0 bg-card text-left hover:bg-muted"
                >
                  <span className="text-sm font-semibold text-card-foreground">{nombre}</span>
                  <span className="text-xs text-muted-foreground">{count} product{count === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          )}
          {marcas.length === 0 && <Empty text="No brands assigned yet." />}
          {!readOnly && (
            <div className="flex gap-2">
              <input
                value={nuevaMarca}
                onChange={(e) => setNuevaMarca(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") seleccionarOCrear(); }}
                placeholder="New brand name (e.g. Karseell)…"
                autoComplete="off"
                className="flex-1 px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={seleccionarOCrear}
                disabled={!nuevaMarca.trim()}
                className={`shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
              >
                Add
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setMarcaSel(null)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-card border border-border text-[13px] font-medium text-primary"
            >
              ‹ Brands
            </button>
            {!readOnly && (
              <button onClick={eliminarMarca} className="text-xs font-bold text-destructive underline">
                Delete brand
              </button>
            )}
          </div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Products in "{marcaSel}"
          </div>
          <div className="inline-flex bg-muted rounded-full p-1 shadow-sm gap-0.5 mb-2">
            {([
              { id: "todos", label: "All" },
              { id: "palmhills", label: "🌴 Palm Hills" },
              { id: "castillo", label: "🏰 Castillo" },
            ] as const).map((a) => (
              <button
                key={a.id}
                onClick={() => setAlmacenFiltro(a.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${almacenFiltro === a.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <input
            value={prodSearch}
            onChange={(e) => setProdSearch(e.target.value)}
            placeholder="Search product by name, SKU or brand…"
            autoComplete="off"
            className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring mb-2"
          />
          <div className="border border-border rounded-3xl overflow-hidden">
            {prodResultados.map((p) => {
              const tiene = p.fabricante === marcaSel;
              return (
                <button
                  key={p.id}
                  onClick={() => !readOnly && toggleProducto(p.id, tiene)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-border last:border-b-0 bg-card text-left"
                >
                  <span
                    className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center text-[11px] font-bold ${
                      tiene ? "bg-primary border-primary text-primary-foreground" : "border-border bg-background text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-card-foreground truncate uppercase leading-tight">{p.nom}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {p.sku}
                      {p.fabricante && p.fabricante !== marcaSel ? ` · currently "${p.fabricante}"` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
            {prodResultados.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">No products found</div>}
          </div>
          <LoadMoreButton hasMore={prodHasMore} remaining={prodRemaining} onClick={prodLoadMore} />
          <p className="text-[11px] text-muted-foreground mt-2">Tap a product to assign or remove this brand. A product can only have one brand.</p>
        </>
      )}
    </Modal>
  );
};

const Inventario = () => {
  const { productos, facturas, addProducto, addProductosBulk, updateProducto, updateProductoFoto, deleteProducto, categorias, setProductoCategoriaValor, readOnly } = useData();
  const [showTopProductos, setShowTopProductos] = useState(false);
  const [showListasPrecios, setShowListasPrecios] = useState(false);
  const [showCatalogo, setShowCatalogo] = useState(false);
  const [showCategorias, setShowCategorias] = useState(false);
  const [showMarcas, setShowMarcas] = useState(false);
  const [topPeriodoMeses, setTopPeriodoMeses] = useState<1 | 3>(1);
  const topProductosModal = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - topPeriodoMeses);
    return calcTopProductos(facturas, d.toISOString().slice(0, 10));
  }, [facturas, topPeriodoMeses]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkErr, setBulkErr] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showBulkFotos, setShowBulkFotos] = useState(false);
  const [bulkFotosMatches, setBulkFotosMatches] = useState<{ sku: string; prodId: string; nom: string; dataUrl: string }[]>([]);
  const [bulkFotosNoMatch, setBulkFotosNoMatch] = useState<string[]>([]);
  const [bulkFotosSaving, setBulkFotosSaving] = useState(false);
  const [bulkFotosProgress, setBulkFotosProgress] = useState(0);
  const [etqInput, setEtqInput] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("sku");
  const [invColumnas, setInvColumnas] = useState<2 | 3>(3);
  const [almacen, setAlmacen] = useState<"palmhills" | "castillo">("palmhills");
  const [formAlmacen, setFormAlmacen] = useState<"palmhills" | "castillo">("palmhills");
  const [form, setForm] = useState({
    nom: "",
    sku: "",
    fabricante: "",
    etiquetas: [] as string[],
    precio: "",
    costo: "",
    cajas: "",
    stock: "",
    min: "5",
    barcode: "",
  });

  const productosAlmacen = useMemo(
    () =>
      productos.filter((p) => {
        const a = p.almacen ?? null;
        if (almacen === "palmhills") return a === "palmhills" || a === null;
        return a === almacen;
      }),
    [productos, almacen]
  );

  // All unique tags across products, for the filter row
  const allTags = useMemo(() => {
    const set = new Set<string>();
    productosAlmacen.forEach((p) => (p.etiquetas || []).forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "en"));
  }, [productosAlmacen]);

  // Texto buscable por producto: nombre, sku, barcode y tags. flexibleSearch
  // tokeniza el query y matchea cada palabra sin importar el orden, con
  // tolerancia a typos y variantes foneticas (ver lib/search.ts).
  const filtered = useMemo(() => {
    let list = productosAlmacen;

    if (q.trim()) {
      list = flexibleSearch(
        productosAlmacen,
        q,
        (p) => [p.nom, p.sku, p.barcode, ...(p.etiquetas || [])].filter(Boolean).join(" "),
        (p) => p.nom
      );
    }

    // Tag filter (product must contain ALL selected tags)
    if (tagFilter.length) {
      list = list.filter((p) => {
        const pNorm = (p.etiquetas || []).map(normTag);
        return tagFilter.every((t) => pNorm.includes(normTag(t)));
      });
    }

    // Sorting. When there's an active search query AND no explicit sort column
    // selected, preserve the relevance order from the search above.
    // Only apply column sort when the user explicitly chooses one.
    const sorted = [...list];
    const textCmp = (a: string, b: string) =>
      (a || "").localeCompare(b || "", "en", { sensitivity: "base", numeric: true });
    const blankLast = (v: string) => (v && v.trim() ? 0 : 1);

    const hasQuery = q.trim().length > 0;

    if (sortBy === "precio") {
      sorted.sort((a, b) => (b.precio || 0) - (a.precio || 0));
    } else if (sortBy === "stock") {
      sorted.sort((a, b) => (b.stock || 0) - (a.stock || 0));
    } else if (sortBy === "fabricante") {
      sorted.sort(
        (a, b) =>
          blankLast(a.fabricante || "") - blankLast(b.fabricante || "") ||
          textCmp(a.fabricante || "", b.fabricante || "") ||
          textCmp(a.nom, b.nom)
      );
    } else if (sortBy === "barcode") {
      sorted.sort(
        (a, b) =>
          blankLast(a.barcode || "") - blankLast(b.barcode || "") ||
          textCmp(a.barcode || "", b.barcode || "")
      );
    } else if (sortBy === "nom") {
      sorted.sort((a, b) => textCmp(a.nom, b.nom));
    } else if (sortBy === "sku" || !hasQuery) {
      // SKU A-Z: se aplica siempre que el usuario lo elija explicitamente,
      // o como default cuando no hay busqueda activa (para no pisar relevancia).
      sorted.sort(
        (a, b) =>
          blankLast(a.sku || "") - blankLast(b.sku || "") ||
          textCmp(a.sku || "", b.sku || "")
      );
    }

    return sorted;
  }, [productosAlmacen, q, tagFilter, sortBy]);

  const { visible: visibleProductos, hasMore, remaining, loadMore } = usePagedList(filtered, [
    q,
    tagFilter,
    sortBy,
    almacen,
  ]);

  // Las etiquetas son palabras unicas separadas por espacio (como las keywords
  // de busqueda de Amazon): cada palabra es una sugerencia de busqueda aparte,
  // nunca una frase de varias palabras.
  const addTag = (raw: string) => {
    const palabras = raw
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!palabras.length) return;
    setForm((f) => {
      const existentes = new Set(f.etiquetas.map((e) => normTag(e)));
      const agregadas: string[] = [];
      palabras.forEach((p) => {
        if (!existentes.has(normTag(p))) {
          existentes.add(normTag(p));
          agregadas.push(p);
        }
      });
      return { ...f, etiquetas: [...f.etiquetas, ...agregadas] };
    });
    setEtqInput("");
  };

  const removeTag = (t: string) =>
    setForm((f) => ({ ...f, etiquetas: f.etiquetas.filter((e) => e !== t) }));

  const toggleTagFilter = (t: string) =>
    setTagFilter((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  const openNew = () => {
    setEditId(null);
    setFoto(null);
    setEtqInput("");
    setFormAlmacen(almacen);
    setForm({
      nom: "",
      sku: "",
      fabricante: "",
      etiquetas: [],
      precio: "",
      costo: "",
      cajas: "",
      stock: "",
      min: "5",
      barcode: "",
    });
    setMenuOpen(false);
    setShow(true);
  };

  const openEdit = (p: Producto) => {
    setEditId(p.id);
    setFoto(p.foto || null);
    setEtqInput("");
    setFormAlmacen(p.almacen || "palmhills");
    setForm({
      nom: p.nom || "",
      sku: p.sku || "",
      fabricante: p.fabricante || "",
      etiquetas: p.etiquetas || [],
      precio: String(p.precio),
      costo: String(p.costo ?? ""),
      cajas: String(p.cajas ?? ""),
      stock: String(p.stock),
      min: String(p.min),
      barcode: p.barcode || "",
    });
    setShow(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) {
      alert("Enter the name");
      return;
    }

    // El SKU y el nombre no pueden repetirse dentro del mismo almacen
    // (excluyendo el propio producto cuando se esta editando).
    const skuNuevo = form.sku.trim().toLowerCase();
    const nomNuevo = normTag(form.nom);
    const otrosDelAlmacen = productos.filter(
      (p) => p.id !== editId && (p.almacen || "palmhills") === formAlmacen
    );
    if (skuNuevo) {
      const skuDup = otrosDelAlmacen.find((p) => (p.sku || "").trim().toLowerCase() === skuNuevo);
      if (skuDup) {
        alert(`There is already a product with SKU "${form.sku}" in this warehouse: ${skuDup.nom}`);
        return;
      }
    }
    const nomDup = otrosDelAlmacen.find((p) => normTag(p.nom) === nomNuevo);
    if (nomDup) {
      alert(`There is already a product with this name in this warehouse: ${nomDup.nom}`);
      return;
    }

    // Fold any pending word(s) still in the input box into the list
    const pendientes = etqInput
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => p && !form.etiquetas.some((e) => normTag(e) === normTag(p)));
    const etiquetas = [...form.etiquetas, ...pendientes];
    const productData = {
      nom: form.nom,
      sku: form.sku,
      fabricante: form.fabricante,
      etiquetas,
      precio: Number(form.precio),
      costo: Number(form.costo),
      cajas: Number(form.cajas),
      stock: formAlmacen === "castillo" ? 0 : Number(form.stock),
      min: formAlmacen === "castillo" ? 0 : Number(form.min),
      barcode: form.barcode,
      foto,
      almacen: formAlmacen,
    };
    try {
      if (editId) {
        await updateProducto(editId, productData);
      } else {
        await addProducto(productData);
      }
      setShow(false);
    } catch (err) {
      alert(`Could not save the product: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFotoUpload = (file: File | undefined) => {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const CANVAS_SIZE = 800;
        const canvas = document.createElement("canvas");
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        // Draw white background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        
        // Calculate scaling to fit the entire image inside the square
        // while maintaining aspect ratio
        const imgAspect = img.width / img.height;
        const canvasAspect = 1; // square
        
        let scaledWidth: number, scaledHeight: number;
        if (imgAspect > canvasAspect) {
          // Image is wider than tall - fit to height
          scaledHeight = CANVAS_SIZE;
          scaledWidth = CANVAS_SIZE * imgAspect;
        } else {
          // Image is taller than wide - fit to width
          scaledWidth = CANVAS_SIZE;
          scaledHeight = CANVAS_SIZE / imgAspect;
        }
        
        // Center the image
        const x = (CANVAS_SIZE - scaledWidth) / 2;
        const y = (CANVAS_SIZE - scaledHeight) / 2;
        
        // Draw the complete, scaled image centered
        ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
        
        let optimized = canvas.toDataURL("image/jpeg", 0.75);
        if (optimized.length > 300000) {
          const small = document.createElement("canvas");
          small.width = 500;
          small.height = 500;
          const sctx = small.getContext("2d");
          if (sctx) {
            sctx.fillStyle = "#ffffff";
            sctx.fillRect(0, 0, 500, 500);
            sctx.drawImage(canvas, 0, 0, 500, 500);
            optimized = small.toDataURL("image/jpeg", 0.6);
          }
        }
        setFoto(optimized);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const openBulk = () => {
    setMenuOpen(false);
    setBulkRows([]);
    setBulkErr("");
    setShowBulk(true);
  };

  const compressImageBuffer = (buffer: ArrayBuffer): Promise<string> =>
    new Promise((resolve, reject) => {
      const blob = new Blob([buffer]);
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const CANVAS_SIZE = 800;
        const canvas = document.createElement("canvas");
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        const aspect = img.width / img.height;
        let sw = CANVAS_SIZE, sh = CANVAS_SIZE;
        if (aspect > 1) { sh = CANVAS_SIZE / aspect; } else { sw = CANVAS_SIZE * aspect; }
        ctx.drawImage(img, (CANVAS_SIZE - sw) / 2, (CANVAS_SIZE - sh) / 2, sw, sh);
        let out = canvas.toDataURL("image/jpeg", 0.75);
        if (out.length > 300000) {
          const s = document.createElement("canvas"); s.width = 500; s.height = 500;
          const sc = s.getContext("2d");
          if (sc) { sc.fillStyle = "#fff"; sc.fillRect(0, 0, 500, 500); sc.drawImage(canvas, 0, 0, 500, 500); out = s.toDataURL("image/jpeg", 0.6); }
        }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load error")); };
      img.src = url;
    });

  const handleBulkFotosZip = async (file: File) => {
    setBulkFotosMatches([]);
    setBulkFotosNoMatch([]);
    try {
      const zip = await JSZip.loadAsync(file);
      const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
      const matched: { sku: string; prodId: string; nom: string; dataUrl: string }[] = [];
      const noMatch: string[] = [];
      const files = Object.entries(zip.files).filter(([name, f]) => !f.dir && IMAGE_EXT.test(name));
      for (const [name, zipFile] of files) {
        const baseName = name.split("/").pop() || name;
        const sku = baseName.replace(/\.[^.]+$/, "").trim();
        const prod = productos.find((p) => (p.sku || "").trim().toLowerCase() === sku.toLowerCase());
        if (!prod) { noMatch.push(sku); continue; }
        const buffer = await zipFile.async("arraybuffer");
        const dataUrl = await compressImageBuffer(buffer);
        matched.push({ sku, prodId: prod.id, nom: prod.nom, dataUrl });
      }
      setBulkFotosMatches(matched);
      setBulkFotosNoMatch(noMatch);
    } catch (err) {
      alert(`Error reading ZIP: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const applyBulkFotos = async () => {
    setBulkFotosSaving(true);
    setBulkFotosProgress(0);
    let done = 0;
    for (const m of bulkFotosMatches) {
      await updateProductoFoto(m.prodId, m.dataUrl);
      done++;
      setBulkFotosProgress(Math.round((done / bulkFotosMatches.length) * 100));
    }
    setBulkFotosSaving(false);
    setShowBulkFotos(false);
    setBulkFotosMatches([]);
    setBulkFotosNoMatch([]);
  };

  // Normalize a header to match it loosely (ignore case, accents, spaces)
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  const COLS: Record<keyof Omit<BulkRow, "_error" | "_warning">, string[]> = {
    sku: ["sku"],
    nom: ["descripcion", "descripcionn", "nombre", "producto", "description", "name", "product"],
    fabricante: ["fabricante", "marca", "proveedor", "manufacturer", "brand", "supplier"],
    stock: ["inventarioactual", "inventario", "stock", "existencia", "currentstock", "inventory", "qty", "quantity"],
    cajas: ["cantidadporcajas", "cantidadcajas", "cajas", "porcaja", "unidadesporcaja", "unitsperbox", "perbox", "boxqty"],
    barcode: ["codigodebarras", "codigobarras", "barcode", "cb"],
    precio: ["precio", "precioventa", "venta", "price", "saleprice"],
    costo: ["costo", "preciocosto", "cost"],
    min: ["inventariominimo", "minimo", "stockminimo", "min", "minimumstock", "minstock"],
  };

  const findKey = (headers: string[], aliases: string[]) => {
    const normalized = headers.map(norm);
    for (const a of aliases) {
      const idx = normalized.indexOf(a);
      if (idx !== -1) return headers[idx];
    }
    return null;
  };

  const handleExcelUpload = async (file: File | undefined) => {
    if (!file) return;
    setBulkErr("");
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!json.length) {
        setBulkErr("The file is empty or has no data rows.");
        setBulkRows([]);
        return;
      }
      const headers = Object.keys(json[0]);
      const keyMap = {
        sku: findKey(headers, COLS.sku),
        nom: findKey(headers, COLS.nom),
        fabricante: findKey(headers, COLS.fabricante),
        stock: findKey(headers, COLS.stock),
        cajas: findKey(headers, COLS.cajas),
        barcode: findKey(headers, COLS.barcode),
        precio: findKey(headers, COLS.precio),
        costo: findKey(headers, COLS.costo),
        min: findKey(headers, COLS.min),
      };
      if (!keyMap.nom) {
        setBulkErr(
          "Couldn't find the 'Description' column. Check the headers or download the template."
        );
        setBulkRows([]);
        return;
      }
      const num = (v: unknown) => {
        const n = Number(String(v).replace(/[^0-9.-]/g, ""));
        return isNaN(n) ? 0 : n;
      };
      const rows: BulkRow[] = json.map((r) => {
        const nom = String(keyMap.nom ? r[keyMap.nom] : "").trim();
        const precio = keyMap.precio ? num(r[keyMap.precio]) : 0;
        const costo = keyMap.costo ? num(r[keyMap.costo]) : 0;
        const stock = keyMap.stock ? num(r[keyMap.stock]) : 0;

        let error: string | undefined;
        let warning: string | undefined;
        
        if (!nom) {
          error = "Missing description";
        } else if (costo < 0) {
          error = "Invalid cost";
        } else if (stock < 0) {
          error = "Stock cannot be negative";
        }
        
        // Precio en 0 es advertencia, no error
        if (precio === 0) {
          warning = "Price is $0";
        }

        return {
          sku: String(keyMap.sku ? r[keyMap.sku] : "").trim(),
          nom,
          fabricante: String(keyMap.fabricante ? r[keyMap.fabricante] : "").trim(),
          stock,
          cajas: keyMap.cajas ? num(r[keyMap.cajas]) : 0,
          barcode: String(keyMap.barcode ? r[keyMap.barcode] : "").trim(),
          precio,
          costo,
          min: keyMap.min ? num(r[keyMap.min]) : 5,
          _error: error,
          _warning: warning,
        };
      });

      // El SKU y la descripcion no pueden repetirse: ni entre filas del mismo
      // archivo, ni contra un producto que ya exista en este almacen. El SKU
      // contra la base de datos se valida aparte (permite "skip" o "update
      // prices"), pero duplicados dentro del propio archivo o por nombre
      // siempre se bloquean.
      const skuCounts = new Map<string, number>();
      const nomCounts = new Map<string, number>();
      rows.forEach((r) => {
        if (r.sku) skuCounts.set(r.sku.toLowerCase(), (skuCounts.get(r.sku.toLowerCase()) || 0) + 1);
        if (r.nom) nomCounts.set(normTag(r.nom), (nomCounts.get(normTag(r.nom)) || 0) + 1);
      });
      const nomExistente = new Set(productosAlmacen.map((p) => normTag(p.nom)));
      rows.forEach((r) => {
        if (r._error) return;
        const skuNorm = r.sku.toLowerCase();
        const nomNorm = normTag(r.nom);
        if (skuNorm && (skuCounts.get(skuNorm) || 0) > 1) {
          r._error = "Duplicate SKU in this file";
        } else if ((nomCounts.get(nomNorm) || 0) > 1) {
          r._error = "Duplicate description in this file";
        } else if (nomExistente.has(nomNorm)) {
          r._error = "A product with this name already exists in this warehouse";
        }
      });

      setBulkRows(rows);
    } catch {
      setBulkErr("Couldn't read the file. Make sure it's a valid Excel file (.xlsx).");
      setBulkRows([]);
    }
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "SKU",
        "Descripcion",
        "Fabricante",
        "Current Stock",
        "Units per box",
        "Barcode",
        "Price",
        "Costo",
        "Minimum stock",
      ],
      ["SHP-001", "Shampoo Hidratante Pro", "Acromona", 45, 12, "7503000123401", 850, 520, 10],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "inventory_template.xlsx");
  };

  const confirmBulk = async (skipDuplicates = false, updatePrices = false) => {
    const valid = bulkRows.filter((r) => !r._error);
    if (!valid.length) {
      setBulkErr("No valid rows to import.");
      return;
    }
    setBulkSaving(true);
    try {
      const result = await addProductosBulk(
        valid.map((r) => ({
          nom: r.nom,
          sku: r.sku,
          fabricante: r.fabricante,
          etiquetas: [],
          barcode: r.barcode,
          precio: r.precio,
          costo: r.costo,
          cajas: r.cajas,
          stock: r.stock,
          min: r.min,
          foto: null,
          almacen,
        })),
        skipDuplicates,
        updatePrices
      );

      if (typeof result === 'object') {
        const msg = updatePrices
          ? `${result.actualizados} prices updated. ${result.insertados} new products imported.`
          : `${result.insertados} products imported successfully.${
              result.duplicados > 0 ? ` (${result.duplicados} duplicates skipped)` : ''
            }`;
        alert(msg);
        setShowBulk(false);
        setBulkRows([]);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[v0] Bulk upload failed:", errorMsg);

      // If it's a duplicates error, show the option to skip them
      if (errorMsg.includes("already exist")) {
        setBulkErr(`${errorMsg} You can skip them, or update only their price while keeping their photo and description.`);
      } else {
        setBulkErr(`Error saving: ${errorMsg}. Please check the console.`);
      }
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <div className="inline-flex backdrop-blur-md bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5">
          <button
            onClick={() => setAlmacen("palmhills")}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              almacen === "palmhills" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            🌴 Palm Hills
          </button>
          <button
            onClick={() => setAlmacen("castillo")}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              almacen === "castillo" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            🏰 Castillo
          </button>
        </div>
        <div className="inline-flex backdrop-blur-md bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5">
          <button
            onClick={() => setInvColumnas(2)}
            aria-label="2 columns"
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all ${invColumnas === 2 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            ▥ 2
          </button>
          <button
            onClick={() => setInvColumnas(3)}
            aria-label="3 columns"
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all ${invColumnas === 3 ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            ▦ 3
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="relative flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, code or tag..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
          />
          {q && (
            <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button>
          )}
        </div>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-[6]" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}
      {!readOnly && (
        <div className={`${ADD_PILL_POS} flex flex-col items-end gap-2`}>
          {menuOpen && (
            <div className="flex flex-col gap-2 mb-1">
              <button
                onClick={openNew}
                className="flex items-center gap-2 bg-card border border-border text-card-foreground rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium whitespace-nowrap"
              >
                <span className="text-base" aria-hidden="true">✏️</span>
                Add Manually
              </button>
              <button
                onClick={openBulk}
                className="flex items-center gap-2 bg-card border border-border text-card-foreground rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium whitespace-nowrap"
              >
                <span className="text-base" aria-hidden="true">📄</span>
                Bulk Upload
              </button>
              <button
                onClick={() => { setMenuOpen(false); setBulkFotosMatches([]); setBulkFotosNoMatch([]); setShowBulkFotos(true); }}
                className="flex items-center gap-2 bg-card border border-border text-card-foreground rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium whitespace-nowrap"
              >
                <span className="text-base" aria-hidden="true">🖼️</span>
                Bulk Photos (ZIP)
              </button>
            </div>
          )}
          <AddPillButton aria-label="Add product" active={menuOpen} onClick={() => setMenuOpen((o) => !o)} />
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        <label
          htmlFor="sortBy"
          className="text-xs text-muted-foreground shrink-0"
        >
          Sort by
        </label>
        <select
          id="sortBy"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground shrink-0">
          {filtered.length} prod.
        </span>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => setShowTopProductos(true)}
          className="shrink-0 px-3 py-2 rounded-xl border border-border bg-card text-sm font-bold text-primary flex items-center gap-1"
        >
          🏆 Top
        </button>
        <button
          onClick={() => setShowListasPrecios(true)}
          className="shrink-0 px-3 py-2 rounded-xl border border-border bg-card text-sm font-bold text-primary flex items-center gap-1"
        >
          🏷️ Lists
        </button>
        <button
          onClick={() => setShowCatalogo(true)}
          className="shrink-0 px-3 py-2 rounded-xl border border-border bg-card text-sm font-bold text-primary flex items-center gap-1"
        >
          📖 Catalog
        </button>
        <button
          onClick={() => setShowCategorias(true)}
          className="shrink-0 px-3 py-2 rounded-xl border border-border bg-card text-sm font-bold text-primary flex items-center gap-1"
        >
          🗂️ Categories
        </button>
        <button
          onClick={() => setShowMarcas(true)}
          className="shrink-0 px-3 py-2 rounded-xl border border-border bg-card text-sm font-bold text-primary flex items-center gap-1"
        >
          🏭 Brands
        </button>
      </div>
      {showListasPrecios && <ListasPreciosModal onClose={() => setShowListasPrecios(false)} />}
      {showCatalogo && <CatalogoModal onClose={() => setShowCatalogo(false)} />}
      {showCategorias && <CategoriasModal onClose={() => setShowCategorias(false)} />}
      {showMarcas && <MarcasModal onClose={() => setShowMarcas(false)} />}
      {showTopProductos && (
        <Modal title="Top Products" onClose={() => setShowTopProductos(false)}>
          <div className="flex gap-1.5 p-1 bg-muted rounded-xl mb-3">
            {([1, 3] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTopPeriodoMeses(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${topPeriodoMeses === m ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}
              >
                {m === 1 ? "This month" : "3 months"}
              </button>
            ))}
          </div>
          {topProductosModal.length ? (
            <div className="border border-border rounded-3xl overflow-hidden">
              {topProductosModal.map((p, i) => {
                const maxMonto = topProductosModal[0]?.monto || 1;
                return (
                  <div key={p.sku || p.nom} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border last:border-b-0">
                    <div className="w-5 text-center text-xs font-bold text-muted-foreground shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-card-foreground uppercase break-words leading-tight">{p.nom}</div>
                      {p.sku && <div className="text-[9px] font-mono text-primary/60 truncate leading-none mb-1">{p.sku}</div>}
                      <div className="mt-1 h-1 rounded-full overflow-hidden bg-secondary">
                        <div className="h-full rounded-full" style={{ width: `${Math.round((p.monto / maxMonto) * 100)}%`, background: "var(--primary)" }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-card-foreground tabular-nums">{fmt(p.monto)}</div>
                      <div className="text-[9px] text-muted-foreground">{p.qty.toLocaleString()} u</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty text="No sales in this period." />
          )}
        </Modal>
      )}
      <div className={`grid gap-2.5 mb-3 ${invColumnas === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {visibleProductos.length ? (
          visibleProductos.map((p) => {
            const stock = Number(p.stock);
            const min = Number(p.min || 5);
            const estado =
              stock <= 0 ? "Out of stock" : stock <= min ? "Low stock" : "In Stock";
            return (
              <div
                key={p.id}
                className="bg-card border border-border rounded-3xl p-3 relative flex flex-col h-full shadow-[0_1px_2px_rgba(28,31,25,0.04)]"
              >
                {!readOnly && (
                  <button
                    onClick={() => openEdit(p)}
                    className="absolute top-2 right-2 bg-card/90 border border-border rounded-full px-2.5 py-1 text-xs font-semibold cursor-pointer text-secondary-foreground z-[1]"
                  >
                    Edit
                  </button>
                )}
                <div
                  onClick={() => p.foto && setFotoAmpliada(p.foto)}
                  className={`w-full aspect-square rounded-xl bg-white border border-border/60 flex items-center justify-center text-2xl mb-2.5 shrink-0 ${p.foto ? "cursor-pointer" : ""}`}
                >
                  {p.foto ? (
                    <img
                      src={p.foto}
                      alt={p.nom}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    p.icon || "📦"
                  )}
                </div>
                <div className="text-[13px] font-semibold mb-1 text-card-foreground leading-snug break-words text-pretty min-h-[2.25rem] tracking-tight uppercase">
                  {p.nom}
                </div>
                <div className="text-xs text-muted-foreground font-mono mb-0.5 break-all">
                  {p.sku}
                </div>
                {p.fabricante && (
                  <div className="text-[11px] text-muted-foreground mb-0.5 break-words">
                    {p.fabricante}
                  </div>
                )}
                <div className="mt-auto pt-2">
                  <div className="flex items-end justify-between gap-1.5 flex-wrap">
                    <div className="text-base font-extrabold text-card-foreground tabular-nums tracking-tight">
                      {fmt(p.precio)}
                    </div>
                    {almacen === "castillo" ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex bg-[#f5eee2] text-[#a3814e]">
                        🏰 CASTILLO
                      </span>
                    ) : (
                      <Badge e={estado} />
                    )}
                  </div>
                  {almacen !== "castillo" && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Stock: {stock} units
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-2">
            <Empty text="No products. Tap + to add one." />
          </div>
        )}
      </div>
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={loadMore} />

      {showBulkFotos && (
        <Modal title="Bulk Photos Upload (ZIP)" onClose={() => { setShowBulkFotos(false); setBulkFotosMatches([]); setBulkFotosNoMatch([]); }}>
          <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
            Upload a ZIP file with images named by SKU (e.g. <span className="font-mono">rb-001.jpg</span>). Images can be in subfolders. Each image will be matched to the product with that SKU.
          </p>
          <label className="block w-full cursor-pointer">
            <div className="w-full border-2 border-dashed border-border rounded-xl py-6 flex flex-col items-center gap-2 bg-muted/30 hover:bg-muted/50 transition-colors">
              <span className="text-3xl">🗜️</span>
              <span className="text-sm font-medium text-card-foreground">Select ZIP file</span>
              <span className="text-xs text-muted-foreground">Images named by SKU inside</span>
            </div>
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBulkFotosZip(f); e.target.value = ""; }}
            />
          </label>
          {(bulkFotosMatches.length > 0 || bulkFotosNoMatch.length > 0) && (
            <div className="mt-4 space-y-3">
              {bulkFotosMatches.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-card-foreground mb-2">✅ {bulkFotosMatches.length} matched products</p>
                  <div className="grid grid-cols-3 gap-2 max-h-52 overflow-y-auto">
                    {bulkFotosMatches.map((m) => (
                      <div key={m.prodId} className="bg-card border border-border rounded-lg p-1.5 flex flex-col items-center gap-1">
                        <img src={m.dataUrl} alt={m.nom} className="w-full aspect-square object-contain rounded" />
                        <span className="text-[10px] font-mono text-muted-foreground truncate w-full text-center">{m.sku}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {bulkFotosNoMatch.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-destructive mb-1">❌ {bulkFotosNoMatch.length} SKUs not found</p>
                  <div className="flex flex-wrap gap-1">
                    {bulkFotosNoMatch.slice(0, 20).map((s) => (
                      <span key={s} className="text-[10px] font-mono bg-red-50 text-destructive px-1.5 py-0.5 rounded">{s}</span>
                    ))}
                    {bulkFotosNoMatch.length > 20 && <span className="text-[10px] text-muted-foreground">+{bulkFotosNoMatch.length - 20} more</span>}
                  </div>
                </div>
              )}
              {bulkFotosMatches.length > 0 && (
                <div>
                  {bulkFotosSaving && (
                    <div className="mb-2">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${bulkFotosProgress}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 text-center">{bulkFotosProgress}%</p>
                    </div>
                  )}
                  <button
                    onClick={applyBulkFotos}
                    disabled={bulkFotosSaving}
                    className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50"
                  >
                    {bulkFotosSaving ? `Uploading... ${bulkFotosProgress}%` : `Apply ${bulkFotosMatches.length} photos`}
                  </button>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {showBulk && (
        <Modal title="Bulk Upload Inventory" onClose={() => setShowBulk(false)}>
          <div className="text-sm text-muted-foreground mb-3 leading-relaxed">
            Upload an Excel file (.xlsx) with these columns:{" "}
            <span className="font-medium text-card-foreground">
              SKU, Description, Brand, Current Stock, Units per box, Barcode, Price, Cost, Minimum stock
            </span>
            .
          </div>
          <button
            onClick={downloadTemplate}
            className="w-full px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium text-sm mb-3"
          >
            Download sample template
          </button>
          <div
            onClick={() => document.getElementById("excelInput")?.click()}
            className="w-full h-28 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer bg-muted mb-3"
          >
            <div className="text-2xl">📊</div>
            <div className="text-sm text-muted-foreground mt-1">
              Tap to select Excel file
            </div>
          </div>
          <input
            id="excelInput"
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => handleExcelUpload(e.target.files?.[0])}
          />

          {bulkErr && (
            <div className="text-sm text-destructive mb-3 bg-red-50 rounded-lg px-3 py-2">
              {bulkErr}
            </div>
          )}

          {bulkRows.length > 0 && (
            <>
              <div className="text-sm font-semibold text-card-foreground mb-2">
                Preview ({bulkRows.filter((r) => !r._error).length} of{" "}
                {bulkRows.length} valid)
              </div>
              <div className="max-h-60 overflow-auto rounded-xl border border-border mb-3">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Description</th>
                      <th className="px-2 py-1.5 font-medium">SKU</th>
                      <th className="px-2 py-1.5 font-medium text-right">Inv.</th>
                      <th className="px-2 py-1.5 font-medium text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((r, i) => (
                      <tr
                        key={i}
                        className={`border-t border-border ${
                          r._error
                            ? "bg-red-50 hover:bg-red-100"
                            : r._warning
                            ? "bg-yellow-50 hover:bg-yellow-100"
                            : "bg-green-50 hover:bg-green-100"
                        }`}
                        title={r._error || r._warning || "Valid for import"}
                      >
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                          {r._error ? (
                            <span className="text-destructive">❌</span>
                          ) : r._warning ? (
                            <span className="text-yellow-600">!</span>
                          ) : (
                            <span className="text-green-600">✓</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-card-foreground max-w-xs break-words uppercase">
                          {r.nom || (
                            <span className="text-destructive italic normal-case">No name</span>
                          )}
                          {r._error && (
                            <div className="text-xs text-destructive mt-0.5">
                              {r._error}
                            </div>
                          )}
                          {r._warning && (
                            <div className="text-xs text-yellow-600 mt-0.5">
                              {r._warning}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono text-xs">
                          {r.sku || "-"}
                        </td>
                        <td className="px-2 py-1.5 text-right text-card-foreground">
                          {r.stock ?? "-"}
                        </td>
                        <td className="px-2 py-1.5 text-right text-card-foreground">
                          {fmt(r.precio || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2 mb-3">
                <strong>Required fields:</strong> Description, Current Stock, Price,
                Cost. Empty fields must be 0 or valid numbers.
              </div>
            </>
          )}

          <div className="flex gap-2.5 mt-1">
            <button
              onClick={() => {
                setShowBulk(false);
                setBulkErr("");
              }}
              className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
            >
              Cancel
            </button>
            {bulkErr && bulkErr.includes("already exist") && (
              <>
                <button
                  onClick={() => confirmBulk(true, false)}
                  disabled={bulkSaving || !bulkRows.some((r) => !r._error)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-orange-600 text-white font-bold text-sm disabled:opacity-50"
                >
                  {bulkSaving ? "Importing..." : "Skip duplicates"}
                </button>
                <button
                  onClick={() => confirmBulk(false, true)}
                  disabled={bulkSaving || !bulkRows.some((r) => !r._error)}
                  title="Updates only the price of existing SKUs (keeps photo, description and stock) and imports the new ones"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm disabled:opacity-50"
                >
                  {bulkSaving ? "Updating..." : "Update price"}
                </button>
              </>
            )}
            <button
              onClick={() => confirmBulk(false)}
              disabled={
                bulkSaving || !bulkRows.some((r) => !r._error)
              }
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50"
            >
              {bulkSaving
                ? "Importing..."
                : `Import ${bulkRows.filter((r) => !r._error).length}`}
            </button>
          </div>
        </Modal>
      )}

      {show && (
        <Modal
          title={editId ? "Edit Product" : "New Product"}
          onClose={() => setShow(false)}
        >
          <Field label="Warehouse">
            <div className="inline-flex backdrop-blur-md bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5">
              <button
                type="button"
                onClick={() => setFormAlmacen("palmhills")}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  formAlmacen === "palmhills" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                🌴 Palm Hills
              </button>
              <button
                type="button"
                onClick={() => setFormAlmacen("castillo")}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  formAlmacen === "castillo" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                🏰 Castillo
              </button>
            </div>
          </Field>
          <Field label="Photo">
            <div
              onClick={() => document.getElementById("fotoInput")?.click()}
              className="w-32 h-32 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer bg-white mb-1"
            >
              {foto ? (
                <img
                  src={foto}
                  alt="Preview"
                  className="w-full h-full object-contain"
                />
              ) : (
                <>
                  <div className="text-2xl">📷</div>
                  <div className="text-xs text-muted-foreground mt-1 text-center px-1">
                    Tap
                  </div>
                </>
              )}
            </div>
            <input
              id="fotoInput"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFotoUpload(e.target.files?.[0])}
            />
            {foto && (
              <button
                onClick={() => setFoto(null)}
                className="w-full px-2.5 py-1 rounded-lg backdrop-blur-md bg-red-50/80 border border-red-200/60 text-destructive text-xs mb-1"
              >
                X Remove photo
              </button>
            )}
          </Field>
          <Field label="Barcode">
            <input
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Name *">
            <input
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field
            label={
              <>
                SKU <span className="text-destructive">*</span>
              </>
            }
          >
            <input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Brand">
            <input
              value={form.fabricante}
              onChange={(e) => setForm({ ...form, fabricante: e.target.value })}
              placeholder="E.g. Karseell, Hair Plus, Olaplex..."
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Tags">
            <div className="w-full px-2 py-2 rounded-xl border border-input bg-card focus-within:ring-2 focus-within:ring-ring">
              {form.etiquetas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {form.etiquetas.map((t) => (
                    <span
                      key={t}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        aria-label={`Quitar ${t}`}
                        className="text-secondary-foreground/70 hover:text-secondary-foreground leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                value={etqInput}
                onChange={(e) => setEtqInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "," || e.key === " ") {
                    e.preventDefault();
                    addTag(etqInput);
                  } else if (e.key === "Backspace" && !etqInput && form.etiquetas.length) {
                    removeTag(form.etiquetas[form.etiquetas.length - 1]);
                  }
                }}
                onBlur={() => etqInput.trim() && addTag(etqInput)}
                placeholder="One word per tag (e.g. oil curls hair)"
                autoComplete="off"
                className="w-full px-1 py-1 bg-transparent text-card-foreground text-base outline-none"
              />
            </div>
          </Field>
          {editId && categorias.length > 0 && (
            <Field label="Categories">
              <div className="space-y-2.5">
                {categorias.map((c) => {
                  const activos = productos.find((p) => p.id === editId)?.categorias?.[c.id] || [];
                  return (
                    <div key={c.id}>
                      <div className="text-[11px] font-bold text-muted-foreground mb-1">{c.nombre}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {c.valores.map((v) => {
                          const activo = activos.includes(v);
                          return (
                            <button
                              key={v}
                              type="button"
                              disabled={readOnly}
                              onClick={() => setProductoCategoriaValor(editId, c.id, v, !activo)}
                              className={`px-3 py-1.5 rounded-full text-xs font-bold border ${
                                activo ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent"
                              }`}
                            >
                              {v}
                            </button>
                          );
                        })}
                        {c.valores.length === 0 && <span className="text-xs text-muted-foreground">No values defined yet — add them from "Categories" in Inventory.</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Field>
          )}
          <Row2>
            <Field label="Price ($)">
              <MoneyInput
                value={Number(form.precio) || 0}
                onChange={(n) => setForm({ ...form, precio: String(n) })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Cost ($)">
              <MoneyInput
                value={Number(form.costo) || 0}
                onChange={(n) => setForm({ ...form, costo: String(n) })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          {Number(form.costo) > 0 && (
            <div className="text-[11px] font-semibold text-primary -mt-1 mb-2">
              Margin: {(((Number(form.precio) - Number(form.costo)) / Number(form.costo)) * 100).toFixed(0)}%
              <span className="text-muted-foreground font-normal ml-1">
                ({fmt(Number(form.precio) - Number(form.costo))})
              </span>
            </div>
          )}
          {formAlmacen !== "castillo" && (
            <>
              <Row2>
                <Field label="Stock (current)">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    autoComplete="off"
                    className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
                  />
                </Field>
                <Field label="Units per box">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.cajas}
                    onChange={(e) => setForm({ ...form, cajas: e.target.value })}
                    autoComplete="off"
                    className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
                  />
                </Field>
              </Row2>
              <Field label="Minimum stock">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.min}
                  onChange={(e) => setForm({ ...form, min: e.target.value })}
                  autoComplete="off"
                  className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </>
          )}
          {editId && (
            <button
              onClick={() => {
                if (confirm("Delete product?")) {
                  deleteProducto(editId)
                    .then(() => setShow(false))
                    .catch((err) =>
                      alert(`Could not delete the product: ${err instanceof Error ? err.message : String(err)}`)
                    );
                }
              }}
              className="w-full px-4 py-2.5 rounded-xl backdrop-blur-md bg-red-50/80 border border-red-200/60 text-destructive font-medium text-sm mb-3"
            >
              Delete product
            </button>
          )}
          <div className="flex gap-2.5 mt-3.5">
            <button
              onClick={() => setShow(false)}
              className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY}`}
            >
              {editId ? "Update" : "Save"} Product
            </button>
          </div>
        </Modal>
      )}

      {fotoAmpliada && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-6"
          onClick={() => setFotoAmpliada(null)}
        >
          <img
            src={fotoAmpliada}
            alt="Enlarged photo"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
          <button
            onClick={() => setFotoAmpliada(null)}
            aria-label="Close"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 text-white text-xl flex items-center justify-center"
          >
            X
          </button>
        </div>
      )}
    </div>
  );
};

// ------------------------------
// Ordenes
// ------------------------------
const Ordenes = () => {
  const {
    ordenes,
    clientes,
    productos,
    proximasFechasEntrega,
    addOrden,
    updateOrden,
    deleteOrden,
    addFactura,
    addRemito,
    ajustarInventario,
    readOnly,
    listasPrecios,
  } = useData();
  const router = useRouter();
  // Prefetch del codigo de la pagina de estimate para que el primer tap abra rapido.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ordenes[0]) router.prefetch(`/ordenes/${ordenes[0].id}/estimado`);
  }, [ordenes.length > 0]);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [picking, setPicking] = useState<Orden | null>(null);
  const [completing, setCompleting] = useState(false);
  const [pickAlmacen, setPickAlmacen] = useState<"todos" | "palmhills" | "castillo">("todos");
  const [pickItems, setPickItems] = useState<(LineaOrden & { picked: boolean })[]>(
    []
  );
  // Ultimo producto pickeado de la orden abierta (persistido en localStorage
  // por orden): al reabrir el pick se resalta y se hace scroll hasta el, para
  // refrescar la memoria de por donde iba el progreso.
  const [lastPickedId, setLastPickedId] = useState<string | null>(null);
  const [pickDirty, setPickDirty] = useState(false);
  const lastPickedRef = useRef<HTMLDivElement | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingOrden, setEditingOrden] = useState<Orden | null>(null);
  const [editCli, setEditCli] = useState("");
  const [editCliSearch, setEditCliSearch] = useState("");
  const [editCliOpen, setEditCliOpen] = useState(false);
  const [editQtys, setEditQtys] = useState<Record<string, number>>({});
  const [editPrecios, setEditPrecios] = useState<Record<string, number>>({});
  const [editandoDescuentoId, setEditandoDescuentoId] = useState<string | null>(null);
  const [editProductOrder, setEditProductOrder] = useState<string[]>([]);
  const [editSearch, setEditSearch] = useState("");
  const [editAlmacen, setEditAlmacen] = useState<"palmhills" | "castillo" | "all">("all");
  const [editForm, setEditForm] = useState({ fecha: today(), estado: "Pending" });

  const clienteFor = (cli: string) =>
    clientes.find((c) => c.id === cli) || clientes.find((c) => c.nom === cli);

  const startPick = (ord: Orden) => {
    if (!ord.lineas?.length) {
      alert("This order has no detailed products.");
      return;
    }
    setPicking(ord);
    setPickAlmacen("todos");
    setPickDirty(false);
    try {
      setLastPickedId(localStorage.getItem(`ph_lastpick_${ord.id}`));
    } catch {
      setLastPickedId(null);
    }
    setPickItems(
      [...ord.lineas]
        .sort((a, b) => (a.sku || "").localeCompare(b.sku || "", "en", { numeric: true }) || a.prodNom.localeCompare(b.prodNom, "en"))
        .map((l) => ({ ...l, qtyEnviada: l.qtyEnviada ?? l.qty, picked: l.picked ?? false }))
    );
  };

  const togglePicked = (idx: number) => {
    setPickItems((prev) => {
      const item = prev[idx];
      if (item && !item.picked && picking) {
        try { localStorage.setItem(`ph_lastpick_${picking.id}`, item.prodId); } catch { /* ignore */ }
      }
      return prev.map((it, i) => (i === idx ? { ...it, picked: !it.picked } : it));
    });
    setPickDirty(true);
  };

  const setQtyEnviada = (idx: number, qty: number) => {
    setPickItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, qtyEnviada: Math.max(0, Math.min(qty, it.qty)) } : it
      )
    );
    setPickDirty(true);
  };

  // Al cerrar el pick sin completar, guardar el progreso automaticamente para
  // no perder lo ya cotejado. Si hay algo pickeado, la orden pasa a In Progress.
  const cerrarPick = async () => {
    if (!picking) return;
    if (pickDirty && picking.estado !== "Completed") {
      const nuevoEstado =
        pickItems.some((i) => i.picked) && picking.estado === "Pending" ? "In Progress" : picking.estado;
      try {
        await updateOrden(picking.id, { ...picking, lineas: pickItems, estado: nuevoEstado });
      } catch (err) {
        console.error("[v0] No se pudo guardar el progreso del pick:", err);
      }
    }
    setPicking(null);
  };

  // Al reabrir el pick, llevar la vista hasta el ultimo producto pickeado.
  useEffect(() => {
    if (!picking) return;
    const t = setTimeout(() => lastPickedRef.current?.scrollIntoView({ block: "center" }), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking?.id]);

  const completePick = async () => {
    if (!picking || completing) return;
    setCompleting(true);
    try {
      const lineasFinal = pickItems.map(({ picked, ...rest }) => rest);
      // Al pasar a Completed, updateOrden libera las reservas de la orden;
      // aqui solo falta descontar del stock lo que realmente salio del almacen.
      await updateOrden(picking.id, { ...picking, lineas: lineasFinal, estado: "Completed" });
      await ajustarInventario(
        pickItems.map((it) => ({ prodId: it.prodId, deltaStock: -(it.qtyEnviada ?? it.qty) }))
      );

      // Genera la factura solo con lo que realmente se envio (cantidad enviada > 0)
      const facturaLineas: LineaFactura[] = pickItems
        .filter((it) => (it.qtyEnviada ?? it.qty) > 0)
        .map((it) => ({
          prodNom: it.prodNom,
          sku: it.sku,
          barcode: it.barcode,
          qty: it.qtyEnviada ?? it.qty,
          precio: it.precioFinal ?? it.precio,
          precioOriginal: it.precio,
          // Precio de catalogo puro (sin lista de precios): permite que la
          // factura ofrezca mostrar el descuento de lista como opcional.
          // Ordenes viejas sin el campo caen al precio actual del producto.
          precioCatalogo: it.precioCatalogo ?? productos.find((p) => p.id === it.prodId)?.precio,
          almacen: it.almacen || "palmhills",
        }));
      const facturaTotal = facturaLineas.reduce((acc, l) => acc + l.qty * l.precio, 0);
      const cInfo = clienteFor(picking.cli);
      await addFactura({
        cli: cInfo?.nom || picking.cli,
        fecha: today(),
        estado: "Pending",
        total: +facturaTotal.toFixed(2),
        lineas: facturaLineas,
        orden_id: picking.id,
      });

      // Genera remito SOLO para productos de Castillo (constancia de retiro)
      const lineasCastillo = pickItems.filter((it) => it.almacen === "castillo" && (it.qtyEnviada ?? it.qty) > 0);
      if (lineasCastillo.length > 0) {
        const remitoCastilloLineas = lineasCastillo.map((it) => ({
          prodId: it.prodId,
          prodNom: it.prodNom,
          barcode: it.barcode,
          sku: it.sku,
          precio: it.precioFinal ?? it.precio,
          precioFinal: it.precioFinal,
          qty: it.qtyEnviada ?? it.qty,
          qtyEnviada: it.qtyEnviada ?? it.qty,
          picked: true,
          almacen: "castillo" as const,
        }));
        const remitoCastilloTotal = remitoCastilloLineas.reduce((acc, l) => acc + l.qty * l.precio, 0);
        await addRemito({
          orden_id: picking.id,
          orden_num: picking.num,
          cli: cInfo?.nom || picking.cli,
          fecha: today(),
          lineas: remitoCastilloLineas,
          enviado: false,
          total: +remitoCastilloTotal.toFixed(2),
        });
      }

      try { localStorage.removeItem(`ph_lastpick_${picking.id}`); } catch { /* ignore */ }
      setPicking(null);
    } catch (err) {
      alert(
        `Could not complete the order: ${err instanceof Error ? err.message : String(err)}. Please try again.`
      );
    } finally {
      setCompleting(false);
    }
  };

  // Cuanto de cada almacen ya esta totalmente cotejado, para habilitar "Sacada parcialmente"
  const pickAlmacenCompleto = (almacen: "palmhills" | "castillo") => {
    const items = pickItems.filter((i) => (i.almacen || "palmhills") === almacen);
    return items.length > 0 && items.every((i) => i.picked);
  };

  const puedeGuardarParcial = pickAlmacenCompleto("palmhills") || pickAlmacenCompleto("castillo");

  const guardarParcial = async () => {
    if (!picking || !puedeGuardarParcial) return;
    try {
      await updateOrden(picking.id, { ...picking, lineas: pickItems, estado: "In Progress" });
      setPicking(null);
    } catch (err) {
      alert(`Could not save progress: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteOrden = async (ord: Orden) => {
    if (
      confirm(
        `Delete order #${ord.num}? This action cannot be undone and the order cannot be recovered.`
      )
    ) {
      try {
        await deleteOrden(ord.id);
      } catch (err) {
        alert("Error deleting order: " + (err instanceof Error ? err.message : String(err)));
      }
    }
  };

  const startEdit = (ord: Orden) => {
    setMenuOpenId(null);
    setEditingOrden(ord);
    setEditCli(ord.cli);
    setEditCliSearch(clienteFor(ord.cli)?.nom || ord.cli);
    setEditCliOpen(false);
    setEditForm({ fecha: ord.fecha, estado: ord.estado });
    setEditSearch("");
    // Arrancar en el almacen de la orden: si el toggle queda en un almacen
    // que no es el de las lineas, la busqueda "no encuentra" los productos.
    const almacenes = new Set((ord.lineas || []).map((l) => (l.almacen === "castillo" ? "castillo" : "palmhills") as const));
    setEditAlmacen(almacenes.size === 1 ? [...almacenes][0] : almacenes.size > 1 ? "all" : "palmhills");
    setEditandoDescuentoId(null);
    const initialQtys: Record<string, number> = {};
    const initialPrecios: Record<string, number> = {};
    (ord.lineas || []).forEach((l) => {
      initialQtys[l.prodId] = l.qty;
      initialPrecios[l.prodId] = l.precioFinal ?? l.precio;
    });
    setEditQtys(initialQtys);
    setEditPrecios(initialPrecios);
    // Productos ya en la orden primero, luego el resto ordenado por codigo (SKU)
    const sorted = [...productos].sort((a, b) => {
      const aTiene = initialQtys[a.id] > 0 ? 0 : 1;
      const bTiene = initialQtys[b.id] > 0 ? 0 : 1;
      if (aTiene !== bTiene) return aTiene - bTiene;
      return (
        (a.sku || "").localeCompare(b.sku || "", "en", { numeric: true }) ||
        a.nom.localeCompare(b.nom, "en")
      );
    });
    setEditProductOrder(sorted.map((p) => p.id));
  };

  const setEditQty = (prodId: string, qty: number) => {
    setEditQtys((prev) => {
      const next = { ...prev };
      if (!qty || qty <= 0) {
        delete next[prodId];
      } else {
        next[prodId] = qty;
      }
      return next;
    });
  };

  const setEditPrecio = (prodId: string, precio: number) => {
    setEditPrecios((prev) => ({ ...prev, [prodId]: Math.max(0, precio) }));
  };

  const quitarEditPrecio = (prodId: string) => {
    setEditPrecios((prev) => {
      const next = { ...prev };
      delete next[prodId];
      return next;
    });
  };

  // Lista de precios del cliente de la orden en edicion: pisa el precio base
  // de los productos que se agreguen; el ajuste manual (editPrecios) va encima.
  const editListaPrecios = useMemo(() => {
    const c = clienteFor(editCli);
    if (!c?.lista_precio_id) return {} as Record<string, number>;
    return listasPrecios.find((lp) => lp.id === c.lista_precio_id)?.precios || {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCli, clientes, listasPrecios]);
  const editPrecioBase = (p: Producto) => editListaPrecios[p.id] ?? Number(p.precio);

  const editProductosOrdenados = editProductOrder
    .map((id) => productos.find((p) => p.id === id))
    .filter((p): p is Producto => !!p);

  const editProductosFiltrados = (() => {
    const porAlmacen = editAlmacen === "all" ? editProductosOrdenados : editProductosOrdenados.filter((p) => (p.almacen || "palmhills") === editAlmacen);
    if (!editSearch.trim()) return porAlmacen;
    return flexibleSearch(
      porAlmacen,
      editSearch,
      (p) => [p.nom, p.sku, p.barcode, ...(p.etiquetas || [])].filter(Boolean).join(" "),
      (p) => p.nom
    );
  })();

  const {
    visible: editProductosVisibles,
    hasMore: editHasMore,
    remaining: editRemaining,
    loadMore: editLoadMore,
  } = usePagedList(editProductosFiltrados, [editSearch, editAlmacen]);

  const editTotalUnidades = Object.values(editQtys).reduce((a, b) => a + b, 0);
  const editTotal = editProductosOrdenados.reduce(
    (acc, p) => acc + (editQtys[p.id] || 0) * (editPrecios[p.id] ?? editPrecioBase(p)),
    0
  );

  const handleSaveEdit = async () => {
    if (!editingOrden) return;
    const items = Object.entries(editQtys).filter(([, qty]) => qty > 0);
    if (items.length === 0) {
      alert("Add at least one product");
      return;
    }
    const lineasDetalle = items.map(([prodId, qty]) => {
      const p = productos.find((x) => x.id === prodId);
      if (!p) {
        console.error("[v0] Producto no encontrado:", prodId);
        return null;
      }
      const precioFinal = editPrecios[prodId] ?? editPrecioBase(p);
      // Preserve pick progress for products that were already in the order
      const lineaExistente = (editingOrden.lineas || []).find((l) => l.prodId === prodId);
      return {
        prodId: p.id,
        prodNom: p.nom,
        barcode: p.barcode || "",
        sku: p.sku || "",
        precio: editPrecioBase(p),
        precioFinal,
        precioCatalogo: Number(p.precio),
        qty,
        qtyEnviada: lineaExistente ? Math.min(lineaExistente.qtyEnviada ?? lineaExistente.qty, qty) : qty,
        picked: lineaExistente?.picked ?? false,
        almacen: p.almacen || "palmhills",
      };
    }).filter((l): l is NonNullable<typeof l> => l !== null);
    
    if (lineasDetalle.length === 0) {
      alert("Could not find products to save");
      return;
    }

    try {
      await updateOrden(editingOrden.id, {
        ...editingOrden,
        cli: editCli,
        fecha: editForm.fecha,
        estado: editForm.estado,
        total: +editTotal.toFixed(2),
        lineas: lineasDetalle,
      });
      setEditingOrden(null);
    } catch (error) {
      console.error("[v0] Error guardando orden:", error);
      alert("Error saving order: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const ordenesOrdenadas = [...ordenes].sort((a, b) => {
    const aDone = a.estado === "Completed" ? 1 : 0;
    const bDone = b.estado === "Completed" ? 1 : 0;
    return aDone - bDone;
  });

  const draftOrdenes = useMemo(() => {
    if (typeof window === "undefined") return [];
    const drafts: { clienteId: string; clienteNom: string; fecha: string; total: number; itemCount: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("ph_draft_orden_")) continue;
      const clienteId = key.replace("ph_draft_orden_", "");
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const draft = JSON.parse(raw) as { cantidades: Record<string, number>; descuentos: Record<string, number>; fecha: string };
        if (!draft.cantidades || Object.keys(draft.cantidades).length === 0) continue;
        const c = clientes.find((cl) => cl.id === clienteId);
        const itemCount = Object.values(draft.cantidades).reduce((s, q) => s + q, 0);
        drafts.push({ clienteId, clienteNom: c?.nom ?? "Unknown client", fecha: draft.fecha, total: 0, itemCount });
      } catch { /* skip malformed */ }
    }
    return drafts;
  }, [clientes]);

  const {
    visible: ordenesVisibles,
    hasMore: ordenesHasMore,
    remaining: ordenesRemaining,
    loadMore: ordenesLoadMore,
  } = usePagedList(ordenesOrdenadas, []);

  return (
    <div>
      {!readOnly && <AddPillButton className={ADD_PILL_POS} aria-label="New order" onClick={() => { setShowClientPicker(true); setPickerSearch(""); }} />}
      {draftOrdenes.length > 0 && (
        <div className="mb-3 space-y-2">
          {draftOrdenes.map((d) => (
            <button
              key={d.clienteId}
              onClick={() => router.push(`/clientes/${d.clienteId}/nueva-orden`)}
              className="w-full flex items-center justify-between gap-3 bg-amber-50 border border-amber-300 rounded-xl px-3.5 py-2.5 text-left"
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-amber-700 truncate">{d.clienteNom}</div>
                <div className="text-[11px] text-amber-600">Draft · {d.itemCount} item{d.itemCount !== 1 ? "s" : ""}{d.fecha ? ` · ${fdate(d.fecha)}` : ""}</div>
              </div>
              <span className="text-amber-500 shrink-0 font-bold text-sm">Continue →</span>
            </button>
          ))}
        </div>
      )}
      <div className="bg-card rounded-3xl p-3.5 border border-border">
        {ordenesOrdenadas.length ? (
          ordenesVisibles.map((o) => {
            const cInfo = clienteFor(o.cli);
            return (
            <Li
              key={o.id}
              left={
                <>
                  <div className="flex items-center gap-1.5">
                    <div className="text-sm font-semibold truncate uppercase text-card-foreground">
                      {cInfo ? cInfo.nom : o.cli}
                    </div>
                    {!readOnly && (
                      <div className="relative shrink-0">
                        <button
                          onClick={() => setMenuOpenId(menuOpenId === o.id ? null : o.id)}
                          aria-label="Edit or delete order"
                          className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-card-foreground hover:bg-muted"
                        >
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                        {menuOpenId === o.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                            <div className="absolute left-0 top-7 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[160px]">
                              {o.estado === "Completed" ? (
                                <div className="px-3.5 py-2.5 text-[11px] text-muted-foreground leading-snug">
                                  Can't be edited: the invoice has already been generated.
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEdit(o)}
                                  className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm text-card-foreground hover:bg-muted text-left"
                                >
                                  ✏️ Edit
                                </button>
                              )}
                              <div className="h-px bg-border mx-2" />
                              <button
                                onClick={() => {
                                  setMenuOpenId(null);
                                  handleDeleteOrden(o);
                                }}
                                className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm text-destructive hover:bg-red-50 text-left"
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {cInfo?.codigo_cliente ? `#${cInfo.codigo_cliente} · ` : ""}
                    Order #{o.num} - {fdate(o.fecha)}
                  </div>
                </>
              }
              right={
                <>
                  <div className="text-sm font-bold mb-0.5 text-card-foreground">
                    {fmt(
                      o.lineas?.length
                        ? o.lineas.reduce((acc, l) => acc + l.qty * (l.precioFinal ?? l.precio), 0)
                        : o.total
                    )}
                  </div>
                  <Badge e={o.estado} />
                  <br />
                  <button
                    className="mt-1.5 px-3 py-1.5 rounded-lg backdrop-blur-md bg-white/50 border border-white/60 text-[#4a6741] text-xs font-bold"
                    onClick={() => router.push(`/ordenes/${o.id}/estimado`)}
                  >
                    📋 Estimate
                  </button>
                  {o.estado !== "Completed" && !readOnly && (
                    <>
                      <br />
                      <button
                        className="mt-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground border border-primary text-xs font-bold"
                        onClick={() => startPick(o)}
                      >
                        📦 PICK
                      </button>
                    </>
                  )}
                </>
              }
            />
            );
          })
        ) : (
          <Empty text="No orders. Tap + to create one." />
        )}
      </div>
      <LoadMoreButton hasMore={ordenesHasMore} remaining={ordenesRemaining} onClick={ordenesLoadMore} />

      {showClientPicker && !readOnly && (
        <Modal title="New Order — Select Client" onClose={() => setShowClientPicker(false)}>
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search client..."
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {clientes
              .filter((c) => !pickerSearch.trim() || c.nom.toLowerCase().includes(pickerSearch.toLowerCase()) || (c.codigo_cliente || "").includes(pickerSearch))
              .slice(0, 60)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setShowClientPicker(false); router.push(`/clientes/${c.id}/nueva-orden`); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-muted"
                >
                  {c.codigo_cliente && <span className="block text-[11px] font-black font-mono text-primary leading-tight">{c.codigo_cliente}</span>}
                  <span className="text-sm text-card-foreground font-medium">{c.nom}</span>
                </button>
              ))}
          </div>
        </Modal>
      )}

      {editingOrden && (
        <div className="fixed inset-0 bg-background z-40 flex flex-col max-w-[480px] mx-auto">
          <div
            className="bg-primary p-3.5 flex items-center gap-3 shrink-0"
            style={{ paddingTop: "calc(0.875rem + env(safe-area-inset-top))" }}
          >
            <button
              onClick={() => setEditingOrden(null)}
              className="bg-white/20 border-none text-white text-lg cursor-pointer rounded-full w-8 h-8 flex items-center justify-center"
            >
              X
            </button>
            <div className="flex-1 relative">
              <span className="text-white text-base font-bold block">Edit Order #{editingOrden.num}</span>
              <div className="relative">
                <input
                  type="text"
                  value={editCliSearch}
                  onChange={(e) => {
                    setEditCliSearch(e.target.value);
                    setEditCliOpen(true);
                  }}
                  onFocus={() => setEditCliOpen(true)}
                  placeholder="Search client..."
                  className="w-full bg-white/20 text-white placeholder-white/60 text-xs rounded-lg px-2 py-1 pr-6 outline-none border border-white/30 focus:border-white/60"
                />
                {editCliSearch && (
                  <button onClick={() => { setEditCliSearch(""); setEditCli(""); setEditCliOpen(false); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-base leading-none">×</button>
                )}
              </div>
              {editCliOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setEditCliOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto min-w-[200px]">
                    {clientes
                      .filter((c) => !editCliSearch.trim() || c.nom.toLowerCase().includes(editCliSearch.toLowerCase()) || (c.codigo_cliente || "").toLowerCase().includes(editCliSearch.toLowerCase()))
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setEditCli(c.id);
                            setEditCliSearch(c.nom);
                            setEditCliOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-muted ${editCli === c.id ? "bg-muted/50" : ""}`}
                        >
                          {c.codigo_cliente && <span className="block text-[11px] font-black font-mono text-primary leading-tight">{c.codigo_cliente}</span>}
                          <span className={`text-sm ${editCli === c.id ? "font-bold text-primary" : "text-card-foreground"}`}>{c.nom}</span>
                        </button>
                      ))}
                    {clientes.filter((c) => !editCliSearch.trim() || c.nom.toLowerCase().includes(editCliSearch.toLowerCase()) || (c.codigo_cliente || "").toLowerCase().includes(editCliSearch.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No clients found</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex gap-2 mb-3">
              <select
                value={editForm.fecha}
                onChange={(e) => setEditForm({ ...editForm, fecha: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {/* Si la orden ya tenia una fecha que no esta entre los dias marcados
                    (ej. quedo asignada antes de este sistema), se incluye igual para
                    no perderla al abrir el formulario. */}
                {Array.from(new Set([editForm.fecha, ...proximasFechasEntrega]))
                  .filter(Boolean)
                  .sort()
                  .map((f) => (
                    <option key={f} value={f}>
                      {fdate(f)}
                    </option>
                  ))}
              </select>
              <select
                value={editForm.estado}
                onChange={(e) => setEditForm({ ...editForm, estado: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option>Pending</option>
                <option>In Progress</option>
                <option>Completed</option>
                <option>Cancelled</option>
              </select>
            </div>
            <div className="inline-flex backdrop-blur-md bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5 mb-3">
              <button
                onClick={() => setEditAlmacen("all")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                  editAlmacen === "all" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setEditAlmacen("palmhills")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                  editAlmacen === "palmhills" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                🌴 Palm Hills
              </button>
              <button
                onClick={() => setEditAlmacen("castillo")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                  editAlmacen === "castillo" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                🏰 Castillo
              </button>
            </div>
            <div className="relative mb-3">
              <input
                type="search"
                inputMode="search"
                placeholder="Search by name, SKU or barcode"
                value={editSearch}
                onChange={(e) => setEditSearch(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
              {editSearch && <button onClick={() => setEditSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button>}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {editProductosVisibles.length ? (
                editProductosVisibles.map((p) => {
                  const qty = editQtys[p.id] || 0;
                  return (
                    <div
                      key={p.id}
                      className={`bg-card border rounded-3xl p-3 flex flex-col h-full ${
                        qty > 0 ? "border-primary" : "border-border"
                      }`}
                    >
                      <div className="w-full aspect-square rounded-lg bg-white flex items-center justify-center text-2xl mb-2 shrink-0">
                        {p.foto ? (
                          <img src={p.foto || "/placeholder.svg"} alt={p.nom} loading="lazy" className="w-full h-full object-contain" />
                        ) : (
                          p.icon || "📦"
                        )}
                      </div>
                      <div className="text-xs font-bold mb-1 text-card-foreground leading-snug break-words min-h-[2.25rem] uppercase">
                        {p.nom}
                      </div>
                      {p.sku && (
                        <div className="text-xs text-muted-foreground font-mono mb-0.5 break-all">{p.sku}</div>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        {editPrecios[p.id] !== undefined && editPrecios[p.id] !== editPrecioBase(p) ? (
                          <>
                            <span className="text-xs text-muted-foreground line-through">{fmt(editPrecioBase(p))}</span>
                            <span className="text-sm font-bold text-primary">{fmt(editPrecios[p.id])}</span>
                          </>
                        ) : editListaPrecios[p.id] !== undefined ? (
                          <span className="text-sm font-bold text-[#b09060]">{fmt(editPrecioBase(p))}</span>
                        ) : (
                          <span className="text-sm font-bold text-secondary-foreground">{fmt(p.precio)}</span>
                        )}
                      </div>

                      {editandoDescuentoId === p.id ? (
                        <div className="mt-1.5">
                          <label className="text-[10px] text-muted-foreground block mb-1">Price for this order</label>
                          <MoneyInput
                            value={editPrecios[p.id] ?? editPrecioBase(p)}
                            onChange={(n) => setEditPrecio(p.id, n)}
                            autoFocus
                            onBlur={() => setEditandoDescuentoId(null)}
                            onKeyDown={(e) => { if (e.key === "Enter") setEditandoDescuentoId(null); }}
                            className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-card-foreground text-sm text-center font-bold"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditandoDescuentoId(p.id)}
                          className="mt-1.5 text-[11px] font-medium text-primary underline self-start"
                        >
                          🏷️ Apply discount
                        </button>
                      )}
                      {editPrecios[p.id] !== undefined && (
                        <button
                          onClick={() => quitarEditPrecio(p.id)}
                          className="mt-1 text-[11px] text-destructive underline self-start"
                        >
                          Remove discount
                        </button>
                      )}

                      <div className="mt-2 pt-2 border-t border-border">
                        <label className="text-[10px] text-muted-foreground block mb-1">Quantity</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          placeholder="0"
                          value={qty || ""}
                          onChange={(e) => setEditQty(p.id, Number(e.target.value))}
                          className="w-full px-2 py-2 rounded-lg border border-input bg-background text-card-foreground text-base text-center font-bold"
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="col-span-2 text-center text-muted-foreground py-10 text-sm">
                  No products found
                </div>
              )}
            </div>
            <LoadMoreButton hasMore={editHasMore} remaining={editRemaining} onClick={editLoadMore} />
          </div>
          <div className="backdrop-blur-xl bg-card/90 border-t border-border px-4 py-3.5 flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{editTotalUnidades} units</p>
              <p className="text-xl font-bold text-primary truncate">{fmt(editTotal)}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setEditingOrden(null)}
                className="px-4 py-2.5 rounded-full bg-card border border-border text-card-foreground font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-bold text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 bg-background z-40 flex flex-col max-w-[480px] mx-auto">
          <div
            className="bg-primary p-3.5 flex items-center gap-3 shrink-0"
            style={{ paddingTop: "calc(0.875rem + env(safe-area-inset-top))" }}
          >
            <button
              onClick={cerrarPick}
              className="bg-white/20 border-none text-white text-lg cursor-pointer rounded-full w-8 h-8 flex items-center justify-center"
            >
              X
            </button>
            <div className="flex-1 min-w-0">
              <span className="text-white text-base font-bold block truncate uppercase">
                Order #{picking.num} · {clienteFor(picking.cli)?.nom || picking.cli}
              </span>
              <span className="text-white/80 text-xs">
                {pickItems.filter((i) => i.picked).length}/{pickItems.length} products confirmed
              </span>
            </div>
          </div>
          <div className="px-4 pt-3 pb-2 shrink-0 bg-background">
            <div className="bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width: `${pickItems.length ? (pickItems.filter((i) => i.picked).length / pickItems.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <div className="px-4 pb-2 shrink-0 flex justify-center">
            <div className="inline-flex backdrop-blur-md bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5">
              {(["todos", "palmhills", "castillo"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setPickAlmacen(a)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                    pickAlmacen === a ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {a === "todos" ? "All" : a === "palmhills" ? "🌴 Palm Hills" : "🏰 Castillo"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 pt-0">
            <div className="flex flex-col gap-2.5">
              {pickItems
                .map((item, i) => ({ item, i }))
                .filter(
                  ({ item }) => pickAlmacen === "todos" || (item.almacen || "palmhills") === pickAlmacen
                )
                .map(({ item, i }) => {
                const prod = productos.find((p) => p.id === item.prodId);
                const qtyEnviada = item.qtyEnviada ?? item.qty;
                const missing = qtyEnviada === 0;
                const parcial = qtyEnviada > 0 && qtyEnviada < item.qty;
                const esUltimoPickeado = !!lastPickedId && item.prodId === lastPickedId;
                return (
                  <div
                    key={i}
                    ref={esUltimoPickeado ? lastPickedRef : undefined}
                    // Los ya pickeados bajan al fondo con CSS `order` (no
                    // reordenando el DOM via key/posicion) — reordenar nodos
                    // reales dentro de un contenedor con scroll activo es un
                    // disparador conocido del freeze de iOS donde la barra de
                    // scroll se mueve pero la pantalla no repinta.
                    style={{ order: item.picked ? 1 : 0 }}
                    className={`bg-card border rounded-3xl p-3 flex items-center gap-3 ${item.picked ? "border-primary" : "border-border"} ${esUltimoPickeado ? "ring-2 ring-amber-300" : ""}`}
                  >
                    <button
                      onClick={() => togglePicked(i)}
                      aria-label={item.picked ? "Mark as pending" : "Mark as picked"}
                      className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center backdrop-blur-md border transition-all active:scale-90 ${
                        item.picked
                          ? "bg-primary/80 border-white/40 shadow-md"
                          : "bg-white/30 border-border hover:bg-white/50"
                      }`}
                    >
                      <svg
                        width={18}
                        height={18}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={item.picked ? "white" : "transparent"}
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="transition-opacity"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center text-xl shrink-0 overflow-hidden border border-border">
                      {prod?.foto ? (
                        <img
                          src={prod.foto || "/placeholder.svg"}
                          alt={item.prodNom}
                          loading="lazy"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        prod?.icon || "📦"
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {item.sku && (
                        <div className="text-sm font-bold font-mono text-primary leading-tight">{item.sku}</div>
                      )}
                      <div className="text-xs text-card-foreground leading-snug break-words mt-0.5 uppercase">
                        {item.prodNom}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">Ordered: {item.qty}</div>
                      {esUltimoPickeado && (
                        <div className="text-[11px] text-amber-600 font-bold mt-0.5">⭐ Last picked</div>
                      )}
                      {missing && (
                        <div className="text-[11px] text-destructive font-bold mt-0.5">MISSING</div>
                      )}
                      {parcial && (
                        <div className="text-[11px] text-amber-600 font-medium mt-0.5">Partial shipment</div>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <button
                        onClick={() => setQtyEnviada(i, qtyEnviada - 1)}
                        className="w-7 h-7 rounded-lg bg-muted text-card-foreground font-bold flex items-center justify-center"
                      >
                        −
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        value={qtyEnviada}
                        onChange={(e) => setQtyEnviada(i, Number(e.target.value))}
                        className="w-12 px-1 py-1 rounded-lg border border-input bg-background text-card-foreground text-sm text-center font-bold"
                      />
                      <button
                        onClick={() => setQtyEnviada(i, qtyEnviada + 1)}
                        className="w-7 h-7 rounded-lg bg-muted text-card-foreground font-bold flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="backdrop-blur-xl bg-card/90 border-t border-border px-4 pt-3 shrink-0"
            style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
          >
            {!pickItems.every((i) => i.picked) && (
              <p className="text-[11px] text-amber-600 font-medium text-center mb-2">
                {puedeGuardarParcial
                  ? "You can save this warehouse's progress, or check everything to complete the order"
                  : "Check off all products to complete the order"}
              </p>
            )}
            <div className="flex gap-2 mb-2">
              <button
                onClick={cerrarPick}
                className={`flex-1 px-3 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
              >
                Close
              </button>
              <button
                onClick={guardarParcial}
                disabled={!puedeGuardarParcial}
                title={
                  !puedeGuardarParcial
                    ? "Check off all Palm Hills or all Castillo items to save progress"
                    : undefined
                }
                className="flex-1 px-3 py-2.5 rounded-full bg-amber-100 text-amber-800 font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Partially picked
              </button>
            </div>
            <button
              onClick={completePick}
              disabled={completing || !pickItems.length || !pickItems.every((i) => i.picked)}
              title={
                !pickItems.every((i) => i.picked)
                  ? "Check off all products to complete the order"
                  : undefined
              }
              className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {completing ? "Processing..." : "Complete order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ------------------------------
// Mejoras
// ------------------------------
const PRIORIDADES = ["High", "Medium", "Low"];
const ESTADOS_MEJORA = ["Pending", "In Progress", "Completed"];
const PRIO_ORDER: Record<string, number> = { Alta: 0, Media: 1, Baja: 2 };

// Game-style "upgrade" icon: a stocked shelving rack (trameria) with a
// plus badge in the corner, or a check badge when the improvement is done.
const UpgradeIcon = ({ done = false }: { done?: boolean }) => (
  <div
    aria-hidden="true"
    className={`relative shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center ${
      done
        ? "bg-green-100 border-green-200 text-green-700"
        : "bg-secondary border-border text-secondary-foreground"
    }`}
  >
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* uprights */}
      <path d="M5 4v16M19 4v16" />
      {/* shelves */}
      <path d="M5 4h14M5 10h14M5 16h14" />
      {/* boxes on shelves */}
      <rect x="7.5" y="5.5" width="3" height="3" rx="0.4" />
      <rect x="13.5" y="11.5" width="3" height="3" rx="0.4" />
    </svg>
    <span
      className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-primary-foreground shadow ${
        done ? "bg-green-600" : "bg-primary"
      }`}
    >
      <svg
        width={12}
        height={12}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {done ? (
          <polyline points="20 6 9 17 4 12" />
        ) : (
          <path d="M12 5v14M5 12h14" />
        )}
      </svg>
    </span>
  </div>
);

const Mejoras = () => {
  const { mejoras, addMejora, updateMejora, deleteMejora, readOnly } = useData();
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    titulo: "",
    descripcion: "",
    costo: "",
    prioridad: "Medium",
    estado: "Pending",
  });

  // Pending improvements (not completed), sorted by priority
  const pendientes = useMemo(
    () =>
      mejoras
        .filter((m) => m.estado !== "Completed")
        .sort(
          (a, b) =>
            (PRIO_ORDER[a.prioridad] ?? 1) - (PRIO_ORDER[b.prioridad] ?? 1)
        ),
    [mejoras]
  );
  const completadas = useMemo(
    () => mejoras.filter((m) => m.estado === "Completed"),
    [mejoras]
  );
  const costoTotal = useMemo(
    () =>
      mejoras
        .filter((m) => m.estado !== "Completed")
        .reduce((sum, m) => sum + Number(m.costo || 0), 0),
    [mejoras]
  );

  const {
    visible: pendientesVisibles,
    hasMore: pendientesHasMore,
    remaining: pendientesRemaining,
    loadMore: pendientesLoadMore,
  } = usePagedList(pendientes, []);
  const {
    visible: completadasVisibles,
    hasMore: completadasHasMore,
    remaining: completadasRemaining,
    loadMore: completadasLoadMore,
  } = usePagedList(completadas, []);

  const reset = () => {
    setForm({
      titulo: "",
      descripcion: "",
      costo: "",
      prioridad: "Medium",
      estado: "Pending",
    });
    setEditId(null);
  };

  const openNew = () => {
    reset();
    setShow(true);
  };

  const openEdit = (m: Mejora) => {
    setEditId(m.id);
    setForm({
      titulo: m.titulo || "",
      descripcion: m.descripcion || "",
      costo: m.costo ? String(m.costo) : "",
      prioridad: m.prioridad || "Medium",
      estado: m.estado || "Pending",
    });
    setShow(true);
  };

  const handleSave = async () => {
    if (!form.titulo.trim()) {
      alert("Enter the improvement title");
      return;
    }
    const payload = {
      titulo: form.titulo,
      descripcion: form.descripcion,
      costo: Number(form.costo),
      prioridad: form.prioridad,
      estado: form.estado,
    };
    try {
      if (editId) await updateMejora(editId, payload);
      else await addMejora(payload);
      reset();
      setShow(false);
    } catch (err) {
      alert("Error saving: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const card = (m: Mejora) => (
    <div
      key={m.id}
      className="bg-card border border-border rounded-3xl p-3.5 mb-2.5"
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-card-foreground text-pretty break-words mb-1.5">
            {m.titulo}
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge e={m.prioridad} />
            <Badge e={m.estado} />
          </div>
        </div>
        <UpgradeIcon done={m.estado === "Completed"} />
      </div>
      {m.descripcion && (
        <div className="text-xs text-muted-foreground leading-relaxed break-words mb-2">
          {m.descripcion}
        </div>
      )}
      <div className="flex items-center justify-between gap-2.5">
        <div className="text-sm font-bold text-secondary-foreground">
          {Number(m.costo) > 0 ? `Est. cost: ${fmt(Number(m.costo))}` : "No estimated cost"}
        </div>
        {!readOnly && (
          <div className="flex gap-1.5">
            <button
              className="px-2.5 py-1 rounded-lg bg-card border border-border text-secondary-foreground text-xs font-bold"
              onClick={() => openEdit(m)}
            >
              Edit
            </button>
            <button
              className="px-2.5 py-1 rounded-lg backdrop-blur-md bg-red-50/80 border border-red-200/60 text-destructive text-xs font-bold"
              onClick={async () => {
                if (confirm("Delete this improvement?")) {
                  try { await deleteMejora(m.id); }
                  catch (err) { alert("Error deleting: " + (err instanceof Error ? err.message : String(err))); }
                }
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 mb-3.5">
        <div className="bg-card rounded-xl p-3.5 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Pending improvements</div>
          <div className="text-xl font-bold text-card-foreground">{pendientes.length}</div>
        </div>
        <div className="bg-card rounded-xl p-3.5 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Estimated investment</div>
          <div className="text-xl font-bold text-card-foreground">{fmt(costoTotal)}</div>
        </div>
      </div>

      {!readOnly && <AddPillButton className={ADD_PILL_POS} aria-label="Add improvement" onClick={openNew} />}

      {mejoras.length === 0 ? (
        <div className="bg-card rounded-3xl p-3.5 border border-border">
          <Empty text="No improvements yet. Tap + to add an idea for the business." />
        </div>
      ) : (
        <>
          {pendientesVisibles.map(card)}
          <LoadMoreButton
            hasMore={pendientesHasMore}
            remaining={pendientesRemaining}
            onClick={pendientesLoadMore}
          />
          {completadas.length > 0 && (
            <>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mt-4 mb-2">
                Completed
              </div>
              {completadasVisibles.map(card)}
              <LoadMoreButton
                hasMore={completadasHasMore}
                remaining={completadasRemaining}
                onClick={completadasLoadMore}
              />
            </>
          )}
        </>
      )}

      {show && !readOnly && (
        <Modal
          title={editId ? "Edit Improvement" : "New Improvement"}
          onClose={() => {
            reset();
            setShow(false);
          }}
        >
          <Field label="Improvement *">
            <input
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder="E.g. Buy a van"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Description / notes">
            <textarea
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              rows={3}
              placeholder="Details, justification, suppliers, etc."
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </Field>
          <Field label="Estimated cost ($)">
            <MoneyInput
              value={Number(form.costo) || 0}
              onChange={(n) => setForm({ ...form, costo: String(n) })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Row2>
            <Field label="Priority">
              <select
                value={form.prioridad}
                onChange={(e) => setForm({ ...form, prioridad: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              >
                {ESTADOS_MEJORA.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </Row2>
          <div className="flex gap-2.5 mt-3.5">
            <button
              onClick={() => {
                reset();
                setShow(false);
              }}
              className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY}`}
            >
              {editId ? "Save Changes" : "Save Improvement"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ------------------------------
// Compras (Ingresado de Inventario)
// ------------------------------
const Compras = () => {
  const { compras, productos, addCompra, deleteCompra, readOnly } = useData();
  const [show, setShow] = useState(false);
  const [detalle, setDetalle] = useState<Compra | null>(null);
  const [saving, setSaving] = useState(false);
  const [proveedor, setProveedor] = useState("");
  const [numFacturaProveedor, setNumFacturaProveedor] = useState("");
  const [fecha, setFecha] = useState(today());
  const [nota, setNota] = useState("");
  const [lineas, setLineas] = useState<LineaCompra[]>([]);
  const [prodSearch, setProdSearch] = useState("");
  const [prodOpen, setProdOpen] = useState(false);
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [comprobanteNombre, setComprobanteNombre] = useState("");
  const [subiendoComprobante, setSubiendoComprobante] = useState(false);

  const comprasOrdenadas = useMemo(() => [...compras].sort((a, b) => b.num - a.num), [compras]);
  const { visible, hasMore, remaining, loadMore } = usePagedList(comprasOrdenadas, []);

  const sugeridos = useMemo(() => {
    if (!prodSearch.trim()) return [];
    return flexibleSearch(productos, prodSearch, (p) => [p.nom, p.sku, p.barcode, p.fabricante].filter(Boolean).join(" "), (p) => p.nom).slice(0, 20);
  }, [productos, prodSearch]);

  const reset = () => {
    setProveedor("");
    setNumFacturaProveedor("");
    setFecha(today());
    setNota("");
    setLineas([]);
    setProdSearch("");
    setComprobante(null);
    setComprobanteNombre("");
  };

  // Foto: se reduce (mismo compresor que el comprobante de pago de gastos).
  // PDF/Excel: se guardan tal cual, no hay forma practica de comprimirlos en
  // el navegador.
  const handleComprobanteUpload = async (file: File | undefined) => {
    if (!file) return;
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      alert("That file is too large (max 5MB). Try a smaller photo or a compressed PDF.");
      return;
    }
    setSubiendoComprobante(true);
    try {
      if (file.type.startsWith("image/")) {
        setComprobante(await compressComprobante(file));
      } else {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        setComprobante(dataUrl);
      }
      setComprobanteNombre(file.name);
    } catch {
      alert("Could not read that file");
    } finally {
      setSubiendoComprobante(false);
    }
  };

  const agregarProducto = (p: Producto) => {
    if (lineas.some((l) => l.prodId === p.id)) {
      setProdSearch("");
      setProdOpen(false);
      return;
    }
    setLineas((prev) => [
      ...prev,
      { prodId: p.id, prodNom: p.nom, sku: p.sku, qty: 1, costoUnitario: Number(p.costo) || 0, almacen: p.almacen || "palmhills" },
    ]);
    setProdSearch("");
    setProdOpen(false);
  };

  const setLineaQty = (prodId: string, qty: number) =>
    setLineas((prev) => prev.map((l) => (l.prodId === prodId ? { ...l, qty: Math.max(0, qty) } : l)));
  const setLineaCosto = (prodId: string, costo: number) =>
    setLineas((prev) => prev.map((l) => (l.prodId === prodId ? { ...l, costoUnitario: Math.max(0, costo) } : l)));
  const quitarLinea = (prodId: string) => setLineas((prev) => prev.filter((l) => l.prodId !== prodId));

  const total = lineas.reduce((acc, l) => acc + l.qty * l.costoUnitario, 0);

  const handleSave = async () => {
    if (saving) return;
    if (!proveedor.trim()) { alert("Enter the supplier name"); return; }
    if (!fecha) { alert("Select a date"); return; }
    if (!lineas.length) { alert("Add at least one product"); return; }
    setSaving(true);
    try {
      await addCompra({
        proveedor: proveedor.trim(),
        num_factura_proveedor: numFacturaProveedor.trim() || undefined,
        fecha,
        total: +total.toFixed(2),
        lineas,
        nota: nota.trim() || undefined,
        comprobante: comprobante || undefined,
        comprobante_nombre: comprobante ? comprobanteNombre : undefined,
      });
      reset();
      setShow(false);
    } catch (err) {
      alert("Error saving: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Compra) => {
    if (!confirm(`Delete purchase #${c.num} from ${c.proveedor}? This does NOT reverse the stock/cost changes it made.`)) return;
    try {
      await deleteCompra(c.id);
      setDetalle(null);
    } catch (err) {
      alert("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div>
      <div className="bg-card rounded-3xl p-3.5 border border-border mb-3">
        <p className="text-xs text-muted-foreground">
          Record each supplier purchase invoice here: it adds the quantity to inventory and updates the product's cost, feeding the P&L report's cost of goods sold.
        </p>
      </div>
      {!readOnly && <AddPillButton className={ADD_PILL_POS} aria-label="New purchase" onClick={() => { reset(); setShow(true); }} />}

      {comprasOrdenadas.length ? (
        <div className="bg-card border border-border rounded-3xl overflow-hidden">
          {visible.map((c, i) => (
            <div
              key={c.id}
              onClick={() => setDetalle(c)}
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/30 ${i > 0 ? "border-t border-border" : ""}`}
            >
              <div className="shrink-0">
                <div className="text-xs font-mono font-semibold text-[#a3814e] whitespace-nowrap">#{String(c.num).padStart(4, "0")}</div>
                <div className="text-[11px] text-muted-foreground whitespace-nowrap">{fdate(c.fecha)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-card-foreground truncate tracking-tight">{c.proveedor}</div>
                <div className="text-[11px] text-muted-foreground truncate">{c.lineas.length} product(s)</div>
              </div>
              <div className="text-sm font-bold text-card-foreground tabular-nums shrink-0">{fmt(c.total)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card rounded-3xl p-3.5 border border-border">
          <Empty text="No purchases recorded yet. Tap + to add one." />
        </div>
      )}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={loadMore} />

      {show && (
        <Modal title="New Purchase" onClose={() => setShow(false)}>
          <Row2>
            <Field label="Supplier">
              <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Supplier name" className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Date">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
            </Field>
          </Row2>
          <Field label="Supplier invoice # (optional)">
            <input value={numFacturaProveedor} onChange={(e) => setNumFacturaProveedor(e.target.value)} placeholder="Reference number on their invoice" className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
          </Field>

          <Field label="Products">
            <div className="relative">
              <input
                value={prodSearch}
                onChange={(e) => { setProdSearch(e.target.value); setProdOpen(true); }}
                onFocus={() => setProdOpen(true)}
                onBlur={() => setTimeout(() => setProdOpen(false), 200)}
                placeholder="Search product by name, SKU or barcode..."
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
              {prodOpen && sugeridos.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                  {sugeridos.map((p) => (
                    <button key={p.id} onMouseDown={() => agregarProducto(p)} className="w-full text-left px-3 py-2 hover:bg-muted border-b border-border last:border-0">
                      <div className="text-sm font-medium text-card-foreground uppercase">{p.nom}</div>
                      <div className="text-xs text-muted-foreground">{p.sku ? `SKU: ${p.sku} · ` : ""}current cost {fmt(p.costo)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          {lineas.length > 0 && (
            <div className="border border-border rounded-3xl overflow-hidden mb-3">
              {lineas.map((l) => (
                <div key={l.prodId} className="flex items-center gap-2 px-3 py-2.5 border-b border-border last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-card-foreground uppercase break-words leading-tight">{l.prodNom}</div>
                    {l.sku && <div className="text-[10px] font-mono text-muted-foreground">{l.sku}</div>}
                  </div>
                  <div className="w-16 shrink-0">
                    <label className="text-[9px] font-bold uppercase text-muted-foreground">Qty</label>
                    <input type="number" min="0" value={l.qty} onChange={(e) => setLineaQty(l.prodId, parseInt(e.target.value) || 0)} className="w-full px-2 py-1.5 rounded-lg border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div className="w-20 shrink-0">
                    <label className="text-[9px] font-bold uppercase text-muted-foreground">Cost</label>
                    <MoneyInput value={l.costoUnitario} onChange={(n) => setLineaCosto(l.prodId, n)} className="w-full px-2 py-1.5 rounded-lg border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <button onClick={() => quitarLinea(l.prodId)} className="text-muted-foreground hover:text-destructive text-lg leading-none px-1 shrink-0">×</button>
                </div>
              ))}
            </div>
          )}

          <Field label="Note (optional)">
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Reference, delivery details..." className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
          </Field>

          <Field label="Supporting document (optional)">
            <p className="text-[11px] text-muted-foreground mb-1.5 -mt-1">Photo, PDF or Excel of the supplier's invoice — proof of what was ordered and billed.</p>
            {comprobante ? (
              <div className="flex items-center gap-2.5 border border-border rounded-xl p-2.5">
                {comprobante.startsWith("data:image/") ? (
                  <img src={comprobante} alt="Supporting document" className="w-12 h-12 rounded-lg object-cover border border-border shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-xl shrink-0" aria-hidden="true">
                    {comprobante.startsWith("data:application/pdf") ? "📕" : "📊"}
                  </div>
                )}
                <div className="flex-1 min-w-0 text-xs font-medium text-card-foreground truncate">{comprobanteNombre}</div>
                <a href={comprobante} target="_blank" rel="noreferrer" download={comprobanteNombre} className="text-xs font-bold text-primary shrink-0">View</a>
                <button onClick={() => { setComprobante(null); setComprobanteNombre(""); }} className="text-muted-foreground hover:text-destructive text-lg leading-none px-1 shrink-0">×</button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed border-border text-sm text-muted-foreground cursor-pointer">
                {subiendoComprobante ? "Uploading..." : "📎 Upload photo, PDF or Excel"}
                <input
                  type="file"
                  accept="image/*,application/pdf,.pdf,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  capture="environment"
                  className="hidden"
                  disabled={subiendoComprobante}
                  onChange={(e) => handleComprobanteUpload(e.target.files?.[0])}
                />
              </label>
            )}
          </Field>

          {lineas.length > 0 && (
            <div className="flex items-center justify-between bg-primary/10 rounded-xl px-4 py-2.5 mb-3">
              <span className="text-sm font-bold text-card-foreground">Total</span>
              <span className="text-lg font-black text-primary">{fmt(total)}</span>
            </div>
          )}

          <button
            disabled={saving || !proveedor.trim() || !lineas.length}
            onClick={handleSave}
            className={`w-full px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
          >
            {saving ? "Saving..." : "Save Purchase"}
          </button>
        </Modal>
      )}

      {detalle && (
        <Modal title={`Purchase #${String(detalle.num).padStart(4, "0")}`} onClose={() => setDetalle(null)}>
          <div className="text-sm text-card-foreground font-semibold">{detalle.proveedor}</div>
          <div className="text-xs text-muted-foreground mb-1">{fdate(detalle.fecha)}{detalle.num_factura_proveedor ? ` · Ref: ${detalle.num_factura_proveedor}` : ""}</div>
          {detalle.nota && <div className="text-xs text-muted-foreground italic mb-2">"{detalle.nota}"</div>}
          <div className="border border-border rounded-3xl overflow-hidden mt-2 mb-3">
            {detalle.lineas.map((l, i) => (
              <div key={i} className={`flex items-center justify-between px-3 py-2 ${i > 0 ? "border-t border-border" : ""}`}>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-card-foreground uppercase break-words">{l.prodNom}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{l.sku} · qty {l.qty}</div>
                </div>
                <div className="text-sm font-bold text-card-foreground shrink-0">{fmt(l.costoUnitario * l.qty)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-1 mb-4">
            <span className="text-sm font-bold text-card-foreground">Total</span>
            <span className="text-lg font-black text-primary">{fmt(detalle.total)}</span>
          </div>

          {detalle.comprobante && (
            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Supporting document</div>
              <div className="flex items-center gap-2.5 border border-border rounded-xl p-2.5">
                {detalle.comprobante.startsWith("data:image/") ? (
                  <a href={detalle.comprobante} target="_blank" rel="noreferrer">
                    <img src={detalle.comprobante} alt="Supporting document" className="w-12 h-12 rounded-lg object-cover border border-border shrink-0" />
                  </a>
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-xl shrink-0" aria-hidden="true">
                    {detalle.comprobante.startsWith("data:application/pdf") ? "📕" : "📊"}
                  </div>
                )}
                <div className="flex-1 min-w-0 text-xs font-medium text-card-foreground truncate">{detalle.comprobante_nombre || "Document"}</div>
                <a href={detalle.comprobante} target="_blank" rel="noreferrer" download={detalle.comprobante_nombre || undefined} className="text-xs font-bold text-primary shrink-0">View</a>
              </div>
            </div>
          )}

          {!readOnly && (
            <button onClick={() => handleDelete(detalle)} className={`w-full px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_DESTRUCTIVE}`}>
              Delete Purchase
            </button>
          )}
        </Modal>
      )}
    </div>
  );
};

// ------------------------------
// P&L Report
// ------------------------------
// Comprime la foto del comprobante de pago (recibo/transferencia) a un
// data URL manejable, mismo patron que las fotos de producto/cliente.
const compressComprobante = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_W = 1000;
        const scale = Math.min(1, MAX_W / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let out = canvas.toDataURL("image/jpeg", 0.75);
        if (out.length > 500000) out = canvas.toDataURL("image/jpeg", 0.55);
        resolve(out);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const primerDiaMes = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

const PLReport = () => {
  const { facturas, productos, gastos, compras, clientes, vendedores, addGasto, updateGasto, deleteGasto, readOnly } = useData();
  const [vista, setVista] = useState<"income" | "cash">("income");
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(today());
  const [showGastoForm, setShowGastoForm] = useState(false);
  const [editGastoId, setEditGastoId] = useState<string | null>(null);
  const [gCategoria, setGCategoria] = useState<string>(CATEGORIAS_GASTO[0]);
  const [gDescripcion, setGDescripcion] = useState("");
  const [gMonto, setGMonto] = useState("");
  const [gFecha, setGFecha] = useState(today());
  const [gPagado, setGPagado] = useState(false);
  const [gFechaPago, setGFechaPago] = useState(today());
  const [gComprobante, setGComprobante] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filtroGastos, setFiltroGastos] = useState<"all" | "pending" | "paid">("all");

  const aplicarPreset = (p: "month" | "lastMonth" | "quarter" | "year") => {
    const now = new Date();
    if (p === "month") { setDesde(primerDiaMes(now)); setHasta(today()); }
    else if (p === "lastMonth") {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      setDesde(primerDiaMes(lm));
      setHasta(`${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`);
    } else if (p === "quarter") {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      setDesde(primerDiaMes(new Date(now.getFullYear(), qStartMonth, 1)));
      setHasta(today());
    } else {
      setDesde(`${now.getFullYear()}-01-01`);
      setHasta(today());
    }
  };

  // Mapas de costo actual por producto: por sku+almacen (preferido) y por
  // nombre (respaldo) — las lineas de factura no guardan prodId.
  const { costoPorSku, costoPorNom } = useMemo(() => {
    const bySku: Record<string, number> = {};
    const byNom: Record<string, number> = {};
    for (const p of productos) {
      if (p.sku) bySku[`${p.sku.trim().toLowerCase()}|${p.almacen || "palmhills"}`] = Number(p.costo) || 0;
      byNom[p.nom] = Number(p.costo) || 0;
    }
    return { costoPorSku: bySku, costoPorNom: byNom };
  }, [productos]);

  const costoDeLinea = (l: { sku?: string; prodNom: string; almacen?: string }) => {
    const key = `${(l.sku || "").trim().toLowerCase()}|${l.almacen || "palmhills"}`;
    return costoPorSku[key] ?? costoPorNom[l.prodNom] ?? 0;
  };

  const enRango = (fecha: string) => fecha >= desde && fecha <= hasta;

  const { cashCollected, invoiced, cogs } = useMemo(() => {
    let cash = 0, inv = 0, cogsTotal = 0;
    for (const f of facturas) {
      for (const pago of f.pagos || []) {
        if (enRango(pago.fecha)) cash += Number(pago.monto) || 0;
      }
      if (enRango(f.fecha)) {
        inv += Number(f.total) || 0;
        for (const l of f.lineas || []) {
          cogsTotal += Number(l.qty || 0) * costoDeLinea(l);
        }
      }
    }
    return { cashCollected: cash, invoiced: inv, cogs: cogsTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturas, desde, hasta, costoPorSku, costoPorNom]);

  const grossProfit = invoiced - cogs;

  const outstandingReceivables = useMemo(
    () =>
      facturas
        .filter((f) => f.estado === "Pending" || f.estado === "Partially Paid")
        .reduce((acc, f) => acc + (Number(f.total) - (f.pagos || []).reduce((a, p) => a + Number(p.monto || 0), 0)), 0),
    [facturas]
  );

  // Clientes (por nombre, asi es como se guardan en facturas.cli) de cada vendedor
  const nombresPorVendedorPL = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of clientes) {
      if (!c.vendedor_id) continue;
      if (!m.has(c.vendedor_id)) m.set(c.vendedor_id, new Set());
      m.get(c.vendedor_id)!.add(c.nom);
    }
    return m;
  }, [clientes]);

  // Comision de vendedores: se resta en el Income Statement (accrual, sobre
  // venta facturada) porque es un gasto ya incurrido este periodo, se le haya
  // pagado o no al vendedor todavia -- mismo criterio que "Expenses incurred".
  // En Cash Flow NO se resta automaticamente (no sabemos si ya se le pago al
  // vendedor); se muestra solo como referencia, igual que Outstanding
  // Receivables. El pago real al vendedor se registra como Gasto normal
  // cuando ocurre, y ahi si cuenta como salida de caja.
  const comisiones = useMemo(() => {
    let venta = 0, cobro = 0;
    for (const v of vendedores) {
      const nombres = nombresPorVendedorPL.get(v.id) || new Set<string>();
      let ventaVendedor = 0, cobroVendedor = 0;
      for (const f of facturas) {
        if (!nombres.has(f.cli)) continue;
        if (enRango(f.fecha)) ventaVendedor += Number(f.total) || 0;
        for (const p of f.pagos || []) {
          if (enRango(p.fecha)) cobroVendedor += Number(p.monto) || 0;
        }
      }
      if (v.base_comision === "venta" || v.base_comision === "ambas") venta += ventaVendedor * (v.comision_venta_pct / 100);
      if (v.base_comision === "cobros" || v.base_comision === "ambas") cobro += cobroVendedor * (v.comision_cobro_pct / 100);
    }
    return { venta, cobro };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedores, nombresPorVendedorPL, facturas, desde, hasta]);

  // --- Income Statement (accrual): gastos cuentan cuando se INCURREN
  // (fecha), se hayan pagado o no — asi funciona un P&L de verdad (principio
  // de devengado/matching). Distinto del Cash Flow de abajo a proposito.
  const gastosIncurridosPeriodo = useMemo(
    () => gastos.filter((g) => enRango(g.fecha)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gastos, desde, hasta]
  );
  const gastosIncurridosPorCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of gastosIncurridosPeriodo) map.set(g.categoria, (map.get(g.categoria) || 0) + Number(g.monto));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [gastosIncurridosPeriodo]);
  const totalGastosIncurridos = gastosIncurridosPeriodo.reduce((a, g) => a + Number(g.monto), 0);
  const netIncomeAccrual = grossProfit - totalGastosIncurridos - comisiones.venta;

  // --- Cash Flow: solo lo que realmente entro y salio de caja en el
  // periodo. Los gastos cuentan por fecha_pago (no fecha) y las compras de
  // inventario a proveedores SI se reflejan aqui (aunque no sean un gasto
  // del P&L todavia, porque el inventario que compraste no se vendio) —
  // esto es lo que faltaba: comprar mercancia es salida de caja real.
  const gastosPagadosPeriodo = useMemo(
    () => gastos.filter((g) => g.pagado && g.fecha_pago && enRango(g.fecha_pago)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gastos, desde, hasta]
  );
  const gastosPorCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of gastosPagadosPeriodo) map.set(g.categoria, (map.get(g.categoria) || 0) + Number(g.monto));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [gastosPagadosPeriodo]);
  const totalGastosPagados = gastosPagadosPeriodo.reduce((a, g) => a + Number(g.monto), 0);

  const comprasPeriodo = useMemo(
    () => compras.filter((c) => enRango(c.fecha)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compras, desde, hasta]
  );
  const totalCompras = comprasPeriodo.reduce((a, c) => a + Number(c.total), 0);

  const totalCashOut = totalCompras + totalGastosPagados;
  const netCashFlow = cashCollected - totalCashOut;

  const gastosOrdenados = useMemo(
    () =>
      [...gastos]
        .filter((g) => (filtroGastos === "all" ? true : filtroGastos === "paid" ? g.pagado : !g.pagado))
        .sort((a, b) => (b.pagado ? b.fecha_pago || b.fecha : b.fecha).localeCompare(a.pagado ? a.fecha_pago || a.fecha : a.fecha)),
    [gastos, filtroGastos]
  );

  const resetGastoForm = () => {
    setEditGastoId(null);
    setGCategoria(CATEGORIAS_GASTO[0]);
    setGDescripcion("");
    setGMonto("");
    setGFecha(today());
    setGPagado(false);
    setGFechaPago(today());
    setGComprobante(null);
  };

  const openNewGasto = () => {
    resetGastoForm();
    setShowGastoForm(true);
  };

  const openEditGasto = (g: Gasto) => {
    setEditGastoId(g.id);
    setGCategoria(g.categoria);
    setGDescripcion(g.descripcion || "");
    setGMonto(String(g.monto));
    setGFecha(g.fecha);
    setGPagado(g.pagado);
    setGFechaPago(g.fecha_pago || today());
    setGComprobante(g.comprobante || null);
    setShowGastoForm(true);
  };

  const handleComprobanteUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      setGComprobante(await compressComprobante(file));
    } catch {
      alert("Could not process that image");
    }
  };

  const handleSaveGasto = async () => {
    if (saving) return;
    const monto = parseFloat(gMonto);
    if (!monto || monto <= 0) { alert("Enter a valid amount"); return; }
    if (!gFecha) { alert("Select a date"); return; }
    if (gPagado && !gFechaPago) { alert("Select the payment date"); return; }
    setSaving(true);
    try {
      const payload = {
        categoria: gCategoria,
        descripcion: gDescripcion,
        monto,
        fecha: gFecha,
        pagado: gPagado,
        fecha_pago: gPagado ? gFechaPago : null,
        comprobante: gPagado ? gComprobante : null,
      };
      if (editGastoId) await updateGasto(editGastoId, payload);
      else await addGasto(payload);
      resetGastoForm();
      setShowGastoForm(false);
    } catch (err) {
      alert("Error saving: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGasto = async (id: string) => {
    if (!confirm("Delete this expense?")) return;
    try {
      await deleteGasto(id);
      setShowGastoForm(false);
    } catch (err) {
      alert("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const Linea = ({ label, value, sub, bold, tint }: { label: string; value: number; sub?: string; bold?: boolean; tint?: "primary" | "destructive" | "muted" }) => (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <div className={`text-sm ${bold ? "font-bold text-card-foreground" : "text-muted-foreground"}`}>{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
      </div>
      <div
        className={`tabular-nums ${bold ? "text-lg font-black" : "text-sm font-semibold"} ${
          tint === "primary" ? "text-primary" : tint === "destructive" ? "text-destructive" : "text-card-foreground"
        }`}
      >
        {fmt(value)}
      </div>
    </div>
  );

  return (
    <div>
      {/* Selector de periodo */}
      <div className="bg-card rounded-3xl p-3.5 border border-border mb-3">
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {[
            { id: "month", label: "This Month" },
            { id: "lastMonth", label: "Last Month" },
            { id: "quarter", label: "This Quarter" },
            { id: "year", label: "This Year" },
          ].map((p) => (
            <button key={p.id} onClick={() => aplicarPreset(p.id as "month" | "lastMonth" | "quarter" | "year")} className="px-3 py-1.5 rounded-full text-xs font-bold bg-muted text-muted-foreground">
              {p.label}
            </button>
          ))}
        </div>
        <Row2>
          <Field label="From">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring" />
          </Field>
          <Field label="To">
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring" />
          </Field>
        </Row2>
      </div>

      {/* Toggle: dos reportes separados, cada uno con su propia logica */}
      <div className="inline-flex bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5 mb-3">
        <button onClick={() => setVista("income")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${vista === "income" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
          Income Statement
        </button>
        <button onClick={() => setVista("cash")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${vista === "cash" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
          Cash Flow
        </button>
      </div>

      {vista === "income" ? (
        <div className="bg-card rounded-3xl p-4 border border-border mb-3">
          <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
            Your regular P&amp;L: what you sold and what it cost, regardless of whether cash has moved yet.
          </p>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Revenue</div>
          <Linea label="Invoiced" value={invoiced} sub="Total billed in this period" bold tint="primary" />
          <div className="h-px bg-border my-2" />
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Cost of Goods Sold</div>
          <Linea label="COGS" value={cogs} sub="Invoiced lines × current product cost" />
          <Linea label="Gross Profit" value={grossProfit} bold tint={grossProfit >= 0 ? "primary" : "destructive"} />
          <div className="h-px bg-border my-2" />
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Operating Expenses</div>
          <Linea label="Expenses incurred" value={totalGastosIncurridos} sub="Billed in this period, paid or not" tint="destructive" />
          {gastosIncurridosPorCategoria.length > 0 && (
            <div className="mt-1 mb-2 pl-2 border-l-2 border-border space-y-0.5">
              {gastosIncurridosPorCategoria.map(([cat, monto]) => (
                <div key={cat} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{cat}</span>
                  <span className="tabular-nums">{fmt(monto)}</span>
                </div>
              ))}
            </div>
          )}
          <Linea label="Sales commissions" value={comisiones.venta} sub="Earned on invoiced sales this period — see Salespeople" tint="destructive" />
          <div className="h-px bg-border my-2" />
          <Linea label="Net Income" value={netIncomeAccrual} sub="Gross Profit − Expenses incurred − Sales commissions" bold tint={netIncomeAccrual >= 0 ? "primary" : "destructive"} />
        </div>
      ) : (
        <div className="bg-card rounded-3xl p-4 border border-border mb-3">
          <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
            What actually moved in and out of the bank in this period — including inventory purchases, which are NOT an expense on the Income Statement (that only happens when the stock sells) but ARE real cash out today.
          </p>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Cash In</div>
          <Linea label="Cash Collected" value={cashCollected} sub="Payments received in this period" bold tint="primary" />
          <div className="h-px bg-border my-2" />
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Cash Out</div>
          <Linea label="Inventory Purchases" value={totalCompras} sub={`${comprasPeriodo.length} purchase(s) — see Purchases tab`} tint="destructive" />
          <Linea label="Expenses Paid" value={totalGastosPagados} sub="Only expenses actually paid in this period" tint="destructive" />
          {gastosPorCategoria.length > 0 && (
            <div className="mt-1 mb-2 pl-2 border-l-2 border-border space-y-0.5">
              {gastosPorCategoria.map(([cat, monto]) => (
                <div key={cat} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{cat}</span>
                  <span className="tabular-nums">{fmt(monto)}</span>
                </div>
              ))}
            </div>
          )}
          <Linea label="Total Cash Out" value={totalCashOut} />
          <div className="h-px bg-border my-2" />
          <Linea label="Net Cash Flow" value={netCashFlow} sub="Cash Collected − Total Cash Out" bold tint={netCashFlow >= 0 ? "primary" : "destructive"} />
          <div className="h-px bg-border my-2" />
          <Linea label="Outstanding Receivables" value={outstandingReceivables} sub="Not yet collected, as of today — see Aging Report" />
          <Linea label="Commissions owed (on collections)" value={comisiones.cobro} sub="Not deducted above — record it as a paid Expense once you actually pay the salesperson" />
        </div>
      )}

      {/* Gastos */}
      <div className="bg-card rounded-3xl p-3.5 border border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-card-foreground">Expenses</span>
          {!readOnly && (
            <button onClick={openNewGasto} className={`px-3 py-1.5 rounded-full text-xs font-bold ${GLASS_BTN_PRIMARY}`}>
              + Add Expense
            </button>
          )}
        </div>
        <div className="flex gap-1.5 mb-2">
          {(["all", "pending", "paid"] as const).map((f) => (
            <button key={f} onClick={() => setFiltroGastos(f)} className={`px-3 py-1 rounded-full text-xs font-bold ${filtroGastos === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {f === "all" ? "All" : f === "pending" ? "Pending" : "Paid"}
            </button>
          ))}
        </div>
        {gastosOrdenados.length ? (
          <div className="border border-border rounded-xl overflow-hidden">
            {gastosOrdenados.map((g, i) => (
              <div
                key={g.id}
                onClick={() => openEditGasto(g)}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-secondary/30 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-card-foreground truncate">{g.categoria}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {g.pagado ? `Paid ${fdate(g.fecha_pago || g.fecha)}` : `Due ${fdate(g.fecha)}`}
                    {g.descripcion ? ` · ${g.descripcion}` : ""}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <span className="text-sm font-bold text-card-foreground tabular-nums">{fmt(g.monto)}</span>
                  <Badge e={g.pagado ? "Paid" : "Pending"} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="No expenses recorded." />
        )}
      </div>

      {showGastoForm && (
        <Modal title={editGastoId ? "Edit Expense" : "New Expense"} onClose={() => setShowGastoForm(false)}>
          <Field label="Category">
            <select value={gCategoria} onChange={(e) => setGCategoria(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring">
              {CATEGORIAS_GASTO.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Row2>
            <Field label="Amount ($)">
              <MoneyInput value={Number(gMonto) || 0} onChange={(n) => setGMonto(String(n))} className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Date">
              <input type="date" value={gFecha} onChange={(e) => setGFecha(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
            </Field>
          </Row2>
          <Field label="Note (optional)">
            <input value={gDescripcion} onChange={(e) => setGDescripcion(e.target.value)} placeholder="Details..." className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
          </Field>

          <div className="flex items-center justify-between bg-muted rounded-xl px-3.5 py-2.5 mb-3">
            <div>
              <div className="text-sm font-semibold text-card-foreground">Already paid</div>
              <div className="text-[11px] text-muted-foreground">Only paid expenses count in the P&L</div>
            </div>
            <Switch checked={gPagado} onCheckedChange={setGPagado} />
          </div>

          {gPagado && (
            <>
              <Field label="Payment date">
                <input type="date" value={gFechaPago} onChange={(e) => setGFechaPago(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
              </Field>
              <Field label="Proof of payment (optional)">
                {gComprobante ? (
                  <div className="relative">
                    <img src={gComprobante} alt="Proof of payment" className="w-full max-h-48 object-contain rounded-xl border border-border bg-white" />
                    <button onClick={() => setGComprobante(null)} className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm">×</button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed border-border text-sm text-muted-foreground cursor-pointer">
                    📎 Upload receipt photo
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleComprobanteUpload(e.target.files?.[0])} />
                  </label>
                )}
              </Field>
            </>
          )}

          <div className="flex gap-2.5 mt-3.5">
            {editGastoId && !readOnly && (
              <button onClick={() => handleDeleteGasto(editGastoId)} className={`px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_DESTRUCTIVE}`}>
                Delete
              </button>
            )}
            <button onClick={() => setShowGastoForm(false)} className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}>
              Cancel
            </button>
            <button disabled={saving} onClick={handleSaveGasto} className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ------------------------------
// Main App
// ------------------------------
const TITLES: Record<string, string> = {
  dash: "Dashboard",
  cal: "Calendar",
  fact: "Invoicing",
  cli: "Clients",
  inv: "Inventory",
  ord: "Orders",
  mej: "Improvements",
  usr: "Manage Users",
  pl: "P&L Report",
  com: "Purchases",
};

// Gestionar Usuarios component
const GestionarUsuarios = () => {
  const [users, setUsers] = useState<
    Array<{ id: string; email: string; created_at: string; last_sign_in_at: string | null; role: "admin" | "visitante" }>
  >([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", role: "visitante" as "admin" | "visitante" });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Fetch users on mount
  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch (e) {
      console.error("[v0] Error fetching users:", e);
    }
  };

  const handleCreateUser = async () => {
    if (!form.email.trim() || !form.password.trim()) {
      alert("Email and password are required");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password, action: "create", role: form.role }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error creating user");

      setMessage(`✓ User created: ${form.email}`);
      setForm({ email: "", password: "", role: "visitante" });
      setShow(false);
      await fetchUsers();
    } catch (e) {
      setMessage(`✗ ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeRole = async (email: string, role: "admin" | "visitante") => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, action: "setRole", role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error changing role");
      await fetchUsers();
    } catch (e) {
      alert("Couldn't change the role:\n\n" + (e instanceof Error ? e.message : "Unknown error"));
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Are you sure you want to permanently delete this user?")) return;
    
    try {
      console.log("[v0] Attempting to delete user:", userId);
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userId, action: "delete" }),
      });

      const data = await res.json();
      console.log("[v0] Delete response:", { ok: res.ok, data });

      if (!res.ok) {
        const errorMessage = data.error || "Couldn't delete the user";
        console.error("[v0] Delete failed:", errorMessage);
        throw new Error(errorMessage);
      }
      
      console.log("[v0] User deleted successfully, refreshing list");
      await fetchUsers();
      alert("User deleted successfully");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error deleting user";
      console.error("[v0] Delete user catch error:", errorMessage);
      alert("Couldn't delete the user:\n\n" + errorMessage);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-2.5 mb-3.5">
        <div className="bg-card rounded-xl p-3.5 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Active users</div>
          <div className="text-2xl font-bold text-card-foreground">{users.length}</div>
        </div>
      </div>
      <AddPillButton className={ADD_PILL_POS} aria-label="Create user" onClick={() => setShow(true)} />

      <div className="bg-card rounded-3xl p-3.5 border border-border mb-20">
        {users.length === 0 ? (
          <Empty text="No users. Tap the + button to create one." />
        ) : (
          users.map((u) => (
            <div key={u.id} className="bg-background rounded-xl p-2.5 mb-2.5 flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-card-foreground truncate">{u.email}</div>
                <div className="text-xs text-muted-foreground mb-1">
                  Created: {new Date(u.created_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}
                </div>
                <button
                  onClick={() => handleChangeRole(u.email, u.role === "admin" ? "visitante" : "admin")}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    u.role === "admin" ? "bg-secondary text-secondary-foreground" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {u.role === "admin" ? "Admin (full access)" : "Viewer (view only)"} · change
                </button>
              </div>
              <button
                onClick={() => handleDeleteUser(u.email)}
                className="px-2.5 py-1 rounded-lg backdrop-blur-md bg-red-50/80 border border-red-200/60 text-destructive text-xs font-bold shrink-0"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>


      {show && (
        <Modal
          title="Create New User"
          onClose={() => {
            setShow(false);
            setForm({ email: "", password: "", role: "visitante" });
            setMessage("");
          }}
        >
          <Field label="Email *">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="user@example.com"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Password *">
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Strong password"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Permissions *">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, role: "admin" })}
                className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-bold border ${
                  form.role === "admin"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-secondary-foreground border-border"
                }`}
              >
                Admin (full access)
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, role: "visitante" })}
                className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-bold border ${
                  form.role === "visitante"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-secondary-foreground border-border"
                }`}
              >
                Viewer (view only)
              </button>
            </div>
          </Field>
          {message && (
            <div className={`text-sm ${message.startsWith("✓") ? "text-green-600" : "text-destructive"}`}>
              {message}
            </div>
          )}
          <div className="flex gap-2.5 mt-3.5">
            <button
              onClick={() => {
                setShow(false);
                setForm({ email: "", password: "", role: "visitante" });
                setMessage("");
              }}
              className={`flex-1 px-4 py-2.5 rounded-full font-medium text-sm ${GLASS_BTN}`}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateUser}
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create User"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

function AppContent() {
  const [tab, setTab] = useState("dash");
  const { loading, role, refreshAll } = useData();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showVendedoresGlobal, setShowVendedoresGlobal] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const didSyncUrlRef = useRef(false);

  // --- Pull to refresh (jalar hacia abajo desde el tope recarga los datos) ---
  const [pull, setPull] = useState(0); // px que se ha jalado
  const [pulling, setPulling] = useState(false); // dedo abajo (sin animar altura)
  const [refreshing, setRefreshing] = useState(false);
  const pullStartY = useRef<number | null>(null);
  const PULL_THRESHOLD = 80; // menos sensible: hay que jalar mas para disparar

  const onPullStart = (e: React.TouchEvent) => {
    if (refreshing) return;
    if (mainRef.current && mainRef.current.scrollTop <= 0) {
      pullStartY.current = e.touches[0].clientY;
      setPulling(true);
    } else {
      pullStartY.current = null;
    }
  };
  const onPullMove = (e: React.TouchEvent) => {
    if (pullStartY.current === null || refreshing) return;
    if (mainRef.current && mainRef.current.scrollTop > 0) {
      pullStartY.current = null;
      setPull(0);
      setPulling(false);
      return;
    }
    const dy = e.touches[0].clientY - pullStartY.current;
    // Resistencia: la pantalla baja menos que el dedo, como en iOS
    setPull(dy > 0 ? Math.min(dy * 0.35, 110) : 0);
  };
  const onPullEnd = async () => {
    setPulling(false);
    pullStartY.current = null;
    if (pull >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPull(PULL_THRESHOLD);
      try {
        await refreshAll();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  };

  // Leer parámetro de URL para establecer el tab
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      if (tabParam && ALL_TAB_IDS.includes(tabParam)) {
        setTab(tabParam);
      }
    }
  }, []);

  // Mantener la URL en sync con la pestaña activa, para que "Back" desde
  // otras paginas regrese a la pestaña correcta. Se omite la primera
  // ejecucion para no pisar el parametro "tab" leido al montar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!didSyncUrlRef.current) {
      didSyncUrlRef.current = true;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") !== tab) {
      router.replace(`/?tab=${tab}`, { scroll: false });
    }
  }, [tab, router]);

  // Restaurar la posicion de scroll guardada al entrar/cambiar de pestaña
  useEffect(() => {
    const saved = sessionStorage.getItem(`ph_scroll_${tab}`);
    if (mainRef.current) {
      mainRef.current.scrollTop = saved ? Number(saved) : 0;
    }
  }, [tab]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || "")).catch(() => {});
  }, [supabase]);

  // Un visitante no tiene acceso a Usuarios; si quedo esa pestaña activa, regresa a Inicio
  useEffect(() => {
    if (role === "visitante" && tab === "usr") setTab("dash");
  }, [role, tab]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/auth/login");
  };

  const panels: Record<string, ReactNode> = {
    dash: <Dashboard />,
    cal: <Calendario />,
    fact: <Facturas />,
    cli: <Clientes />,
    inv: <Inventario />,
    ord: <Ordenes />,
    mej: <Mejoras />,
    usr: role === "admin" ? <GestionarUsuarios /> : <Dashboard />,
    pl: <PLReport />,
    com: <Compras />,
  };

  const MORE_ITEMS = [
    { id: "mej", label: "Improvements", icon: NAV_ICONS.mej },
    { id: "ven", label: "Salespeople", icon: NAV_ICONS.ven },
    ...(role === "admin" ? [{ id: "usr", label: "Manage Users", icon: NAV_ICONS.usr }] : []),
  ];

  return (
    <div className="max-w-[480px] mx-auto min-h-svh flex flex-col bg-background">
      <header
        className="bg-card border-b border-border px-4 py-2.5 flex items-center justify-between sticky top-0 z-[5]"
        style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="Palm Hills"
            className="w-12 h-12 object-contain"
          />
          <div>
            <div className="text-base font-bold text-primary leading-tight">
              Palm Hills
            </div>
            <div className="text-xs text-accent font-medium tracking-wide">
              Beauty & Health
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden xs:block">
            <div className="text-xs text-muted-foreground font-medium">
              {TITLES[tab]}
            </div>
            {email && (
              <div className="text-[10px] text-muted-foreground/70 truncate max-w-[120px]">
                {email}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu((v) => !v)}
              aria-label="More"
              className={`shrink-0 w-9 h-9 rounded-lg border border-border bg-background flex items-center justify-center ${showMoreMenu ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMoreMenu(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden w-44">
                  {MORE_ITEMS.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => {
                        setShowMoreMenu(false);
                        if (it.id === "ven") setShowVendedoresGlobal(true);
                        else setTab(it.id);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-muted border-b border-border last:border-b-0 ${tab === it.id ? "font-bold text-primary" : "text-card-foreground"}`}
                    >
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        {it.icon.split("|").map((d, i) => <path key={i} d={d} />)}
                      </svg>
                      {it.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="shrink-0 w-9 h-9 rounded-lg border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>
      {loading && (
        <div className="bg-secondary text-secondary-foreground text-center text-xs py-1.5">
          Loading data...
        </div>
      )}
      <main
        ref={mainRef}
        className="flex-1 p-3 pb-24 overflow-y-auto"
        onScroll={(e) => sessionStorage.setItem(`ph_scroll_${tab}`, String(e.currentTarget.scrollTop))}
        onTouchStart={onPullStart}
        onTouchMove={onPullMove}
        onTouchEnd={onPullEnd}
        onTouchCancel={onPullEnd}
      >
        {/* Indicador de pull-to-refresh: empuja el contenido hacia abajo */}
        <div
          className="flex flex-col items-center justify-center overflow-hidden"
          style={{
            height: pull,
            transition: pulling ? "none" : "height 0.25s ease",
          }}
        >
          {/* Spinner estilo iOS con anillo de progreso: el anillo se completa
              exactamente al llegar al umbral — ahi ya puede soltar. */}
          {(() => {
            const progress = Math.min(1, pull / PULL_THRESHOLD);
            const ready = progress >= 1;
            const R = 15;
            const CIRC = 2 * Math.PI * R;
            return (
              <div className="relative flex items-center justify-center" style={{ width: 38, height: 38 }}>
                {!refreshing && (
                  <svg width={38} height={38} viewBox="0 0 38 38" className="absolute inset-0" style={{ opacity: Math.min(1, pull / 20) }}>
                    <circle cx={19} cy={19} r={R} fill="none" stroke="currentColor" strokeWidth={2} className="text-border" />
                    <circle
                      cx={19} cy={19} r={R} fill="none"
                      stroke="currentColor" strokeWidth={2} strokeLinecap="round"
                      className={ready ? "text-primary" : "text-muted-foreground"}
                      strokeDasharray={CIRC}
                      strokeDashoffset={CIRC * (1 - progress)}
                      transform="rotate(-90 19 19)"
                    />
                  </svg>
                )}
                <svg
                  width={22}
                  height={22}
                  viewBox="0 0 24 24"
                  className={refreshing ? "animate-spin" : ""}
                  style={
                    refreshing
                      ? { animationDuration: "0.9s" }
                      : { transform: `rotate(${pull * 2.5}deg) scale(${ready ? 1.15 : 1})`, opacity: Math.min(1, pull / PULL_THRESHOLD), transition: "scale 0.15s" }
                  }
                >
                  {Array.from({ length: 12 }).map((_, i) => (
                    <rect
                      key={i}
                      x={11.25}
                      y={1.5}
                      width={1.5}
                      height={6}
                      rx={0.75}
                      fill="currentColor"
                      className={!refreshing && pull >= PULL_THRESHOLD ? "text-primary" : "text-muted-foreground"}
                      opacity={(i + 1) / 12}
                      transform={`rotate(${i * 30} 12 12)`}
                    />
                  ))}
                </svg>
              </div>
            );
          })()}
        </div>
        {panels[tab]}
      </main>
      <BottomNav active={tab} onSelect={setTab} hiddenTabs={role === "visitante" ? ["usr"] : []} />
      {showVendedoresGlobal && <VendedoresModal onClose={() => setShowVendedoresGlobal(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <DataProvider>
      <AppContent />
    </DataProvider>
  );
}
