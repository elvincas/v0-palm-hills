"use client";

import { useState, useEffect, useMemo, createContext, useContext, useRef, type ReactNode, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { flexibleSearch, normTag } from "@/lib/search";
import "react-easy-crop/react-easy-crop.css";
import JSZip from "jszip";
import type { CropperProps } from "react-easy-crop";
import { BottomNav, NAV_TABS } from "@/components/bottom-nav";
import { proximaFechaEntrega } from "@/lib/delivery";

const Cropper = dynamic(() => import("react-easy-crop"), { ssr: false }) as ComponentType<
  Partial<CropperProps>
>;

// ------------------------------
// Types
// ------------------------------
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
  icon?: string;
  foto?: string | null;
  almacen?: "palmhills" | "castillo";
}

interface LineaFactura {
  prodNom: string;
  sku?: string;
  barcode?: string;
  qty: number;
  precio: number;
  precioOriginal?: number;
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
}

interface NotaCredito {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  monto: number;
  motivo: string;
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

type TipoEvento = "delivery" | "visit" | "collect_money" | "order_request";

interface EventoCalendario {
  id: string;
  fecha: string;
  tipo: TipoEvento;
  cliente_id: string | null;
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

const today = () => new Date().toISOString().slice(0, 10);

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
  Paid: "bg-green-100 text-green-800",
  Pending: "bg-amber-100 text-amber-800",
  "In Review": "bg-blue-100 text-blue-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Delivered: "bg-green-100 text-green-800",
  Cancelled: "bg-red-100 text-red-800",
  Current: "bg-green-100 text-green-800",
  Issue: "bg-amber-100 text-amber-800",
  Active: "bg-green-100 text-green-800",
  Inactive: "bg-red-100 text-red-800",
  Waiting: "bg-amber-100 text-amber-800",
  "Out of stock": "bg-red-100 text-red-800",
  "Low stock": "bg-amber-100 text-amber-800",
  "In Stock": "bg-green-100 text-green-800",
  High: "bg-red-100 text-red-800",
  Medium: "bg-amber-100 text-amber-800",
  Low: "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
};

const Badge = ({ e }: { e: string }) => (
  <span
    className={`px-2.5 py-0.5 rounded-full text-xs font-bold inline-flex ${BM[e] || "bg-blue-100 text-blue-800"}`}
  >
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
      Cargar más ({remaining} restantes)
    </button>
  );
};

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
  addOrden: (o: Omit<Orden, "id" | "num">) => Promise<void>;
  deleteOrden: (id: string) => Promise<void>;
  updateOrden: (id: string, o: Orden) => Promise<void>;
  addRemito: (r: Omit<Remito, "id" | "num">) => Promise<void>;
  marcarRemitoEnviado: (id: string) => Promise<void>;
  addMejora: (m: Omit<Mejora, "id">) => Promise<void>;
  deleteMejora: (id: string) => Promise<void>;
  updateMejora: (id: string, m: Omit<Mejora, "id">) => Promise<void>;
  addEvento: (e: Omit<EventoCalendario, "id">) => Promise<void>;
  deleteEvento: (id: string) => Promise<void>;
  refreshLogs: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

const DataProvider = ({ children }: { children: ReactNode }) => {
  const supabase = useMemo(() => createClient(), []);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [notasCredito, setNotasCredito] = useState<NotaCredito[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [remitos, setRemitos] = useState<Remito[]>([]);
  const [mejoras, setMejoras] = useState<Mejora[]>([]);
  const [eventosCalendario, setEventosCalendario] = useState<EventoCalendario[]>([]);
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
    "id, nom, codigo_cliente, tel, email, dir, ciudad, estado_dir, contacto, estado, abierto_sabados, created_at";
  const PRODUCTO_COLS =
    "id, nom, sku, barcode, fabricante, etiquetas, precio, costo, cajas, stock, min, reservado, almacen, created_at";

  // Las fotos pesan varios MB en total: pedirlas todas de una vez supera el
  // timeout de la base de datos, asi que se piden en lotes pequenos.
  const FOTO_CHUNK = 20;

  const loadFotosProductos = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += FOTO_CHUNK) {
      const lote = ids.slice(i, i + FOTO_CHUNK);
      const { data } = await supabase.from("productos").select("id, foto").in("id", lote);
      if (!data) continue;
      const fotoMap = new Map(data.map((r) => [r.id, r.foto]));
      setProductos((prev) => prev.map((p) => (fotoMap.has(p.id) ? { ...p, foto: fotoMap.get(p.id) } : p)));
    }
  };

  const loadFotosClientes = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += FOTO_CHUNK) {
      const lote = ids.slice(i, i + FOTO_CHUNK);
      const { data } = await supabase.from("clientes").select("id, foto_local").in("id", lote);
      if (!data) continue;
      const fotoMap = new Map(data.map((r) => [r.id, r.foto_local]));
      setClientes((prev) =>
        prev.map((c) => (fotoMap.has(c.id) ? { ...c, foto_local: fotoMap.get(c.id) } : c))
      );
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
      const [c, p, f, nc, o, r, e, ev] = await Promise.all([
        selectAll<Cliente>("clientes", CLIENTE_COLS, "created_at", false),
        selectAll<Producto>("productos", PRODUCTO_COLS, "created_at", false),
        selectAll<Factura>("facturas", "*", "num", false),
        selectAll<NotaCredito>("notas_credito", "*", "num", false),
        selectAll<Orden>("ordenes", "*", "num", false),
        selectAll<Remito>("remitos", "*", "num", false),
        selectAll<Mejora>("mejoras", "*", "created_at", false),
        selectAll<EventoCalendario>("eventos_calendario", "*", "fecha", true),
      ]);
      setClientes(c);
      setProductos(p.map((row) => ({ ...row, etiquetas: row.etiquetas || [] })));
      setFacturas(f);
      setNotasCredito(nc);
      setOrdenes(o.map((row) => ({ ...row, lineas: row.lineas || [] })));
      setRemitos(r.map((row) => ({ ...row, lineas: row.lineas || [] })));
      setMejoras(e);
      setEventosCalendario(ev);
      await refreshLogs();
      loadFotosProductos(p.map((r) => r.id)).catch(() => {});
      loadFotosClientes(c.map((r) => r.id)).catch(() => {});
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

  const nextNum = (rows: { num: number }[], start: number) =>
    Math.max(start - 1, ...rows.map((r) => r.num)) + 1;

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
    const { data, error } = await supabase.from("clientes").update(updated).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setClientes((prev) => prev.map((c) => (c.id === id ? (data as Cliente) : c)));
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
    const validated = sanitizeProducto(prod);
    const { data, error } = await supabase.from("productos").update(validated).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    setProductos((prev) => prev.map((p) => (p.id === id ? (data as Producto) : p)));
    await logAct(`Product updated: ${prod.nom}`);
  };

  const updateProductoFoto = async (id: string, foto: string) => {
    const { error } = await supabase.from("productos").update({ foto }).eq("id", id);
    if (error) throw new Error(error.message);
    setProductos((prev) => prev.map((p) => (p.id === id ? { ...p, foto } : p)));
  };

  const deleteProducto = async (id: string) => {
    const { error } = await supabase.from("productos").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setProductos((prev) => prev.filter((p) => p.id !== id));
    await logAct(`Product deleted`);
  };

  // --- Facturas ---
  const addFactura = async (factura: Omit<Factura, "id" | "num">) => {
    const num = nextNum(facturas, 1001);
    const { data, error } = await supabase.from("facturas").insert({ ...factura, num }).select().single();
    if (error) throw new Error(error.message);
    setFacturas((prev) => [data as Factura, ...prev]);
    await logAct(`Invoice #${num} → ${factura.cli}`);
  };

  // --- Remitos (Constancia de Retiro Castillo) ---
  const addRemito = async (remito: Omit<Remito, "id" | "num">) => {
    const num = nextNum(remitos as any, 5001);
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
    const num = nextNum(notasCredito, 1);
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

  // --- Ordenes ---
  const addOrden = async (orden: Omit<Orden, "id" | "num">) => {
    const num = nextNum(ordenes, 1);
    const { data, error } = await supabase.from("ordenes").insert({ ...orden, num }).select().single();
    if (error) throw new Error(error.message);
    setOrdenes((prev) => [{ ...(data as Orden), lineas: (data as Orden).lineas || [] }, ...prev]);
    await logAct(`Order #${num} → ${orden.cli}`);
  };

  const deleteOrden = async (id: string) => {
    const { error } = await supabase.from("ordenes").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setOrdenes((prev) => prev.filter((o) => o.id !== id));
    await logAct(`Order deleted`);
  };

  const updateOrden = async (id: string, updated: Orden) => {
    const { id: _omit, ...payload } = updated;
    const { data, error } = await supabase.from("ordenes").update(payload).eq("id", id).select().single();
    if (error) {
      console.error("[v0] Supabase error actualizando orden:", error);
      throw new Error(error.message);
    }
    setOrdenes((prev) => prev.map((o) => (o.id === id ? { ...(data as Orden), lineas: (data as Orden).lineas || [] } : o)));
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

  // --- Calendario (agenda de ruta) ---
  const addEvento = async (ev: Omit<EventoCalendario, "id">) => {
    const { data, error } = await supabase.from("eventos_calendario").insert(ev).select().single();
    if (error) throw new Error(error.message);
    setEventosCalendario((prev) => [...prev, data as EventoCalendario]);
    await logAct(`Calendar event added: ${ev.tipo} on ${ev.fecha}`);
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
            .filter((e) => e.tipo === "delivery" && e.fecha >= today())
            .map((e) => e.fecha)
        )
      ).sort(),
    [eventosCalendario]
  );

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
    addOrden,
    deleteOrden,
    updateOrden,
    addRemito,
    marcarRemitoEnviado,
    addMejora,
    deleteMejora,
    updateMejora,
    addEvento,
    deleteEvento,
    refreshLogs,
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
const mesActualKey = () => new Date().toISOString().slice(0, 7); // "2026-06"
const mesActualNombre = () => {
  const nombre = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
};

const Dashboard = () => {
  const { facturas, clientes, productos, logs, readOnly } = useData();
  const [meta, setMeta] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem(`ph_meta_${mesActualKey()}`) || 0);
  });
  const [editMeta, setEditMeta] = useState(false);
  const [metaInp, setMetaInp] = useState("");

  const facturasDelMes = useMemo(
    () => facturas.filter((f) => (f.fecha || "").slice(0, 7) === mesActualKey()),
    [facturas]
  );

  const totalVentas = useMemo(
    () => facturasDelMes.reduce((sum, f) => sum + Number(f.total), 0),
    [facturasDelMes]
  );
  const lowStock = useMemo(
    () => productos.filter((p) => Number(p.stock) <= Number(p.min || 5)).length,
    [productos]
  );
  const pct = meta > 0 ? Math.min(100, Math.round((totalVentas / meta) * 100)) : 0;

  const barColor =
    pct >= 100
      ? "bg-gradient-to-r from-primary to-green-500"
      : pct >= 70
        ? "bg-gradient-to-r from-amber-500 to-amber-300"
        : pct >= 40
          ? "bg-gradient-to-r from-blue-500 to-blue-300"
          : "bg-gradient-to-r from-slate-400 to-slate-300";

  const statusLabel =
    pct >= 100 ? "Meta alcanzada!" : pct >= 70 ? "Muy cerca!" : pct >= 40 ? "On track" : "Comenzando";

  const saveMeta = () => {
    const v = Number(metaInp);
    if (!v) return;
    localStorage.setItem(`ph_meta_${mesActualKey()}`, String(v));
    setMeta(v);
    setEditMeta(false);
  };

  const ultimasFacturas = [...facturas].sort((a, b) => b.num - a.num).slice(0, 5);

  return (
    <div>
      <div className="bg-card rounded-2xl p-3.5 mb-3 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Sales goal · {mesActualNombre()}
            </div>
            {meta > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {statusLabel}
              </div>
            )}
          </div>
          {!readOnly && (
            <button
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${GLASS_BTN}`}
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
            <div className="flex justify-between items-baseline mb-2">
              <div>
                <span className="text-xl font-bold text-card-foreground">{fmt(totalVentas)}</span>
                <span className="text-sm text-muted-foreground ml-1">of {fmt(meta)}</span>
              </div>
              <span
                className={`text-xl font-extrabold ${pct >= 100 ? "text-primary" : pct >= 70 ? "text-amber-500" : pct >= 40 ? "text-blue-500" : "text-slate-400"}`}
              >
                {pct}%
              </span>
            </div>
            <div className="bg-muted rounded-full h-3.5 overflow-hidden mb-1.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${pct}%`, minWidth: pct > 0 ? 4 : 0 }}
              />
            </div>
            {pct < 100 && (
              <div className="text-xs text-muted-foreground text-right">
                Remaining <strong className="text-card-foreground">{fmt(meta - totalVentas)}</strong>
              </div>
            )}
          </>
        ) : (
          <Empty text="Tap '+ Set goal' for your target" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 mb-3.5">
        {[
          ["Sales this month", fmt(totalVentas), false],
          ["Invoices", facturas.length, false],
          ["Clients", clientes.length, false],
          ["Low stock", lowStock, true],
        ].map(([label, val, red]) => (
          <div
            key={label as string}
            className="bg-card rounded-xl p-3.5 border border-border"
          >
            <div className="text-xs text-muted-foreground mb-1">{label as string}</div>
            <div
              className={`text-xl font-bold ${red && (val as number) > 0 ? "text-destructive" : "text-card-foreground"}`}
            >
              {val as string | number}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-2xl p-3.5 mb-3 border border-border">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
          Recent invoices
        </div>
        {ultimasFacturas.length ? (
          ultimasFacturas.map((f) => (
            <Li
              key={f.id}
              left={
                <>
                  <div className="text-sm font-semibold truncate text-card-foreground">
                    {f.cli}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    #{f.num} - {fdate(f.fecha)}
                  </div>
                </>
              }
              right={
                <>
                  <div className="text-sm font-bold mb-0.5 text-card-foreground">{fmt(f.total)}</div>
                  <Badge e={f.estado} />
                </>
              }
            />
          ))
        ) : (
          <Empty text="No invoices yet" />
        )}
      </div>

      <div className="bg-card rounded-2xl p-3.5 border border-border">
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

      {editMeta && (
        <Modal title={`Sales goal · ${mesActualNombre()}`} onClose={() => setEditMeta(false)}>
          <Field label="Target amount ($)">
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              value={metaInp}
              onChange={(e) => setMetaInp(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveMeta()}
              placeholder="100000"
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
  const { ordenes, clientes, eventosCalendario, addEvento, deleteEvento, readOnly } = useData();
  const [mesActual, setMesActual] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalTipo, setModalTipo] = useState<TipoEvento | null>(null);
  const [formFecha, setFormFecha] = useState(today());
  const [formClienteId, setFormClienteId] = useState("");
  const [formClienteSearch, setFormClienteSearch] = useState("");
  const [formClienteOpen, setFormClienteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

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
  const ordenesDelDia = diaSeleccionado ? ordenesPorFecha[diaSeleccionado] || [] : [];
  const eventosDelDia = (diaSeleccionado ? eventosPorFecha[diaSeleccionado] || [] : [])
    .slice()
    .sort((a, b) => (TIPO_PRIORIDAD[a.tipo] ?? 9) - (TIPO_PRIORIDAD[b.tipo] ?? 9));

  const abrirModalEvento = (tipo: TipoEvento) => {
    setModalTipo(tipo);
    setFormFecha(diaSeleccionado ?? today());
    setFormClienteId("");
    setFormClienteSearch("");
    setFormClienteOpen(false);
    setMenuOpen(false);
  };

  const handleCrearEvento = async () => {
    if (!modalTipo) return;
    if (modalTipo !== "delivery" && !formClienteId) {
      alert("Select a client");
      return;
    }
    setSaving(true);
    try {
      await addEvento({
        fecha: formFecha,
        tipo: modalTipo,
        cliente_id: modalTipo === "delivery" ? null : formClienteId,
      });
      setModalTipo(null);
    } catch (err) {
      alert(`Could not add this to the calendar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvento = (ev: EventoCalendario) => {
    if (!confirm("Remove this from the calendar?")) return;
    deleteEvento(ev.id).catch((err) =>
      alert(`Could not remove it: ${err instanceof Error ? err.message : String(err)}`)
    );
  };

  return (
    <div>
      <div className="bg-card rounded-2xl p-3.5 border border-border mb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => cambiarMes(-1)}
              className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-card-foreground"
            >
              ‹
            </button>
            <span className="text-sm font-bold text-card-foreground min-w-[120px] text-center">
              {MESES[mesActual.month]} {mesActual.year}
            </span>
            <button
              onClick={() => cambiarMes(1)}
              className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-card-foreground"
            >
              ›
            </button>
          </div>
        </div>

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
            const esEntrega = eventosDia.some((e) => e.tipo === "delivery");
            const tieneAgenda = eventosDia.some((e) => e.tipo !== "delivery");
            const ordenesDia = ordenesPorFecha[fecha] || [];
            const numDia = Number(fecha.slice(-2));
            const esHoy = fecha === today();
            return (
              <button
                key={fecha}
                onClick={() => setDiaSeleccionado(fecha === diaSeleccionado ? null : fecha)}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center relative text-xs ${
                  diaSeleccionado === fecha
                    ? "bg-primary text-primary-foreground font-bold"
                    : esEntrega
                      ? "bg-secondary text-secondary-foreground font-semibold"
                      : "bg-muted text-card-foreground"
                } ${esHoy && diaSeleccionado !== fecha ? "ring-2 ring-primary" : ""}`}
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
      </div>

      {diaSeleccionado && (
        <div className="bg-card rounded-2xl p-3.5 border border-border mb-3">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {fdate(diaSeleccionado)}
          </div>
          {eventosDelDia.length > 0 && (
            <div className="mb-2">
              {eventosDelDia.map((ev) => {
                const info = EVENTO_INFO[ev.tipo];
                const cInfo = ev.cliente_id ? clienteFor(ev.cliente_id) : null;
                return (
                  <div key={ev.id} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-base" aria-hidden="true">{info.icon}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold uppercase text-card-foreground truncate">
                          {cInfo ? cInfo.nom : info.label}
                        </div>
                        <div className="text-xs text-muted-foreground">{info.label}</div>
                      </div>
                    </div>
                    {!readOnly && (
                      <button
                        onClick={() => handleDeleteEvento(ev)}
                        aria-label="Remove"
                        className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-red-50 shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Entregas del {fdate(diaSeleccionado)}
          </div>
          {ordenesDelDia.length ? (
            ordenesDelDia.map((o) => {
              const cInfo = clienteFor(o.cli);
              return (
                <div key={o.id} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold uppercase text-card-foreground truncate">
                      {cInfo ? cInfo.nom : o.cli}
                    </div>
                    <div className="text-xs text-muted-foreground">Order #{o.num}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-card-foreground">{fmt(o.total)}</div>
                    <Badge e={o.estado} />
                  </div>
                </div>
              );
            })
          ) : (
            <Empty text="No deliveries scheduled for this day." />
          )}
        </div>
      )}

      {menuOpen && (
        <div className="fixed inset-0 z-[6]" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}
      {!readOnly && (
        <div className="fixed bottom-[72px] right-4 z-[7] flex flex-col items-end gap-2">
          {menuOpen && (
            <div className="flex flex-col gap-2 mb-1">
              {(Object.keys(EVENTO_INFO) as TipoEvento[]).map((tipo) => (
                <button
                  key={tipo}
                  onClick={() => abrirModalEvento(tipo)}
                  className="flex items-center gap-2 bg-card border border-border text-card-foreground rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium whitespace-nowrap"
                >
                  <span className="text-base" aria-hidden="true">{EVENTO_INFO[tipo].icon}</span>
                  {EVENTO_INFO[tipo].label}
                </button>
              ))}
            </div>
          )}
          <button
            aria-label="Add to calendar"
            className={`w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg flex items-center justify-center transition-transform ${menuOpen ? "rotate-45" : ""}`}
            onClick={() => setMenuOpen((o) => !o)}
          >
            +
          </button>
        </div>
      )}

      {modalTipo && (
        <Modal
          title={EVENTO_INFO[modalTipo].label}
          onClose={() => setModalTipo(null)}
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
          {modalTipo !== "delivery" && (
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
                        .filter((c) => !formClienteSearch.trim() || c.nom.toLowerCase().includes(formClienteSearch.toLowerCase()))
                        .map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setFormClienteId(c.id);
                              setFormClienteSearch(c.nom);
                              setFormClienteOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted ${formClienteId === c.id ? "font-bold text-primary" : "text-card-foreground"}`}
                          >
                            {c.nom}
                          </button>
                        ))}
                      {clientes.filter((c) => !formClienteSearch.trim() || c.nom.toLowerCase().includes(formClienteSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2.5 text-xs text-muted-foreground">No clients found</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </Field>
          )}
          <button
            onClick={handleCrearEvento}
            disabled={saving}
            className={`w-full mt-2 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
          >
            {saving ? "Saving..." : "Add"}
          </button>
        </Modal>
      )}
    </div>
  );
};

// ------------------------------
// Facturas
// ------------------------------
const Facturas = () => {
  const { facturas, clientes, productos, proximasFechasEntrega, addFactura, deleteFactura, notasCredito, addNotaCredito, deleteNotaCredito, readOnly } =
    useData();
  const router = useRouter();
  const [subTab, setSubTab] = useState<"invoices" | "creditos">("invoices");
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [lineas, setLineas] = useState([{ prodId: "", qty: 1 }]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState("");
  const [fecha, setFecha] = useState("");
  const [estado, setEstado] = useState("Pending");
  const [invAlmacen, setInvAlmacen] = useState<"palmhills" | "castillo">("palmhills");
  const [invSearches, setInvSearches] = useState<string[]>([""]);
  const [invFocus, setInvFocus] = useState<number | null>(null);
  // Credit notes form
  const [showNcForm, setShowNcForm] = useState(false);
  const [ncForm, setNcForm] = useState({ cli: "", fecha: today(), monto: "", motivo: "" });
  const [ncCliSearch, setNcCliSearch] = useState("");
  const [ncCliOpen, setNcCliOpen] = useState(false);
  const [ncSaving, setNcSaving] = useState(false);
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

  const subtotal = lineas.reduce((acc, l) => {
    const p = productos.find((x) => x.id === l.prodId);
    return acc + (p ? Number(p.precio) * Number(l.qty || 1) : 0);
  }, 0);
  const total = subtotal * 1.16;

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
        precio: Number(p.precio),
        precioOriginal: Number(p.precio),
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
      </div>

      {subTab === "creditos" ? (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <input value={ncQ} onChange={(e) => setNcQ(e.target.value)} placeholder="Search by client..." className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
              {ncQ && <button onClick={() => setNcQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button>}
            </div>
          </div>
          {(() => {
            const ncs = notasCredito.filter(n => !ncQ || n.cli.toLowerCase().includes(ncQ.toLowerCase())).sort((a,b) => b.num - a.num);
            return ncs.length ? (
              <div className="bg-card border border-border rounded-2xl overflow-hidden mb-3">
                <div className="grid grid-cols-[1fr_1.5fr_1fr_1fr] gap-2 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground bg-secondary/40">
                  <span>Date</span><span>Client</span><span>Amount</span><span>CN #</span>
                </div>
                {ncs.map(n => (
                  <div key={n.id} className="grid grid-cols-[1fr_1.5fr_1fr_1fr] gap-2 px-3.5 py-2.5 text-xs border-t border-border hover:bg-secondary/30 group">
                    <span className="text-muted-foreground">{fdate(n.fecha)}</span>
                    <div className="min-w-0">
                      <div className="font-bold uppercase truncate text-card-foreground">{n.cli}</div>
                      {n.motivo && <div className="text-muted-foreground truncate">{n.motivo}</div>}
                    </div>
                    <span className="font-bold text-green-700">{fmt(n.monto)}</span>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-muted-foreground">#{String(n.num).padStart(3, "0")}</span>
                      {!readOnly && <button onClick={() => { if (confirm("Delete this credit note?")) deleteNotaCredito(n.id); }} className="opacity-0 group-hover:opacity-100 text-destructive text-xs px-1">×</button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card rounded-2xl p-3.5 border border-border mb-3"><p className="text-sm text-muted-foreground text-center">No credit notes.</p></div>
            );
          })()}
          {!readOnly && (
            <button onClick={() => { setNcForm({ cli: "", fecha: today(), monto: "", motivo: "" }); setNcCliSearch(""); setShowNcForm(true); }} className={`fixed bottom-[72px] right-4 w-13 h-13 rounded-full text-2xl cursor-pointer z-[6] flex items-center justify-center ${GLASS_BTN_PRIMARY}`}>+</button>
          )}
          {showNcForm && !readOnly && (
            <Modal title="New Credit Note" onClose={() => setShowNcForm(false)}>
              <Field label="Client">
                <div className="relative">
                  <input type="text" value={ncCliSearch} onChange={(e) => { setNcCliSearch(e.target.value); setNcForm(f => ({ ...f, cli: "" })); setNcCliOpen(true); }} onFocus={() => setNcCliOpen(true)} placeholder="Search client..." autoComplete="off" className="w-full px-3 py-2.5 pr-8 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
                  {ncForm.cli ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary text-xs font-bold">✓</span> : ncCliSearch ? <button onClick={() => { setNcCliSearch(""); setNcForm(f => ({ ...f, cli: "" })); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none">×</button> : null}
                  {ncCliOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setNcCliOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto w-full">
                        {clientes.filter(c => !ncCliSearch || c.nom.toLowerCase().includes(ncCliSearch.toLowerCase())).map(c => (
                          <button key={c.id} onClick={() => { setNcForm(f => ({ ...f, cli: c.nom })); setNcCliSearch(c.nom); setNcCliOpen(false); }} className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted ${ncForm.cli === c.nom ? "font-bold text-primary" : "text-card-foreground"}`}>{c.nom}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Field>
              <Field label="Date">
                <input type="date" value={ncForm.fecha} onChange={(e) => setNcForm(f => ({ ...f, fecha: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
              </Field>
              <Field label="Amount ($)">
                <input type="number" min="0" step="0.01" value={ncForm.monto} onChange={(e) => setNcForm(f => ({ ...f, monto: e.target.value }))} placeholder="0.00" className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
              </Field>
              <Field label="Reason / Notes">
                <input type="text" value={ncForm.motivo} onChange={(e) => setNcForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Reason for credit..." className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring" />
              </Field>
              <button
                disabled={ncSaving || !ncForm.cli || !ncForm.monto}
                onClick={async () => {
                  if (!ncForm.cli) { alert("Select a client"); return; }
                  const m = parseFloat(ncForm.monto);
                  if (!m || m <= 0) { alert("Enter a valid amount"); return; }
                  setNcSaving(true);
                  try { await addNotaCredito({ cli: ncForm.cli, fecha: ncForm.fecha, monto: m, motivo: ncForm.motivo }); setShowNcForm(false); }
                  catch (err) { alert(`Error: ${err instanceof Error ? err.message : String(err)}`); }
                  finally { setNcSaving(false); }
                }}
                className={`w-full mt-2 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY} disabled:opacity-50`}
              >
                {ncSaving ? "Saving..." : "Create Credit Note"}
              </button>
            </Modal>
          )}
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
      </div>
      {filtered.length ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_1.6fr_1fr_0.8fr] gap-2 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground bg-secondary/40">
            <span>Date</span>
            <span>Client #</span>
            <span>Client Name</span>
            <span>Amount</span>
            <span>Invoice #</span>
          </div>
          {visibleFacturas.map((f) => (
            <div
              key={f.id}
              onClick={() => router.push(`/facturas/${f.id}`)}
              className="grid grid-cols-[1fr_1fr_1.6fr_1fr_0.8fr] gap-2 px-3.5 py-2.5 text-xs border-t border-border cursor-pointer hover:bg-secondary/30"
            >
              <span className="text-muted-foreground">{fdate(f.fecha)}</span>
              <span className="font-mono text-muted-foreground">{clienteCodigo(f.cli)}</span>
              <span className="font-bold uppercase truncate">{f.cli}</span>
              <span className="font-bold text-primary">{fmt(f.total)}</span>
              <span className="font-mono text-muted-foreground">#{String(f.num).padStart(3, "0")}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card rounded-2xl p-3.5 border border-border">
          <Empty text="No invoices. Tap + to create one." />
        </div>
      )}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={loadMore} />
      {!readOnly && (
        <button
          className={`fixed bottom-[72px] right-4 w-13 h-13 rounded-full text-2xl cursor-pointer z-[6] flex items-center justify-center ${GLASS_BTN_PRIMARY}`}
          onClick={() => setShow(true)}
        >
          +
        </button>
      )}

      {show && !readOnly && (
        <Modal title="New Invoice" onClose={() => setShow(false)}>
          <Field label="Client">
            <select
              value={clienteSeleccionado}
              onChange={(e) => setClienteSeleccionado(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Selecciona...</option>
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
                  <option value="">Selecciona...</option>
                  {proximasFechasEntrega.map((f) => (
                    <option key={f} value={f}>
                      {fdate(f)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No hay días de entrega marcados — agrega uno desde Calendario.
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
              {(["palmhills", "castillo"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => { setInvAlmacen(a); setInvSearches(lineas.map(() => "")); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${invAlmacen === a ? "bg-primary text-primary-foreground border-primary" : "bg-card text-card-foreground border-border"}`}
                >
                  {a === "palmhills" ? "Palm Hills" : "Castillo"}
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
                            placeholder="Buscar producto..."
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
                                <span className="font-medium">{p.sku ? `${p.sku} — ` : ""}{p.nom}</span>
                                <span className="text-muted-foreground ml-1">{fmt(p.precio)}</span>
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
            <div className="text-sm text-muted-foreground mb-0.5">
              Subtotal: {fmt(subtotal)} - IVA 16%: {fmt(subtotal * 0.16)}
            </div>
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
  const { clientes, addCliente, addClientesBulk, deleteCliente, updateCliente, facturas, notasCredito, readOnly } = useData();
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"codigo_cliente" | "nom">("codigo_cliente");
  const [cliColumnas, setCliColumnas] = useState<1 | 3>(1);
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
  });

  const nextCodigoCliente = useMemo(() => {
    let prefix = "01";
    let maxNum = 0;
    let width = 4;
    clientes.forEach((c) => {
      const m = (c.codigo_cliente || "").match(/^(\d+)-(\d+)$/);
      if (m) {
        const num = parseInt(m[2], 10);
        if (num > maxNum) {
          maxNum = num;
          prefix = m[1];
          width = m[2].length;
        }
      }
    });
    return `${prefix}-${String(maxNum + 1).padStart(width, "0")}`;
  }, [clientes]);

  const balanceCliente = (nom: string) => {
    const deuda = facturas
      .filter(f => f.cli === nom && !["Paid", "Completed", "Cancelled"].includes(f.estado))
      .reduce((acc, f) => {
        const pagado = (f.pagos || []).reduce((s, p) => s + p.monto, 0);
        return acc + Math.max(0, f.total - pagado);
      }, 0);
    const credito = notasCredito
      .filter(nc => nc.cli === nom)
      .reduce((acc, nc) => acc + nc.monto, 0);
    return deuda - credito;
  };

  const filtered = useMemo(() => {
    const base = q
      ? clientes.filter(
          (c) =>
            c.nom.toLowerCase().includes(q.toLowerCase()) ||
            (c.codigo_cliente || "").toLowerCase().includes(q.toLowerCase())
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
    setForm({ nom: "", codigo_cliente: "", tel: "", email: "", dir: "", ciudad: "", estado_dir: "", contacto: "", estado: "Active", abierto_sabados: false, foto_local: "" });
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
      if (editId) {
        await updateCliente(editId, form);
      } else {
        await addCliente(form);
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
              <div className="absolute right-0 top-12 z-20 bg-card border border-border rounded-2xl shadow-lg overflow-hidden min-w-[180px]"
                onBlur={() => setShowAddMenu(false)}
              >
                <button
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-card-foreground hover:bg-muted text-left"
                  onClick={() => {
                    setShowAddMenu(false);
                    reset();
                    setForm((f) => ({ ...f, codigo_cliente: nextCodigoCliente }));
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
                  Subir a granel
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
      {filtered.length ? (
        cliColumnas === 3 ? (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {visibleClientes.map((c) => (
              <div
                key={c.id}
                onClick={() => router.push(`/clientes/${c.id}`)}
                className="bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:border-primary transition-colors"
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
              <div key={c.id} className="bg-card rounded-2xl border border-border overflow-hidden">
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
        <div className="bg-card rounded-2xl p-3.5 border border-border">
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
          <Row2>
            <Field label="Client Number *">
              <input
                value={form.codigo_cliente}
                onChange={(e) => setForm({ ...form, codigo_cliente: e.target.value })}
                readOnly={!editId}
                placeholder="Ej. 01-0001"
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
                onChange={(e) => setForm({ ...form, tel: e.target.value })}
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
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
            <Field label="Ciudad">
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
            <h2 className="text-xl font-bold mb-4">Ajusta tu foto</h2>
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
  { key: "nom", label: "A-Z Descripcion" },
  { key: "precio", label: "Price" },
  { key: "stock", label: "Current Stock" },
  { key: "fabricante", label: "Fabricante" },
  { key: "barcode", label: "Barcode" },
  { key: "sku", label: "SKU" },
];

const Inventario = () => {
  const { productos, addProducto, addProductosBulk, updateProducto, updateProductoFoto, deleteProducto, readOnly } = useData();
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
  const [invColumnas, setInvColumnas] = useState<2 | 3>(2);
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
    } else if (!hasQuery) {
      // Default: SKU A-Z (solo cuando no hay busqueda activa, para no pisar la relevancia)
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
          : `Se importaron ${result.insertados} productos correctamente.${
              result.duplicados > 0 ? ` (${result.duplicados} duplicados saltados)` : ''
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
      <div className="relative mb-2.5">
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
      <div className="flex items-center gap-2 mb-3">
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
      {allTags.length > 0 && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-2 -mx-1 px-1"
          style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
        >
          {tagFilter.length > 0 && (
            <button
              onClick={() => setTagFilter([])}
              className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground"
            >
              Limpiar
            </button>
          )}
          {allTags.map((t) => {
            const active = tagFilter.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTagFilter(t)}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-secondary-foreground border-border"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
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
                className="bg-card border border-border rounded-2xl p-3 relative flex flex-col h-full uppercase"
              >
                {!readOnly && (
                  <button
                    onClick={() => openEdit(p)}
                    className="absolute top-2 right-2 bg-card border border-border rounded-lg px-2 py-1 text-xs font-bold cursor-pointer text-secondary-foreground z-[1]"
                  >
                    Edit
                  </button>
                )}
                <div
                  onClick={() => p.foto && setFotoAmpliada(p.foto)}
                  className={`w-full aspect-square rounded-lg bg-white flex items-center justify-center text-2xl mb-2 shrink-0 ${p.foto ? "cursor-pointer" : ""}`}
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
                <div className="text-xs font-bold mb-1 text-card-foreground leading-snug break-words text-pretty pr-12 min-h-[2.25rem]">
                  {p.nom}
                </div>
                <div className="text-xs text-muted-foreground font-mono mb-0.5 break-all">
                  {p.sku}
                </div>
                {p.fabricante && (
                  <div className="text-xs text-muted-foreground mb-0.5 break-words">
                    {p.fabricante}
                  </div>
                )}
                {p.barcode && (
                  <div className="text-xs text-muted-foreground font-mono mb-0.5 break-all">
                    CB: {p.barcode}
                  </div>
                )}
                <div className="mt-auto pt-1.5">
                  {almacen === "castillo" ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold inline-flex bg-secondary text-secondary-foreground">
                      🏰 Castillo
                    </span>
                  ) : (
                    <Badge e={estado} />
                  )}
                  <div className="text-sm font-bold text-secondary-foreground mt-1">
                    {fmt(p.precio)}
                  </div>
                  {almacen !== "castillo" && (
                    <div className="text-xs text-muted-foreground mt-0.5">
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
      {menuOpen && (
        <div
          className="fixed inset-0 z-[6]"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}
      {!readOnly && (
        <div className="fixed bottom-[72px] right-4 z-[7] flex flex-col items-end gap-2">
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
          <button
            aria-label="Add product"
            className={`w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg flex items-center justify-center transition-transform ${menuOpen ? "rotate-45" : ""}`}
            onClick={() => setMenuOpen((o) => !o)}
          >
            +
          </button>
        </div>
      )}

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
              SKU, Description, Manufacturer, Current Stock, Units per box, Barcode, Price, Cost, Minimum stock
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
                        <td className="px-2 py-1.5 text-card-foreground max-w-xs truncate">
                          {r.nom || (
                            <span className="text-destructive italic">No name</span>
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
          <Field label="Foto">
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
                    Toca
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
                X Quitar foto
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
          <Field label="Fabricante">
            <input
              value={form.fabricante}
              onChange={(e) => setForm({ ...form, fabricante: e.target.value })}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Etiquetas">
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
          <Row2>
            <Field label="Price ($)">
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                value={form.precio}
                onChange={(e) => setForm({ ...form, precio: e.target.value })}
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Costo ($)">
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                value={form.costo}
                onChange={(e) => setForm({ ...form, costo: e.target.value })}
                autoComplete="off"
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
              {editId ? "Actualizar" : "Save"} Producto
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
            alt="Foto ampliada"
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
    readOnly,
  } = useData();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [picking, setPicking] = useState<Orden | null>(null);
  const [pickAlmacen, setPickAlmacen] = useState<"todos" | "palmhills" | "castillo">("todos");
  const [pickItems, setPickItems] = useState<(LineaOrden & { picked: boolean })[]>(
    []
  );
  const [lineas, setLineas] = useState([{ prodId: "", qty: 1 }]);
  const [form, setForm] = useState({
    cli: "",
    fecha: "",
    estado: "Pending",
  });
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
  const [editAlmacen, setEditAlmacen] = useState<"palmhills" | "castillo">("palmhills");
  const [newOrderAlmacen, setNewOrderAlmacen] = useState<"palmhills" | "castillo">("palmhills");
  const [newOrderSearches, setNewOrderSearches] = useState<string[]>([""]);
  const [newOrderFocus, setNewOrderFocus] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ fecha: today(), estado: "Pending" });

  const clienteFor = (cli: string) =>
    clientes.find((c) => c.id === cli) || clientes.find((c) => c.nom === cli);

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

  const productosNewOrder = useMemo(
    () =>
      productosPorSku.filter((p) => {
        const alm = p.almacen ?? null;
        if (newOrderAlmacen === "palmhills") return alm === "palmhills" || alm === null;
        return alm === newOrderAlmacen;
      }),
    [productosPorSku, newOrderAlmacen]
  );

  const getProductosSugeridos = (search: string) => {
    if (!search.trim()) return productosNewOrder.slice(0, 30);
    return flexibleSearch(
      productosNewOrder,
      search,
      (p) => [p.nom, p.sku, p.barcode, ...(p.etiquetas || [])].filter(Boolean).join(" "),
      (p) => p.nom
    ).slice(0, 30);
  };

  const total = lineas.reduce((acc, l) => {
    const p = productos.find((x) => x.id === l.prodId);
    return acc + (p ? Number(p.precio) * Number(l.qty || 1) : 0);
  }, 0);

  const handleSave = () => {
    if (!form.cli) {
      alert("Select a client");
      return;
    }
    if (!form.fecha) {
      alert("Select a delivery date");
      return;
    }
    const items = lineas.filter((l) => l.prodId);
    if (items.length === 0) {
      alert("Add at least one product");
      return;
    }
    const lineasDetalle = items.map((l) => {
      const p = productos.find((x) => x.id === l.prodId)!;
      return {
        prodId: p.id,
        prodNom: p.nom,
        barcode: p.barcode || "",
        sku: p.sku || "",
        precio: Number(p.precio),
        qty: Number(l.qty),
      };
    });
    addOrden({
      cli: form.cli,
      fecha: form.fecha,
      estado: form.estado,
      total: +total.toFixed(2),
      lineas: lineasDetalle,
    });
    setShow(false);
    setLineas([{ prodId: "", qty: 1 }]);
    setForm({ cli: "", fecha: "", estado: "Pending" });
    setNewOrderSearches([""]);
    setNewOrderFocus(null);
  };

  const startPick = (ord: Orden) => {
    if (!ord.lineas?.length) {
      alert("This order has no detailed products.");
      return;
    }
    setPicking(ord);
    setPickAlmacen("todos");
    setPickItems(
      ord.lineas.map((l) => ({ ...l, qtyEnviada: l.qtyEnviada ?? l.qty, picked: l.picked ?? false }))
    );
  };

  const togglePicked = (idx: number) => {
    setPickItems((prev) => prev.map((it, i) => (i === idx ? { ...it, picked: !it.picked } : it)));
  };

  const setQtyEnviada = (idx: number, qty: number) => {
    setPickItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, qtyEnviada: Math.max(0, Math.min(qty, it.qty)) } : it
      )
    );
  };

  const completePick = async () => {
    if (!picking) return;
    try {
      const lineasFinal = pickItems.map(({ picked, ...rest }) => rest);
      await updateOrden(picking.id, { ...picking, lineas: lineasFinal, estado: "Completed" });

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
          almacen: it.almacen || "palmhills",
        }));
      const facturaTotal = facturaLineas.reduce((acc, l) => acc + l.qty * l.precio, 0);
      const cInfo = clienteFor(picking.cli);
      await addFactura({
        cli: cInfo?.nom || picking.cli,
        fecha: picking.fecha,
        estado: "Pending",
        total: +facturaTotal.toFixed(2),
        lineas: facturaLineas,
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
          fecha: picking.fecha,
          lineas: remitoCastilloLineas,
          enviado: false,
          total: +remitoCastilloTotal.toFixed(2),
        });
      }

      setPicking(null);
    } catch (err) {
      alert(
        `Could not complete the order: ${err instanceof Error ? err.message : String(err)}. Please try again.`
      );
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

  const handleDeleteOrden = (ord: Orden) => {
    if (
      confirm(
        `Delete order #${ord.num}? This action cannot be undone and the order cannot be recovered.`
      )
    ) {
      deleteOrden(ord.id);
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
    setEditAlmacen("palmhills");
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

  const editProductosOrdenados = editProductOrder
    .map((id) => productos.find((p) => p.id === id))
    .filter((p): p is Producto => !!p);

  const editProductosFiltrados = (() => {
    const porAlmacen = editProductosOrdenados.filter((p) => (p.almacen || "palmhills") === editAlmacen);
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
    (acc, p) => acc + (editQtys[p.id] || 0) * (editPrecios[p.id] ?? Number(p.precio)),
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
      const precioFinal = editPrecios[prodId] ?? Number(p.precio);
      return {
        prodId: p.id,
        prodNom: p.nom,
        barcode: p.barcode || "",
        sku: p.sku || "",
        precio: Number(p.precio),
        precioFinal,
        qty,
        qtyEnviada: qty,
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

  const {
    visible: ordenesVisibles,
    hasMore: ordenesHasMore,
    remaining: ordenesRemaining,
    loadMore: ordenesLoadMore,
  } = usePagedList(ordenesOrdenadas, []);

  return (
    <div>
      <div className="bg-card rounded-2xl p-3.5 border border-border">
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
      {!readOnly && (
        <button
          className={`fixed bottom-[72px] right-4 w-13 h-13 rounded-full text-2xl cursor-pointer z-[6] flex items-center justify-center ${GLASS_BTN_PRIMARY}`}
          onClick={() => setShow(true)}
        >
          +
        </button>
      )}

      {show && !readOnly && (
        <Modal title="New Order" onClose={() => setShow(false)}>
          <Field label="Client">
            <select
              value={form.cli}
              onChange={(e) => setForm({ ...form, cli: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Selecciona...</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.nom}>
                  {c.nom}
                </option>
              ))}
            </select>
          </Field>
          <Row2>
            <Field label="Delivery">
              {proximasFechasEntrega.length ? (
                <select
                  value={form.fecha}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Selecciona...</option>
                  {proximasFechasEntrega.map((f) => (
                    <option key={f} value={f}>
                      {fdate(f)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No hay días marcados — agrega uno desde Calendario.
                </p>
              )}
            </Field>
            <Field label="Estado">
              <select
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              >
                <option>Pending</option>
                <option>In Progress</option>
                <option>Completed</option>
              </select>
            </Field>
          </Row2>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-muted-foreground">Products</div>
            <div className="flex gap-1">
              {(["palmhills", "castillo"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => { setNewOrderAlmacen(a); setNewOrderSearches(lineas.map(() => "")); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${newOrderAlmacen === a ? "bg-primary text-primary-foreground border-primary" : "bg-card text-card-foreground border-border"}`}
                >
                  {a === "palmhills" ? "Palm Hills" : "Castillo"}
                </button>
              ))}
            </div>
          </div>
          {lineas.map((l, i) => {
            const selectedProd = productos.find((p) => p.id === l.prodId);
            const search = newOrderSearches[i] ?? "";
            const sugeridos = getProductosSugeridos(search);
            const isFocused = newOrderFocus === i;
            return (
              <div key={i} className="mb-2 bg-muted rounded-lg p-2">
                <div className="flex gap-1.5 items-center mb-1">
                  <div className="flex-[2] relative">
                    {selectedProd ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-primary bg-card text-card-foreground text-sm">
                        <span className="flex-1 truncate">
                          {selectedProd.sku ? `${selectedProd.sku} — ` : ""}{selectedProd.nom}
                        </span>
                        <button
                          onClick={() => {
                            setLineas((ls) => ls.map((x, j) => j === i ? { ...x, prodId: "" } : x));
                            setNewOrderSearches((ss) => ss.map((s, j) => j === i ? "" : s));
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
                            placeholder="Buscar producto..."
                            value={search}
                            onChange={(e) => setNewOrderSearches((ss) => ss.map((s, j) => j === i ? e.target.value : s))}
                            onFocus={() => setNewOrderFocus(i)}
                            onBlur={() => setTimeout(() => setNewOrderFocus(null), 200)}
                            className="w-full px-2.5 py-2 pr-7 rounded-lg border border-input bg-card text-card-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
                          />
                          {search && <button onMouseDown={(e) => { e.preventDefault(); setNewOrderSearches((ss) => ss.map((s, j) => j === i ? "" : s)); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-lg leading-none">×</button>}
                        </div>
                        {isFocused && sugeridos.length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                            {sugeridos.map((p) => (
                              <button
                                key={p.id}
                                onMouseDown={() => {
                                  setLineas((ls) => ls.map((x, j) => j === i ? { ...x, prodId: p.id } : x));
                                  setNewOrderSearches((ss) => ss.map((s, j) => j === i ? "" : s));
                                  setNewOrderFocus(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b border-border last:border-0 text-card-foreground"
                              >
                                <span className="font-medium">{p.sku ? `${p.sku} — ` : ""}{p.nom}</span>
                                <span className="text-muted-foreground ml-1">{fmt(p.precio)}</span>
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
                      setNewOrderSearches((ss) => ss.filter((_, j) => j !== i));
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
              setNewOrderSearches((ss) => [...ss, ""]);
            }}
            className="w-full px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm mb-3"
          >
            + Add product
          </button>
          <div className="text-right border-t border-border pt-2.5 mb-3">
            <strong className="text-base text-card-foreground">Total: {fmt(total)}</strong>
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
              className={`flex-1 px-4 py-2.5 rounded-full font-bold text-sm ${GLASS_BTN_PRIMARY}`}
            >
              Save Order
            </button>
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
                      .filter((c) => !editCliSearch.trim() || c.nom.toLowerCase().includes(editCliSearch.toLowerCase()))
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setEditCli(c.id);
                            setEditCliSearch(c.nom);
                            setEditCliOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${editCli === c.id ? "font-bold text-primary" : "text-card-foreground"}`}
                        >
                          {c.nom}
                        </button>
                      ))}
                    {clientes.filter((c) => !editCliSearch.trim() || c.nom.toLowerCase().includes(editCliSearch.toLowerCase())).length === 0 && (
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
                      className={`bg-card border rounded-2xl p-3 flex flex-col h-full ${
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
                      <div className="text-xs font-bold mb-1 text-card-foreground leading-snug break-words min-h-[2.25rem]">
                        {p.nom}
                      </div>
                      {p.sku && (
                        <div className="text-xs text-muted-foreground font-mono mb-0.5 break-all">{p.sku}</div>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        {editPrecios[p.id] !== undefined && editPrecios[p.id] !== p.precio ? (
                          <>
                            <span className="text-xs text-muted-foreground line-through">{fmt(p.precio)}</span>
                            <span className="text-sm font-bold text-primary">{fmt(editPrecios[p.id])}</span>
                          </>
                        ) : (
                          <span className="text-sm font-bold text-secondary-foreground">{fmt(p.precio)}</span>
                        )}
                      </div>

                      {editandoDescuentoId === p.id ? (
                        <div className="mt-1.5">
                          <label className="text-[10px] text-muted-foreground block mb-1">Price for this order</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]*[.,]?[0-9]*"
                            autoComplete="off"
                            defaultValue={editPrecios[p.id] ?? p.precio}
                            autoFocus
                            onBlur={(e) => {
                              setEditPrecio(p.id, Number(e.target.value));
                              setEditandoDescuentoId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setEditPrecio(p.id, Number((e.target as HTMLInputElement).value));
                                setEditandoDescuentoId(null);
                              }
                            }}
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
              onClick={() => setPicking(null)}
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
            <div className="space-y-2.5">
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
                return (
                  <div
                    key={i}
                    className={`bg-card border rounded-2xl p-3 flex items-center gap-3 ${item.picked ? "border-primary" : "border-border"}`}
                  >
                    <button
                      onClick={() => togglePicked(i)}
                      aria-label={item.picked ? "Marcar como pendiente" : "Marcar como pickeado"}
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
                      <div className="text-xs text-card-foreground leading-snug break-words mt-0.5">
                        {item.prodNom}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">Pedido: {item.qty}</div>
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
          <div className="backdrop-blur-xl bg-card/90 border-t border-border px-4 pt-3 pb-2 shrink-0">
            {!pickItems.every((i) => i.picked) && (
              <p className="text-[11px] text-amber-600 font-medium text-center mb-2">
                {puedeGuardarParcial
                  ? "You can save this warehouse's progress, or check everything to complete the order"
                  : "Check off all products to complete the order"}
              </p>
            )}
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setPicking(null)}
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
                Sacada parcialmente
              </button>
            </div>
            <button
              onClick={completePick}
              disabled={!pickItems.length || !pickItems.every((i) => i.picked)}
              title={
                !pickItems.every((i) => i.picked)
                  ? "Check off all products to complete the order"
                  : undefined
              }
              className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Complete order
            </button>
          </div>
          <div className="h-20 shrink-0" />
          <BottomNav active="ord" />
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

  const handleSave = () => {
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
    if (editId) updateMejora(editId, payload);
    else addMejora(payload);
    reset();
    setShow(false);
  };

  const card = (m: Mejora) => (
    <div
      key={m.id}
      className="bg-card border border-border rounded-2xl p-3.5 mb-2.5"
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
              onClick={() => {
                if (confirm("Delete this improvement?")) deleteMejora(m.id);
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

      {mejoras.length === 0 ? (
        <div className="bg-card rounded-2xl p-3.5 border border-border">
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

      {!readOnly && (
        <button
          className={`fixed bottom-[72px] right-4 w-13 h-13 rounded-full text-2xl cursor-pointer z-[6] flex items-center justify-center ${GLASS_BTN_PRIMARY}`}
          onClick={openNew}
          aria-label="Add improvement"
        >
          +
        </button>
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
          <Field label="Descripcion / notas">
            <textarea
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              rows={3}
              placeholder="Detalles, justificacion, proveedores, etc."
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </Field>
          <Field label="Costo estimado ($)">
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              autoComplete="off"
              value={form.costo}
              onChange={(e) => setForm({ ...form, costo: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Row2>
            <Field label="Prioridad">
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
            <Field label="Estado">
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

      <div className="bg-card rounded-2xl p-3.5 border border-border mb-20">
        {users.length === 0 ? (
          <Empty text="No users. Tap the + button to create one." />
        ) : (
          users.map((u) => (
            <div key={u.id} className="bg-background rounded-xl p-2.5 mb-2.5 flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-card-foreground truncate">{u.email}</div>
                <div className="text-xs text-muted-foreground mb-1">
                  Created: {new Date(u.created_at).toLocaleDateString("en-US")}
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

      <button
        className={`fixed bottom-[72px] right-4 w-13 h-13 rounded-full text-2xl cursor-pointer z-[6] flex items-center justify-center ${GLASS_BTN_PRIMARY}`}
        onClick={() => setShow(true)}
        aria-label="Create user"
      >
        +
      </button>

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
              {loading ? "Creando..." : "Create User"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

function AppContent() {
  const [tab, setTab] = useState("dash");
  const { loading, role } = useData();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);
  const didSyncUrlRef = useRef(false);

  // Leer parámetro de URL para establecer el tab
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      if (tabParam && NAV_TABS.some((t) => t.id === tabParam)) {
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
  };

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
          <button
            onClick={signOut}
            aria-label="Cerrar sesion"
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
        className="flex-1 p-3 pb-20 overflow-y-auto"
        onScroll={(e) => sessionStorage.setItem(`ph_scroll_${tab}`, String(e.currentTarget.scrollTop))}
      >
        {panels[tab]}
      </main>
      <BottomNav active={tab} onSelect={setTab} hiddenTabs={role === "visitante" ? ["usr"] : []} />
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
