"use client";

import { useState, useEffect, useMemo, createContext, useContext, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";
import Fuse from "fuse.js";

// ------------------------------
// Types
// ------------------------------
interface Cliente {
  id: string;
  nom: string;
  rfc?: string;
  tel?: string;
  email?: string;
  dir?: string;
  estado: string;
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
}

interface Factura {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  estado: string;
  total: number;
}

interface LineaOrden {
  prodId: string;
  prodNom: string;
  barcode: string;
  sku: string;
  precio: number;
  qty: number;
  picked?: boolean;
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

// ------------------------------
// Formatting utilities
// ------------------------------
const fmt = (n: number) =>
  "$" +
  Number(n).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const today = () => new Date().toISOString().slice(0, 10);

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

// ------------------------------
// Badge component
// ------------------------------
const BM: Record<string, string> = {
  Pagada: "bg-green-100 text-green-800",
  Pendiente: "bg-amber-100 text-amber-800",
  "En revisión": "bg-blue-100 text-blue-800",
  "En proceso": "bg-blue-100 text-blue-800",
  Entregado: "bg-green-100 text-green-800",
  Cancelado: "bg-red-100 text-red-800",
  "Al corriente": "bg-green-100 text-green-800",
  Incidencia: "bg-amber-100 text-amber-800",
  Baja: "bg-red-100 text-red-800",
  Activo: "bg-green-100 text-green-800",
  Inactivo: "bg-red-100 text-red-800",
  "En espera": "bg-amber-100 text-amber-800",
  "Sin stock": "bg-red-100 text-red-800",
  "Stock bajo": "bg-amber-100 text-amber-800",
  "En stock": "bg-green-100 text-green-800",
  Alta: "bg-red-100 text-red-800",
  Media: "bg-amber-100 text-amber-800",
  Baja: "bg-blue-100 text-blue-800",
  Completada: "bg-green-100 text-green-800",
  "En progreso": "bg-blue-100 text-blue-800",
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
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
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
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <div
    className="fixed inset-0 bg-black/50 z-20 flex items-end justify-center"
    onClick={(e) => e.target === e.currentTarget && onClose()}
  >
    <div className="bg-card rounded-t-3xl p-5 pb-8 w-full max-w-[480px] max-h-[90svh] overflow-y-auto">
      <div className="w-10 h-1 bg-border rounded-full mx-auto mb-4" />
      <div className="flex items-center justify-between mb-4">
        <span className="text-lg font-bold text-card-foreground">{title}</span>
        <button
          onClick={onClose}
          className="bg-transparent border-none text-xl cursor-pointer text-muted-foreground hover:text-foreground"
        >
          X
        </button>
      </div>
      {children}
    </div>
  </div>
);



// ------------------------------
// Data Context
// ------------------------------
interface DataContextType {
  clientes: Cliente[];
  productos: Producto[];
  facturas: Factura[];
  ordenes: Orden[];
  mejoras: Mejora[];
  logs: LogEntry[];
  loading: boolean;
  addCliente: (c: Omit<Cliente, "id">) => void;
  deleteCliente: (id: string) => void;
  updateCliente: (id: string, c: Omit<Cliente, "id">) => void;
  addProducto: (p: Omit<Producto, "id">) => void;
  addProductosBulk: (rows: Omit<Producto, "id">[]) => Promise<number>;
  updateProducto: (id: string, p: Omit<Producto, "id">) => void;
  deleteProducto: (id: string) => void;
  addFactura: (f: Omit<Factura, "id" | "num">) => void;
  deleteFactura: (id: string) => void;
  addOrden: (o: Omit<Orden, "id" | "num">) => void;
  deleteOrden: (id: string) => void;
  updateOrden: (id: string, o: Orden) => void;
  addMejora: (m: Omit<Mejora, "id">) => void;
  deleteMejora: (id: string) => void;
  updateMejora: (id: string, m: Omit<Mejora, "id">) => void;
  refreshLogs: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

const DataProvider = ({ children }: { children: ReactNode }) => {
  const supabase = useMemo(() => createClient(), []);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [mejoras, setMejoras] = useState<Mejora[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

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

  const loadAll = async () => {
    const [c, p, f, o, e] = await Promise.all([
      supabase.from("clientes").select("*").order("created_at", { ascending: false }),
      supabase.from("productos").select("*").order("created_at", { ascending: false }),
      supabase.from("facturas").select("*").order("num", { ascending: false }),
      supabase.from("ordenes").select("*").order("num", { ascending: false }),
      supabase.from("mejoras").select("*").order("created_at", { ascending: false }),
    ]);
    if (c.data) setClientes(c.data as Cliente[]);
    if (p.data) setProductos((p.data as Producto[]).map((row) => ({ ...row, etiquetas: row.etiquetas || [] })));
    if (f.data) setFacturas(f.data as Factura[]);
    if (o.data) setOrdenes((o.data as Orden[]).map((row) => ({ ...row, lineas: row.lineas || [] })));
    if (e.data) setMejoras(e.data as Mejora[]);
    await refreshLogs();
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextNum = (rows: { num: number }[], start: number) =>
    Math.max(start - 1, ...rows.map((r) => r.num)) + 1;

  // --- Clientes ---
  const addCliente = async (cliente: Omit<Cliente, "id">) => {
    const { data } = await supabase.from("clientes").insert(cliente).select().single();
    if (data) setClientes((prev) => [data as Cliente, ...prev]);
    await logAct(`Nuevo cliente: ${cliente.nom}`);
  };

  const deleteCliente = async (id: string) => {
    await supabase.from("clientes").delete().eq("id", id);
    setClientes((prev) => prev.filter((c) => c.id !== id));
    await logAct(`Cliente eliminado`);
  };

  const updateCliente = async (id: string, updated: Omit<Cliente, "id">) => {
    const { data } = await supabase.from("clientes").update(updated).eq("id", id).select().single();
    if (data) setClientes((prev) => prev.map((c) => (c.id === id ? (data as Cliente) : c)));
    await logAct(`Cliente actualizado: ${updated.nom}`);
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
      etiquetas: Array.isArray(prod.etiquetas)
        ? Array.from(new Set(prod.etiquetas.map((t) => t.trim()).filter(Boolean)))
        : [],
      fabricante: (prod.fabricante || "").trim(),
    };
    delete (validated as { icon?: string }).icon;
    return validated;
  };

  const addProducto = async (prod: Omit<Producto, "id">) => {
    const { data } = await supabase.from("productos").insert(sanitizeProducto(prod)).select().single();
    if (data) setProductos((prev) => [data as Producto, ...prev]);
    await logAct(`Nuevo producto: ${prod.nom}`);
  };

  const addProductosBulk = async (rows: Omit<Producto, "id">[]) => {
    const payload = rows.map(sanitizeProducto);
    const { data, error } = await supabase.from("productos").insert(payload).select();
    if (error) throw error;
    if (data) setProductos((prev) => [...(data as Producto[]), ...prev]);
    await logAct(`Carga masiva: ${data?.length || 0} productos`);
    return data?.length || 0;
  };

  const updateProducto = async (id: string, prod: Omit<Producto, "id">) => {
    const validated = sanitizeProducto(prod);
    const { data } = await supabase.from("productos").update(validated).eq("id", id).select().single();
    if (data) setProductos((prev) => prev.map((p) => (p.id === id ? (data as Producto) : p)));
    await logAct(`Producto actualizado: ${prod.nom}`);
  };

  const deleteProducto = async (id: string) => {
    await supabase.from("productos").delete().eq("id", id);
    setProductos((prev) => prev.filter((p) => p.id !== id));
    await logAct(`Producto eliminado`);
  };

  // --- Facturas ---
  const addFactura = async (factura: Omit<Factura, "id" | "num">) => {
    const num = nextNum(facturas, 1001);
    const { data } = await supabase.from("facturas").insert({ ...factura, num }).select().single();
    if (data) setFacturas((prev) => [data as Factura, ...prev]);
    await logAct(`Factura #${num} → ${factura.cli}`);
  };

  const deleteFactura = async (id: string) => {
    await supabase.from("facturas").delete().eq("id", id);
    setFacturas((prev) => prev.filter((f) => f.id !== id));
    await logAct(`Factura eliminada`);
  };

  // --- Ordenes ---
  const addOrden = async (orden: Omit<Orden, "id" | "num">) => {
    const num = nextNum(ordenes, 1);
    const { data } = await supabase.from("ordenes").insert({ ...orden, num }).select().single();
    if (data) setOrdenes((prev) => [{ ...(data as Orden), lineas: (data as Orden).lineas || [] }, ...prev]);
    await logAct(`Orden #${num} → ${orden.cli}`);
  };

  const deleteOrden = async (id: string) => {
    await supabase.from("ordenes").delete().eq("id", id);
    setOrdenes((prev) => prev.filter((o) => o.id !== id));
    await logAct(`Orden eliminada`);
  };

  const updateOrden = async (id: string, updated: Orden) => {
    const { id: _omit, ...payload } = updated;
    const { data } = await supabase.from("ordenes").update(payload).eq("id", id).select().single();
    if (data) setOrdenes((prev) => prev.map((o) => (o.id === id ? { ...(data as Orden), lineas: (data as Orden).lineas || [] } : o)));
    await logAct(`Orden #${updated.num} actualizada`);
  };

  // --- Mejoras ---
  const sanitizeMejora = (m: Omit<Mejora, "id">) => ({
    titulo: (m.titulo || "").trim(),
    descripcion: (m.descripcion || "").trim(),
    costo: Math.max(0, Number(m.costo) || 0),
    prioridad: m.prioridad || "Media",
    estado: m.estado || "Pendiente",
  });

  const addMejora = async (m: Omit<Mejora, "id">) => {
    const { data } = await supabase.from("mejoras").insert(sanitizeMejora(m)).select().single();
    if (data) setMejoras((prev) => [data as Mejora, ...prev]);
    await logAct(`Mejora agregada: ${m.titulo}`);
  };

  const deleteMejora = async (id: string) => {
    await supabase.from("mejoras").delete().eq("id", id);
    setMejoras((prev) => prev.filter((e) => e.id !== id));
    await logAct(`Mejora eliminada`);
  };

  const updateMejora = async (id: string, m: Omit<Mejora, "id">) => {
    const { data } = await supabase.from("mejoras").update(sanitizeMejora(m)).eq("id", id).select().single();
    if (data) setMejoras((prev) => prev.map((e) => (e.id === id ? (data as Mejora) : e)));
    await logAct(`Mejora actualizada: ${m.titulo}`);
  };

  const value: DataContextType = {
    clientes,
    productos,
    facturas,
    ordenes,
    mejoras,
    logs,
    loading,
    addCliente,
    deleteCliente,
    updateCliente,
    addProducto,
    addProductosBulk,
    updateProducto,
    deleteProducto,
    addFactura,
    deleteFactura,
    addOrden,
    deleteOrden,
    updateOrden,
    addMejora,
    deleteMejora,
    updateMejora,
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
const Dashboard = () => {
  const { facturas, clientes, productos, logs } = useData();
  const [meta, setMeta] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("ph_meta") || 0);
  });
  const [editMeta, setEditMeta] = useState(false);
  const [metaInp, setMetaInp] = useState("");

  const totalVentas = useMemo(
    () => facturas.reduce((sum, f) => sum + Number(f.total), 0),
    [facturas]
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
    pct >= 100 ? "Meta alcanzada!" : pct >= 70 ? "Muy cerca!" : pct >= 40 ? "En camino" : "Comenzando";

  const saveMeta = () => {
    const v = Number(metaInp);
    if (!v) return;
    localStorage.setItem("ph_meta", String(v));
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
              Meta de ventas
            </div>
            {meta > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {statusLabel}
              </div>
            )}
          </div>
          <button
            className="bg-secondary text-secondary-foreground border border-primary rounded-lg px-3 py-1.5 text-xs font-bold"
            onClick={() => {
              setMetaInp(meta ? String(meta) : "");
              setEditMeta(true);
            }}
          >
            {meta > 0 ? "Cambiar" : "+ Fijar meta"}
          </button>
        </div>
        {meta > 0 ? (
          <>
            <div className="flex justify-between items-baseline mb-2">
              <div>
                <span className="text-xl font-bold text-card-foreground">{fmt(totalVentas)}</span>
                <span className="text-sm text-muted-foreground ml-1">de {fmt(meta)}</span>
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
                Faltan <strong className="text-card-foreground">{fmt(meta - totalVentas)}</strong>
              </div>
            )}
          </>
        ) : (
          <Empty text="Toca '+ Fijar meta' para tu objetivo" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 mb-3.5">
        {[
          ["Ventas totales", fmt(totalVentas), false],
          ["Facturas", facturas.length, false],
          ["Clientes", clientes.length, false],
          ["Stock bajo", lowStock, true],
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
          Ultimas facturas
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
          <Empty text="Sin facturas aun" />
        )}
      </div>

      <div className="bg-card rounded-2xl p-3.5 border border-border">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
          Actividad reciente
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
          <Empty text="Sin actividad" />
        )}
      </div>

      {editMeta && (
        <Modal title="Meta de ventas" onClose={() => setEditMeta(false)}>
          <Field label="Monto objetivo ($)">
            <input
              type="number"
              inputMode="decimal"
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
              className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={saveMeta}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
            >
              Guardar meta
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
  const { facturas, clientes, productos, addFactura, deleteFactura } = useData();
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [lineas, setLineas] = useState([{ prodId: "", qty: 1 }]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState("");
  const [fecha, setFecha] = useState(today());
  const [estado, setEstado] = useState("Pendiente");

  const filtered = q
    ? facturas.filter(
        (f) =>
          f.cli.toLowerCase().includes(q.toLowerCase()) ||
          String(f.num).includes(q)
      )
    : facturas;

  const subtotal = lineas.reduce((acc, l) => {
    const p = productos.find((x) => x.id === l.prodId);
    return acc + (p ? Number(p.precio) * Number(l.qty || 1) : 0);
  }, 0);
  const total = subtotal * 1.16;

  const handleSave = () => {
    if (!clienteSeleccionado) {
      alert("Selecciona un cliente");
      return;
    }
    if (lineas.length === 0 || lineas.every((l) => !l.prodId)) {
      alert("Agrega al menos un producto");
      return;
    }
    addFactura({
      cli: clienteSeleccionado,
      fecha,
      estado,
      total: +total.toFixed(2),
    });
    setShow(false);
    setLineas([{ prodId: "", qty: 1 }]);
    setClienteSeleccionado("");
    setFecha(today());
    setEstado("Pendiente");
  };

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar factura..."
        className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base mb-3 outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="bg-card rounded-2xl p-3.5 border border-border">
        {filtered.length ? (
          filtered.map((f) => (
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
                  <br />
                  <button
                    className="mt-1.5 px-2.5 py-1 rounded-lg bg-red-50 text-destructive text-xs"
                    onClick={() => {
                      if (confirm("Eliminar factura?")) deleteFactura(f.id);
                    }}
                  >
                    Eliminar
                  </button>
                </>
              }
            />
          ))
        ) : (
          <Empty text="Sin facturas. Toca + para crear." />
        )}
      </div>
      <button
        className="fixed bottom-[72px] right-4 w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg z-[6] flex items-center justify-center"
        onClick={() => setShow(true)}
      >
        +
      </button>

      {show && (
        <Modal title="Nueva Factura" onClose={() => setShow(false)}>
          <Field label="Cliente">
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
            <Field label="Fecha">
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Estado">
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              >
                <option>Pendiente</option>
                <option>Pagada</option>
                <option>En revision</option>
              </select>
            </Field>
          </Row2>
          <div className="text-sm font-semibold text-muted-foreground mb-2">
            Productos
          </div>
          {lineas.map((l, i) => (
            <div
              key={i}
              className="flex gap-1.5 mb-2 items-center bg-muted rounded-lg p-2"
            >
              <select
                value={l.prodId}
                onChange={(e) =>
                  setLineas((ls) =>
                    ls.map((x, j) =>
                      j === i ? { ...x, prodId: e.target.value } : x
                    )
                  )
                }
                className="flex-[2] px-2.5 py-2 rounded-lg border border-input bg-card text-card-foreground text-sm outline-none"
              >
                <option value="">Selecciona...</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom} - {fmt(p.precio)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={l.qty}
                onChange={(e) =>
                  setLineas((ls) =>
                    ls.map((x, j) =>
                      j === i
                        ? { ...x, qty: Math.max(1, Number(e.target.value)) }
                        : x
                    )
                  )
                }
                className="w-14 px-1.5 py-2 rounded-lg border border-input bg-card text-card-foreground text-sm text-center outline-none"
              />
              <button
                onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                className="bg-transparent border-none text-lg cursor-pointer text-muted-foreground"
              >
                X
              </button>
            </div>
          ))}
          <button
            onClick={() => setLineas((l) => [...l, { prodId: "", qty: 1 }])}
            className="w-full px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm mb-3"
          >
            + Agregar linea
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
              className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
            >
              Guardar Factura
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ------------------------------
// Clientes
// ------------------------------
const Clientes = () => {
  const { clientes, addCliente, deleteCliente } = useData();
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    nom: "",
    rfc: "",
    tel: "",
    email: "",
    dir: "",
    estado: "Activo",
  });

  const filtered = q
    ? clientes.filter(
        (c) =>
          c.nom.toLowerCase().includes(q.toLowerCase()) ||
          (c.rfc || "").toLowerCase().includes(q.toLowerCase())
      )
    : clientes;

  const handleSave = () => {
    if (!form.nom.trim()) {
      alert("Ingresa el nombre");
      return;
    }
    addCliente(form);
    setForm({ nom: "", rfc: "", tel: "", email: "", dir: "", estado: "Activo" });
    setShow(false);
  };

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar cliente..."
        className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base mb-3 outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="bg-card rounded-2xl p-3.5 border border-border">
        {filtered.length ? (
          filtered.map((c) => (
            <Li
              key={c.id}
              left={
                <>
                  <div className="text-sm font-semibold truncate text-card-foreground">
                    {c.nom}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.email || c.tel || c.rfc || "Sin contacto"}
                  </div>
                </>
              }
              right={
                <>
                  <Badge e={c.estado} />
                  <br />
                  <button
                    className="mt-1.5 px-2.5 py-1 rounded-lg bg-red-50 text-destructive text-xs"
                    onClick={() => {
                      if (confirm("Eliminar cliente?")) deleteCliente(c.id);
                    }}
                  >
                    Eliminar
                  </button>
                </>
              }
            />
          ))
        ) : (
          <Empty text="Sin clientes. Toca + para agregar." />
        )}
      </div>
      <button
        className="fixed bottom-[72px] right-4 w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg z-[6] flex items-center justify-center"
        onClick={() => setShow(true)}
      >
        +
      </button>

      {show && (
        <Modal title="Nuevo Cliente" onClose={() => setShow(false)}>
          <Field label="Nombre *">
            <input
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Row2>
            <Field label="RFC/ID">
              <input
                value={form.rfc}
                onChange={(e) => setForm({ ...form, rfc: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Telefono">
              <input
                value={form.tel}
                onChange={(e) => setForm({ ...form, tel: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          <Field label="Email">
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Direccion">
            <input
              value={form.dir}
              onChange={(e) => setForm({ ...form, dir: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Estado">
            <select
              value={form.estado}
              onChange={(e) => setForm({ ...form, estado: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            >
              <option>Activo</option>
              <option>Inactivo</option>
              <option>En espera</option>
            </select>
          </Field>
          <div className="flex gap-2.5 mt-3.5">
            <button
              onClick={() => setShow(false)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
            >
              Guardar Cliente
            </button>
          </div>
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
};

type SortKey = "nom" | "precio" | "stock" | "fabricante" | "barcode" | "sku";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "nom", label: "A-Z Descripcion" },
  { key: "precio", label: "Precio" },
  { key: "stock", label: "Inventario Actual" },
  { key: "fabricante", label: "Fabricante" },
  { key: "barcode", label: "Codigo de Barras" },
  { key: "sku", label: "SKU" },
];

// Normalize text for typo/accent tolerant matching:
// lowercases, strips accents, and collapses common Spanish spelling variants
// (e.g. "risos" -> "rizos", "kabello" -> "cabello").
const normTag = (s: string) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9ñ ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    // phonetic-ish folding for common DR/ES misspellings
    .replace(/z/g, "s") // rizos / risos
    .replace(/c([ei])/g, "s$1") // celular / selular
    .replace(/qu/g, "k")
    .replace(/c/g, "k") // cabello / kabello
    .replace(/v/g, "b") // vello / bello
    .replace(/h/g, "") // hair / air (silent h)
    .replace(/y/g, "i")
    .replace(/ll/g, "i")
    .replace(/(.)\1+/g, "$1"); // collapse doubled letters

const Inventario = () => {
  const { productos, addProducto, addProductosBulk, updateProducto, deleteProducto } = useData();
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkErr, setBulkErr] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [etqInput, setEtqInput] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("nom");
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
    icon: "",
    barcode: "",
  });

  // All unique tags across products, for the filter row
  const allTags = useMemo(() => {
    const set = new Set<string>();
    productos.forEach((p) => (p.etiquetas || []).forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [productos]);

  // Fuzzy search index over name, sku, barcode, and normalized tags
  const fuse = useMemo(
    () =>
      new Fuse(
        productos.map((p) => ({
          ...p,
          _tags: (p.etiquetas || []).join(" "),
          _normTags: (p.etiquetas || []).map(normTag).join(" "),
          _normNom: normTag(p.nom),
        })),
        {
          includeScore: true,
          threshold: 0.45, // tolerant of typos
          ignoreLocation: true,
          keys: [
            { name: "nom", weight: 2 },
            { name: "_normNom", weight: 2 },
            { name: "sku", weight: 1 },
            { name: "barcode", weight: 1 },
            { name: "_tags", weight: 2 },
            { name: "_normTags", weight: 2 },
          ],
        }
      ),
    [productos]
  );

  const filtered = useMemo(() => {
    let list = productos;

    // Text search (fuzzy, typo tolerant). Search both the raw query and its
    // normalized form so "risos" matches "rizos".
    if (q.trim()) {
      const ids = new Set<string>();
      [q, normTag(q)].forEach((term) => {
        if (!term.trim()) return;
        fuse.search(term).forEach((r) => ids.add(r.item.id));
      });
      list = list.filter((p) => ids.has(p.id));
    }

    // Tag filter (product must contain ALL selected tags)
    if (tagFilter.length) {
      list = list.filter((p) => {
        const pNorm = (p.etiquetas || []).map(normTag);
        return tagFilter.every((t) => pNorm.includes(normTag(t)));
      });
    }

    // Sorting. Numeric fields sort descending (highest first); text fields
    // sort A-Z using a locale-aware, accent-insensitive comparison so "Ácido"
    // and "Acido" order naturally and empty values fall to the end.
    const sorted = [...list];
    const textCmp = (a: string, b: string) =>
      (a || "").localeCompare(b || "", "es", { sensitivity: "base", numeric: true });
    const blankLast = (v: string) => (v && v.trim() ? 0 : 1);

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
    } else if (sortBy === "sku") {
      sorted.sort(
        (a, b) =>
          blankLast(a.sku || "") - blankLast(b.sku || "") ||
          textCmp(a.sku || "", b.sku || "")
      );
    } else {
      // Default: A-Z by description
      sorted.sort((a, b) => textCmp(a.nom, b.nom));
    }

    return sorted;
  }, [productos, q, tagFilter, fuse, sortBy]);

  const addTag = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (!t) return;
    if (form.etiquetas.some((e) => normTag(e) === normTag(t))) {
      setEtqInput("");
      return;
    }
    setForm((f) => ({ ...f, etiquetas: [...f.etiquetas, t] }));
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
      icon: "",
      barcode: "",
    });
    setMenuOpen(false);
    setShow(true);
  };

  const openEdit = (p: Producto) => {
    setEditId(p.id);
    setFoto(p.foto || null);
    setEtqInput("");
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
      icon: p.icon || "",
      barcode: p.barcode || "",
    });
    setShow(true);
  };

  const handleSave = () => {
    if (!form.nom.trim()) {
      alert("Ingresa el nombre");
      return;
    }
    // Fold any pending tag still in the input box into the list
    const etiquetas = etqInput.trim()
      ? form.etiquetas.some((e) => normTag(e) === normTag(etqInput))
        ? form.etiquetas
        : [...form.etiquetas, etqInput.trim().toLowerCase()]
      : form.etiquetas;
    const productData = {
      nom: form.nom,
      sku: form.sku,
      fabricante: form.fabricante,
      etiquetas,
      precio: Number(form.precio),
      costo: Number(form.costo),
      cajas: Number(form.cajas),
      stock: Number(form.stock),
      min: Number(form.min),
      icon: form.icon,
      barcode: form.barcode,
      foto,
    };
    if (editId) {
      updateProducto(editId, productData);
    } else {
      addProducto(productData);
    }
    setShow(false);
  };

  const handleFotoUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setFoto(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const openBulk = () => {
    setMenuOpen(false);
    setBulkRows([]);
    setBulkErr("");
    setShowBulk(true);
  };

  // Normalize a header to match it loosely (ignore case, accents, spaces)
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  const COLS: Record<keyof Omit<BulkRow, "_error">, string[]> = {
    sku: ["sku"],
    nom: ["descripcion", "descripcionn", "nombre", "producto"],
    fabricante: ["fabricante", "marca", "proveedor", "manufacturer"],
    stock: ["inventarioactual", "inventario", "stock", "existencia"],
    cajas: ["cantidadporcajas", "cantidadcajas", "cajas", "porcaja", "unidadesporcaja"],
    barcode: ["codigodebarras", "codigobarras", "barcode", "cb"],
    precio: ["precio", "precioventa", "venta"],
    costo: ["costo", "preciocosto"],
    min: ["inventariominimo", "minimo", "stockminimo", "min"],
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
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!json.length) {
        setBulkErr("El archivo esta vacio o no tiene filas de datos.");
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
          "No se encontro la columna 'Descripcion'. Verifica los encabezados o descarga la plantilla."
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
        return {
          sku: String(keyMap.sku ? r[keyMap.sku] : "").trim(),
          nom,
          fabricante: String(keyMap.fabricante ? r[keyMap.fabricante] : "").trim(),
          stock: keyMap.stock ? num(r[keyMap.stock]) : 0,
          cajas: keyMap.cajas ? num(r[keyMap.cajas]) : 0,
          barcode: String(keyMap.barcode ? r[keyMap.barcode] : "").trim(),
          precio: keyMap.precio ? num(r[keyMap.precio]) : 0,
          costo: keyMap.costo ? num(r[keyMap.costo]) : 0,
          min: keyMap.min ? num(r[keyMap.min]) : 5,
          _error: nom ? undefined : "Falta descripcion",
        };
      });
      setBulkRows(rows);
    } catch {
      setBulkErr("No se pudo leer el archivo. Asegurate de que sea un Excel valido (.xlsx).");
      setBulkRows([]);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "SKU",
        "Descripcion",
        "Fabricante",
        "Inventario Actual",
        "Cantidad por cajas",
        "Codigo de Barras",
        "Precio",
        "Costo",
        "Inventario minimo",
      ],
      ["SHP-001", "Shampoo Hidratante Pro", "Acromona", 45, 12, "7503000123401", 850, 520, 10],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");
    XLSX.writeFile(wb, "plantilla_inventario.xlsx");
  };

  const confirmBulk = async () => {
    const valid = bulkRows.filter((r) => !r._error);
    if (!valid.length) {
      setBulkErr("No hay filas validas para importar.");
      return;
    }
    setBulkSaving(true);
    try {
      const count = await addProductosBulk(
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
        }))
      );
      alert(`Se importaron ${count} productos correctamente.`);
      setShowBulk(false);
      setBulkRows([]);
    } catch {
      setBulkErr("Ocurrio un error al guardar. Intenta de nuevo.");
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre, codigo o etiqueta..."
        className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base mb-2.5 outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-2 mb-3">
        <label
          htmlFor="sortBy"
          className="text-xs text-muted-foreground shrink-0"
        >
          Ordenar por
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
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
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
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        {filtered.length ? (
          filtered.map((p) => {
            const stock = Number(p.stock);
            const min = Number(p.min || 5);
            const estado =
              stock <= 0 ? "Sin stock" : stock <= min ? "Stock bajo" : "En stock";
            return (
              <div
                key={p.id}
                className="bg-card border border-border rounded-2xl p-3 relative flex flex-col h-full"
              >
                <button
                  onClick={() => openEdit(p)}
                  className="absolute top-2 right-2 bg-card border border-border rounded-lg px-2 py-1 text-xs font-bold cursor-pointer text-secondary-foreground z-[1]"
                >
                  Editar
                </button>
                <div className="w-full h-20 rounded-lg overflow-hidden bg-muted flex items-center justify-center text-2xl mb-2 shrink-0">
                  {p.foto ? (
                    <img
                      src={p.foto}
                      alt={p.nom}
                      className="w-full h-full object-cover"
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
                {(p.etiquetas || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {p.etiquetas.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground"
                      >
                        {t}
                      </span>
                    ))}
                    {p.etiquetas.length > 4 && (
                      <span className="text-[10px] px-1 py-0.5 text-muted-foreground">
                        +{p.etiquetas.length - 4}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-auto pt-1.5">
                  <Badge e={estado} />
                  <div className="text-sm font-bold text-secondary-foreground mt-1">
                    {fmt(p.precio)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Stock: {stock} uds.
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-2">
            <Empty text="Sin productos. Toca + para agregar." />
          </div>
        )}
      </div>
      {menuOpen && (
        <div
          className="fixed inset-0 z-[6]"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className="fixed bottom-[72px] right-4 z-[7] flex flex-col items-end gap-2">
        {menuOpen && (
          <div className="flex flex-col gap-2 mb-1">
            <button
              onClick={openNew}
              className="flex items-center gap-2 bg-card border border-border text-card-foreground rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium whitespace-nowrap"
            >
              <span className="text-base" aria-hidden="true">✏️</span>
              Agregar Manualmente
            </button>
            <button
              onClick={openBulk}
              className="flex items-center gap-2 bg-card border border-border text-card-foreground rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium whitespace-nowrap"
            >
              <span className="text-base" aria-hidden="true">📄</span>
              Subir A Granel
            </button>
          </div>
        )}
        <button
          aria-label="Agregar producto"
          className={`w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg flex items-center justify-center transition-transform ${menuOpen ? "rotate-45" : ""}`}
          onClick={() => setMenuOpen((o) => !o)}
        >
          +
        </button>
      </div>

      {showBulk && (
        <Modal title="Subir Inventario A Granel" onClose={() => setShowBulk(false)}>
          <div className="text-sm text-muted-foreground mb-3 leading-relaxed">
            Sube un archivo Excel (.xlsx) con estas columnas:{" "}
            <span className="font-medium text-card-foreground">
              SKU, Descripcion, Fabricante, Inventario Actual, Cantidad por cajas,
              Codigo de Barras, Precio, Costo, Inventario minimo
            </span>
            .
          </div>
          <button
            onClick={downloadTemplate}
            className="w-full px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium text-sm mb-3"
          >
            Descargar plantilla de ejemplo
          </button>
          <div
            onClick={() => document.getElementById("excelInput")?.click()}
            className="w-full h-28 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer bg-muted mb-3"
          >
            <div className="text-2xl">📊</div>
            <div className="text-sm text-muted-foreground mt-1">
              Toca para seleccionar archivo Excel
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
                Vista previa ({bulkRows.filter((r) => !r._error).length} de{" "}
                {bulkRows.length} validos)
              </div>
              <div className="max-h-60 overflow-auto rounded-xl border border-border mb-3">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Descripcion</th>
                      <th className="px-2 py-1.5 font-medium">SKU</th>
                      <th className="px-2 py-1.5 font-medium text-right">Inv.</th>
                      <th className="px-2 py-1.5 font-medium text-right">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((r, i) => (
                      <tr
                        key={i}
                        className={`border-t border-border ${r._error ? "bg-red-50" : ""}`}
                      >
                        <td className="px-2 py-1.5 text-card-foreground">
                          {r.nom || (
                            <span className="text-destructive">{r._error}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono">
                          {r.sku}
                        </td>
                        <td className="px-2 py-1.5 text-right text-card-foreground">
                          {r.stock}
                        </td>
                        <td className="px-2 py-1.5 text-right text-card-foreground">
                          {fmt(r.precio)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex gap-2.5 mt-1">
            <button
              onClick={() => setShowBulk(false)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={confirmBulk}
              disabled={
                bulkSaving || !bulkRows.some((r) => !r._error)
              }
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50"
            >
              {bulkSaving
                ? "Importando..."
                : `Importar ${bulkRows.filter((r) => !r._error).length}`}
            </button>
          </div>
        </Modal>
      )}

      {show && (
        <Modal
          title={editId ? "Editar Producto" : "Nuevo Producto"}
          onClose={() => setShow(false)}
        >
          <Field label="Foto">
            <div
              onClick={() => document.getElementById("fotoInput")?.click()}
              className="w-full h-32 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer overflow-hidden bg-muted mb-1"
            >
              {foto ? (
                <img
                  src={foto}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <>
                  <div className="text-2xl">📷</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Toca para agregar foto
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
                className="w-full px-2.5 py-1 rounded-lg bg-red-50 text-destructive text-xs mb-1"
              >
                X Quitar foto
              </button>
            )}
          </Field>
          <Field label="Codigo de barras">
            <input
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Nombre *">
            <input
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="SKU">
            <input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Fabricante">
            <input
              value={form.fabricante}
              onChange={(e) => setForm({ ...form, fabricante: e.target.value })}
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
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(etqInput);
                  } else if (e.key === "Backspace" && !etqInput && form.etiquetas.length) {
                    removeTag(form.etiquetas[form.etiquetas.length - 1]);
                  }
                }}
                onBlur={() => etqInput.trim() && addTag(etqInput)}
                placeholder="Escribe y presiona Enter (ej. aceite, rizos, hair)"
                className="w-full px-1 py-1 bg-transparent text-card-foreground text-base outline-none"
              />
            </div>
          </Field>
          <Row2>
            <Field label="Precio ($)">
              <input
                type="number"
                step="0.01"
                value={form.precio}
                onChange={(e) => setForm({ ...form, precio: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Costo ($)">
              <input
                type="number"
                step="0.01"
                value={form.costo}
                onChange={(e) => setForm({ ...form, costo: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          <Row2>
            <Field label="Stock (Inv. actual)">
              <input
                type="number"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Cantidad por cajas">
              <input
                type="number"
                value={form.cajas}
                onChange={(e) => setForm({ ...form, cajas: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          <Row2>
            <Field label="Stock minimo">
              <input
                type="number"
                value={form.min}
                onChange={(e) => setForm({ ...form, min: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Emoji">
              <input
                value={form.icon}
                maxLength={2}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          {editId && (
            <button
              onClick={() => {
                if (confirm("Eliminar producto?")) {
                  deleteProducto(editId);
                  setShow(false);
                }
              }}
              className="w-full px-4 py-2.5 rounded-xl bg-red-50 text-destructive font-medium text-sm mb-3"
            >
              Eliminar producto
            </button>
          )}
          <div className="flex gap-2.5 mt-3.5">
            <button
              onClick={() => setShow(false)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
            >
              {editId ? "Actualizar" : "Guardar"} Producto
            </button>
          </div>
        </Modal>
      )}
      
    </div>
  );
};

// ------------------------------
// Ordenes
// ------------------------------
const Ordenes = () => {
  const { ordenes, clientes, productos, addOrden, updateOrden } = useData();
  const [show, setShow] = useState(false);
  const [picking, setPicking] = useState<Orden | null>(null);
  const [pickItems, setPickItems] = useState<(LineaOrden & { picked: boolean })[]>(
    []
  );
  const [lineas, setLineas] = useState([{ prodId: "", qty: 1 }]);
  const [form, setForm] = useState({
    cli: "",
    fecha: today(),
    estado: "Pendiente",
  });
  const manualRef = useRef<HTMLInputElement>(null);

  const total = lineas.reduce((acc, l) => {
    const p = productos.find((x) => x.id === l.prodId);
    return acc + (p ? Number(p.precio) * Number(l.qty || 1) : 0);
  }, 0);

  const handleSave = () => {
    if (!form.cli) {
      alert("Selecciona un cliente");
      return;
    }
    const items = lineas.filter((l) => l.prodId);
    if (items.length === 0) {
      alert("Agrega al menos un producto");
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
    setForm({ cli: "", fecha: today(), estado: "Pendiente" });
  };

  const startPick = (ord: Orden) => {
    if (!ord.lineas?.length) {
      alert("Esta orden no tiene productos detallados.");
      return;
    }
    setPicking(ord);
    setPickItems(ord.lineas.map((l) => ({ ...l, picked: false })));
  };

  const processPick = (code: string) => {
    setPickItems((prev) => {
      const idx = prev.findIndex(
        (i) => !i.picked && (i.barcode === code || i.sku === code)
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], picked: true };
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        if (updated.every((i) => i.picked)) {
          setTimeout(() => alert("Todos los productos pickeados!"), 150);
        }
        return updated;
      }
      alert(
        prev.some((i) => i.picked && (i.barcode === code || i.sku === code))
          ? "Ya pickeado"
          : `Codigo no encontrado: ${code}`
      );
      return prev;
    });
  };

  const completePick = () => {
    const done = pickItems.filter((i) => i.picked).length;
    if (
      done < pickItems.length &&
      !confirm(`Faltan ${pickItems.length - done} items. Completar de todas formas?`)
    )
      return;
    if (picking) {
      updateOrden(picking.id, { ...picking, estado: "Entregado" });
    }
    setPicking(null);
  };

  return (
    <div>
      <div className="bg-card rounded-2xl p-3.5 border border-border">
        {ordenes.length ? (
          ordenes.map((o) => (
            <Li
              key={o.id}
              left={
                <>
                  <div className="text-sm font-semibold truncate text-card-foreground">
                    {o.cli}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Orden #{o.num} - {fdate(o.fecha)}
                  </div>
                </>
              }
              right={
                <>
                  <div className="text-sm font-bold mb-0.5 text-card-foreground">{fmt(o.total)}</div>
                  <Badge e={o.estado} />
                  <br />
                  <button
                    className="mt-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground border border-primary text-xs font-bold"
                    onClick={() => startPick(o)}
                  >
                    📦 Picking
                  </button>
                </>
              }
            />
          ))
        ) : (
          <Empty text="Sin ordenes. Toca + para crear." />
        )}
      </div>
      <button
        className="fixed bottom-[72px] right-4 w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg z-[6] flex items-center justify-center"
        onClick={() => setShow(true)}
      >
        +
      </button>

      {show && (
        <Modal title="Nueva Orden" onClose={() => setShow(false)}>
          <Field label="Cliente">
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
            <Field label="Entrega">
              <input
                type="date"
                value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Estado">
              <select
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              >
                <option>Pendiente</option>
                <option>En proceso</option>
                <option>Entregado</option>
              </select>
            </Field>
          </Row2>
          <div className="text-sm font-semibold text-muted-foreground mb-2">
            Productos
          </div>
          {lineas.map((l, i) => (
            <div
              key={i}
              className="flex gap-1.5 mb-2 items-center bg-muted rounded-lg p-2"
            >
              <select
                value={l.prodId}
                onChange={(e) =>
                  setLineas((ls) =>
                    ls.map((x, j) =>
                      j === i ? { ...x, prodId: e.target.value } : x
                    )
                  )
                }
                className="flex-[2] px-2.5 py-2 rounded-lg border border-input bg-card text-card-foreground text-sm outline-none"
              >
                <option value="">Selecciona...</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom} - {fmt(p.precio)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={l.qty}
                onChange={(e) =>
                  setLineas((ls) =>
                    ls.map((x, j) =>
                      j === i
                        ? { ...x, qty: Math.max(1, Number(e.target.value)) }
                        : x
                    )
                  )
                }
                className="w-14 px-1.5 py-2 rounded-lg border border-input bg-card text-card-foreground text-sm text-center outline-none"
              />
              <button
                onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                className="bg-transparent border-none text-lg cursor-pointer text-muted-foreground"
              >
                X
              </button>
            </div>
          ))}
          <button
            onClick={() => setLineas((l) => [...l, { prodId: "", qty: 1 }])}
            className="w-full px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm mb-3"
          >
            + Agregar manualmente
          </button>
          <div className="text-right border-t border-border pt-2.5 mb-3">
            <strong className="text-base text-card-foreground">Total: {fmt(total)}</strong>
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={() => setShow(false)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
            >
              Guardar Orden
            </button>
          </div>
        </Modal>
      )}

      

      {picking && (
        <div className="fixed inset-0 bg-background z-40 flex flex-col max-w-[480px] mx-auto">
          <div className="bg-primary p-3.5 flex items-center gap-3 shrink-0">
            <button
              onClick={() => setPicking(null)}
              className="bg-white/20 border-none text-white text-lg cursor-pointer rounded-full w-8 h-8 flex items-center justify-center"
            >
              X
            </button>
            <span className="text-white text-base font-bold flex-1">
              Picking — Orden #{picking.num}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="bg-card rounded-2xl p-3.5 border border-border mb-3">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
                Progreso: {pickItems.filter((i) => i.picked).length}/
                {pickItems.length} items
              </div>
              {pickItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-2.5 border-b border-border last:border-b-0"
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${item.picked ? "bg-primary text-primary-foreground" : "border-2 border-border"}`}
                  >
                    {item.picked ? "✓" : ""}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-card-foreground">{item.prodNom}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.barcode
                        ? `CB: ${item.barcode}`
                        : item.sku
                          ? `SKU: ${item.sku}`
                          : "Sin codigo"}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-secondary-foreground">
                    x{item.qty}
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-card rounded-2xl p-3.5 border border-border mb-3">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Escanear para confirmar
              </div>
              <div className="flex gap-2 mb-2.5">
                <input
                  ref={manualRef}
                  type="text"
                  placeholder="Codigo de barras..."
                  inputMode="numeric"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && manualRef.current) {
                      processPick(manualRef.current.value);
                      manualRef.current.value = "";
                    }
                  }}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={() => {
                    if (manualRef.current) {
                      processPick(manualRef.current.value);
                      manualRef.current.value = "";
                    }
                  }}
                  className="shrink-0 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
                >
                  OK
                </button>
              </div>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setPicking(null)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
              >
                Cerrar
              </button>
              <button
                onClick={completePick}
                className={`flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm ${pickItems.every((i) => i.picked) ? "" : "opacity-60"}`}
              >
                Completar orden
              </button>
            </div>
          </div>
        </div>
      )}

      
    </div>
  );
};

// ------------------------------
// Mejoras
// ------------------------------
const PRIORIDADES = ["Alta", "Media", "Baja"];
const ESTADOS_MEJORA = ["Pendiente", "En progreso", "Completada"];
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
  const { mejoras, addMejora, updateMejora, deleteMejora } = useData();
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    titulo: "",
    descripcion: "",
    costo: "",
    prioridad: "Media",
    estado: "Pendiente",
  });

  // Pending improvements (not completed), sorted by priority
  const pendientes = useMemo(
    () =>
      mejoras
        .filter((m) => m.estado !== "Completada")
        .sort(
          (a, b) =>
            (PRIO_ORDER[a.prioridad] ?? 1) - (PRIO_ORDER[b.prioridad] ?? 1)
        ),
    [mejoras]
  );
  const completadas = useMemo(
    () => mejoras.filter((m) => m.estado === "Completada"),
    [mejoras]
  );
  const costoTotal = useMemo(
    () =>
      mejoras
        .filter((m) => m.estado !== "Completada")
        .reduce((sum, m) => sum + Number(m.costo || 0), 0),
    [mejoras]
  );

  const reset = () => {
    setForm({
      titulo: "",
      descripcion: "",
      costo: "",
      prioridad: "Media",
      estado: "Pendiente",
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
      prioridad: m.prioridad || "Media",
      estado: m.estado || "Pendiente",
    });
    setShow(true);
  };

  const handleSave = () => {
    if (!form.titulo.trim()) {
      alert("Ingresa el titulo de la mejora");
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
        <UpgradeIcon done={m.estado === "Completada"} />
      </div>
      {m.descripcion && (
        <div className="text-xs text-muted-foreground leading-relaxed break-words mb-2">
          {m.descripcion}
        </div>
      )}
      <div className="flex items-center justify-between gap-2.5">
        <div className="text-sm font-bold text-secondary-foreground">
          {Number(m.costo) > 0 ? `Costo est.: ${fmt(Number(m.costo))}` : "Sin costo estimado"}
        </div>
        <div className="flex gap-1.5">
          <button
            className="px-2.5 py-1 rounded-lg bg-card border border-border text-secondary-foreground text-xs font-bold"
            onClick={() => openEdit(m)}
          >
            Editar
          </button>
          <button
            className="px-2.5 py-1 rounded-lg bg-red-50 text-destructive text-xs font-bold"
            onClick={() => {
              if (confirm("Eliminar esta mejora?")) deleteMejora(m.id);
            }}
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 mb-3.5">
        <div className="bg-card rounded-xl p-3.5 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Mejoras pendientes</div>
          <div className="text-xl font-bold text-card-foreground">{pendientes.length}</div>
        </div>
        <div className="bg-card rounded-xl p-3.5 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Inversion estimada</div>
          <div className="text-xl font-bold text-card-foreground">{fmt(costoTotal)}</div>
        </div>
      </div>

      {mejoras.length === 0 ? (
        <div className="bg-card rounded-2xl p-3.5 border border-border">
          <Empty text="Sin mejoras todavia. Toca + para agregar una idea para el negocio." />
        </div>
      ) : (
        <>
          {pendientes.map(card)}
          {completadas.length > 0 && (
            <>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mt-4 mb-2">
                Completadas
              </div>
              {completadas.map(card)}
            </>
          )}
        </>
      )}

      <button
        className="fixed bottom-[72px] right-4 w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg z-[6] flex items-center justify-center"
        onClick={openNew}
        aria-label="Agregar mejora"
      >
        +
      </button>

      {show && (
        <Modal
          title={editId ? "Editar Mejora" : "Nueva Mejora"}
          onClose={() => {
            reset();
            setShow(false);
          }}
        >
          <Field label="Mejora *">
            <input
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder="Ej. Adquirir una van"
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
              type="number"
              step="0.01"
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
              className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
            >
              {editId ? "Guardar Cambios" : "Guardar Mejora"}
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
const ICONS: Record<string, string> = {
  dash: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  fact: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  cli: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  inv: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
  ord: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17M17 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
  mej: "M9 18h6 M10 22h4 M15.09 14c.18-.79.65-1.47 1.16-2.05A5 5 0 0 0 12 4a5 5 0 0 0-4.25 7.95c.51.58.98 1.26 1.16 2.05",
};

const TABS = [
  { id: "dash", label: "Inicio" },
  { id: "fact", label: "Facturas" },
  { id: "cli", label: "Clientes" },
  { id: "inv", label: "Inventario" },
  { id: "ord", label: "Ordenes" },
  { id: "mej", label: "Mejoras" },
];

const TITLES: Record<string, string> = {
  dash: "Dashboard",
  fact: "Facturacion",
  cli: "Clientes",
  inv: "Inventario",
  ord: "Ordenes",
  mej: "Mejoras",
};

function AppContent() {
  const [tab, setTab] = useState("dash");
  const { loading } = useData();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || ""));
  }, [supabase]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/auth/login");
  };

  const panels: Record<string, ReactNode> = {
    dash: <Dashboard />,
    fact: <Facturas />,
    cli: <Clientes />,
    inv: <Inventario />,
    ord: <Ordenes />,
    mej: <Mejoras />,
  };

  return (
    <div className="max-w-[480px] mx-auto min-h-svh flex flex-col bg-background">
      <header className="bg-card border-b border-border px-4 py-2.5 flex items-center justify-between sticky top-0 z-[5]">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-lg font-black text-primary font-serif border border-secondary tracking-tighter">
            PH
          </div>
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
          Cargando datos...
        </div>
      )}
      <main className="flex-1 p-3 pb-20 overflow-y-auto">{panels[tab]}</main>
      <nav className="bg-card border-t border-border flex fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-[5]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-2.5 px-0.5 cursor-pointer text-xs gap-1 border-none bg-transparent font-sans ${tab === t.id ? "text-secondary-foreground font-bold" : "text-muted-foreground font-normal"}`}
          >
            <svg
              width={22}
              height={22}
              viewBox="0 0 24 24"
              fill="none"
              stroke={tab === t.id ? "var(--secondary-foreground)" : "var(--muted-foreground)"}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={ICONS[t.id]} />
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
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
