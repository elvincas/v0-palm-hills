"use client";

import { useState, useEffect, useMemo, createContext, useContext, useRef, useCallback, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

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
  cat?: string;
  precio: number;
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

interface Empleado {
  id: string;
  nom: string;
  puesto?: string;
  dept?: string;
  sal: number;
  ded: number;
  fecha?: string;
  estado: string;
  email?: string;
}

interface LogEntry {
  msg: string;
  ts: string;
}

// ------------------------------
// Utilities
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
  nomina: Empleado[];
  logs: LogEntry[];
  loading: boolean;
  userEmail: string | null;
  signOut: () => Promise<void>;
  addCliente: (c: Omit<Cliente, "id">) => Promise<void>;
  deleteCliente: (id: string) => Promise<void>;
  updateCliente: (id: string, c: Omit<Cliente, "id">) => Promise<void>;
  addProducto: (p: Omit<Producto, "id">) => Promise<void>;
  updateProducto: (id: string, p: Omit<Producto, "id">) => Promise<void>;
  deleteProducto: (id: string) => Promise<void>;
  addFactura: (f: Omit<Factura, "id" | "num">) => Promise<number>;
  deleteFactura: (id: string) => Promise<void>;
  addOrden: (o: Omit<Orden, "id" | "num">) => Promise<number>;
  deleteOrden: (id: string) => Promise<void>;
  updateOrden: (id: string, o: Orden) => Promise<void>;
  addEmpleado: (e: Omit<Empleado, "id">) => Promise<void>;
  deleteEmpleado: (id: string) => Promise<void>;
  updateEmpleado: (id: string, e: Omit<Empleado, "id">) => Promise<void>;
  refreshLogs: () => Promise<void>;
}

const DataContext = createContext<DataContextType | null>(null);

// Convert empty strings to null for nullable columns
const nn = (v: unknown) => {
  if (v === "" || v === undefined) return null;
  return v;
};

const DataProvider = ({ children }: { children: ReactNode }) => {
  const supabase = useMemo(() => createClient(), []);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [nomina, setNomina] = useState<Empleado[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // ---- Loaders ----
  const loadClientes = useCallback(async () => {
    const { data } = await supabase
      .from("clientes")
      .select("*")
      .order("created_at", { ascending: false });
    setClientes(
      (data ?? []).map((r) => ({
        id: r.id,
        nom: r.nombre,
        rfc: r.rfc ?? undefined,
        tel: r.telefono ?? undefined,
        email: r.email ?? undefined,
        dir: r.direccion ?? undefined,
        estado: r.estado,
      }))
    );
  }, [supabase]);

  const loadProductos = useCallback(async () => {
    const { data } = await supabase
      .from("productos")
      .select("*")
      .order("created_at", { ascending: false });
    setProductos(
      (data ?? []).map((r) => ({
        id: r.id,
        nom: r.nombre,
        sku: r.sku ?? undefined,
        barcode: r.barcode ?? undefined,
        cat: r.categoria ?? undefined,
        precio: Number(r.precio),
        stock: Number(r.stock),
        min: Number(r.stock_minimo),
        foto: r.foto ?? null,
      }))
    );
  }, [supabase]);

  const loadFacturas = useCallback(async () => {
    const { data } = await supabase
      .from("facturas")
      .select("*")
      .order("created_at", { ascending: false });
    setFacturas(
      (data ?? []).map((r) => ({
        id: r.id,
        num: Number(r.folio) || 0,
        cli: r.cliente_nombre ?? "",
        fecha: r.fecha,
        estado: r.estado,
        total: Number(r.total),
      }))
    );
  }, [supabase]);

  const loadOrdenes = useCallback(async () => {
    const { data: ords } = await supabase
      .from("ordenes")
      .select("*")
      .order("created_at", { ascending: false });
    const { data: lns } = await supabase.from("orden_lineas").select("*");
    setOrdenes(
      (ords ?? []).map((o) => ({
        id: o.id,
        num: Number(o.folio) || 0,
        cli: o.cliente_nombre ?? "",
        fecha: o.fecha,
        estado: o.estado,
        total: Number(o.total),
        lineas: (lns ?? [])
          .filter((l) => l.orden_id === o.id)
          .map((l) => ({
            prodId: l.producto_id ?? "",
            prodNom: l.descripcion,
            barcode: l.barcode ?? "",
            sku: l.sku ?? "",
            precio: Number(l.precio),
            qty: Number(l.cantidad),
            picked: l.surtido,
          })),
      }))
    );
  }, [supabase]);

  const loadNomina = useCallback(async () => {
    const { data } = await supabase
      .from("empleados")
      .select("*")
      .order("created_at", { ascending: false });
    setNomina(
      (data ?? []).map((r) => ({
        id: r.id,
        nom: r.nombre,
        puesto: r.puesto ?? undefined,
        dept: r.departamento ?? undefined,
        sal: Number(r.salario),
        ded: Number(r.deducciones),
        fecha: r.fecha_ingreso ?? undefined,
        estado: r.estado,
        email: r.email ?? undefined,
      }))
    );
  }, [supabase]);

  const refreshLogs = useCallback(async () => {
    const { data } = await supabase
      .from("actividad")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    setLogs(
      (data ?? []).map((r) => ({
        msg: r.descripcion,
        ts: new Date(r.created_at).toLocaleTimeString("es-MX", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      }))
    );
  }, [supabase]);

  const logAct = useCallback(
    async (msg: string, tipo = "general") => {
      await supabase
        .from("actividad")
        .insert({ tipo, descripcion: msg, usuario_email: userEmail });
    },
    [supabase, userEmail]
  );

  // ---- Initial load ----
  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active) return;
      setUserEmail(user?.email ?? null);
      await Promise.all([
        loadClientes(),
        loadProductos(),
        loadFacturas(),
        loadOrdenes(),
        loadNomina(),
        refreshLogs(),
      ]);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [
    supabase,
    loadClientes,
    loadProductos,
    loadFacturas,
    loadOrdenes,
    loadNomina,
    refreshLogs,
  ]);

  // ---- Clientes ----
  const addCliente = async (c: Omit<Cliente, "id">) => {
    await supabase.from("clientes").insert({
      nombre: c.nom,
      rfc: nn(c.rfc),
      telefono: nn(c.tel),
      email: nn(c.email),
      direccion: nn(c.dir),
      estado: c.estado,
    });
    await logAct(`Nuevo cliente: ${c.nom}`, "cliente");
    await Promise.all([loadClientes(), refreshLogs()]);
  };

  const deleteCliente = async (id: string) => {
    await supabase.from("clientes").delete().eq("id", id);
    await logAct(`Cliente eliminado`, "cliente");
    await Promise.all([loadClientes(), refreshLogs()]);
  };

  const updateCliente = async (id: string, c: Omit<Cliente, "id">) => {
    await supabase
      .from("clientes")
      .update({
        nombre: c.nom,
        rfc: nn(c.rfc),
        telefono: nn(c.tel),
        email: nn(c.email),
        direccion: nn(c.dir),
        estado: c.estado,
      })
      .eq("id", id);
    await logAct(`Cliente actualizado: ${c.nom}`, "cliente");
    await Promise.all([loadClientes(), refreshLogs()]);
  };

  // ---- Productos ----
  const addProducto = async (p: Omit<Producto, "id">) => {
    await supabase.from("productos").insert({
      nombre: p.nom,
      sku: nn(p.sku),
      barcode: nn(p.barcode),
      categoria: nn(p.cat),
      precio: Math.max(0, Number(p.precio) || 0),
      stock: Math.max(0, Number(p.stock) || 0),
      stock_minimo: Math.max(0, Number(p.min) || 5),
      foto: nn(p.foto),
    });
    await logAct(`Nuevo producto: ${p.nom}`, "producto");
    await Promise.all([loadProductos(), refreshLogs()]);
  };

  const updateProducto = async (id: string, p: Omit<Producto, "id">) => {
    await supabase
      .from("productos")
      .update({
        nombre: p.nom,
        sku: nn(p.sku),
        barcode: nn(p.barcode),
        categoria: nn(p.cat),
        precio: Math.max(0, Number(p.precio) || 0),
        stock: Math.max(0, Number(p.stock) || 0),
        stock_minimo: Math.max(0, Number(p.min) || 5),
        foto: nn(p.foto),
      })
      .eq("id", id);
    await logAct(`Producto actualizado: ${p.nom}`, "producto");
    await Promise.all([loadProductos(), refreshLogs()]);
  };

  const deleteProducto = async (id: string) => {
    await supabase.from("productos").delete().eq("id", id);
    await logAct(`Producto eliminado`, "producto");
    await Promise.all([loadProductos(), refreshLogs()]);
  };

  // ---- Facturas ----
  const addFactura = async (f: Omit<Factura, "id" | "num">) => {
    const maxNum = Math.max(1000, ...facturas.map((x) => x.num));
    const newNum = maxNum + 1;
    await supabase.from("facturas").insert({
      folio: String(newNum),
      cliente_nombre: f.cli,
      fecha: f.fecha,
      estado: f.estado,
      total: f.total,
    });
    await logAct(`Factura #${newNum} -> ${f.cli}`, "factura");
    await Promise.all([loadFacturas(), refreshLogs()]);
    return newNum;
  };

  const deleteFactura = async (id: string) => {
    await supabase.from("facturas").delete().eq("id", id);
    await logAct(`Factura eliminada`, "factura");
    await Promise.all([loadFacturas(), refreshLogs()]);
  };

  // ---- Ordenes ----
  const addOrden = async (o: Omit<Orden, "id" | "num">) => {
    const maxNum = Math.max(0, ...ordenes.map((x) => x.num));
    const newNum = maxNum + 1;
    const { data, error } = await supabase
      .from("ordenes")
      .insert({
        folio: String(newNum),
        cliente_nombre: o.cli,
        fecha: o.fecha,
        estado: o.estado,
        total: o.total,
      })
      .select()
      .single();
    if (!error && data && o.lineas?.length) {
      await supabase.from("orden_lineas").insert(
        o.lineas.map((l) => ({
          orden_id: data.id,
          producto_id: nn(l.prodId),
          descripcion: l.prodNom,
          barcode: nn(l.barcode),
          sku: nn(l.sku),
          cantidad: l.qty,
          precio: l.precio,
          surtido: l.picked ?? false,
        }))
      );
    }
    await logAct(`Orden #${newNum} -> ${o.cli}`, "orden");
    await Promise.all([loadOrdenes(), refreshLogs()]);
    return newNum;
  };

  const deleteOrden = async (id: string) => {
    await supabase.from("ordenes").delete().eq("id", id);
    await logAct(`Orden eliminada`, "orden");
    await Promise.all([loadOrdenes(), refreshLogs()]);
  };

  const updateOrden = async (id: string, updated: Orden) => {
    await supabase
      .from("ordenes")
      .update({
        cliente_nombre: updated.cli,
        fecha: updated.fecha,
        estado: updated.estado,
        total: updated.total,
      })
      .eq("id", id);
    await logAct(`Orden #${updated.num} actualizada`, "orden");
    await Promise.all([loadOrdenes(), refreshLogs()]);
  };

  // ---- Empleados ----
  const addEmpleado = async (e: Omit<Empleado, "id">) => {
    await supabase.from("empleados").insert({
      nombre: e.nom,
      puesto: nn(e.puesto),
      departamento: nn(e.dept),
      salario: Math.max(0, Number(e.sal) || 0),
      deducciones: Math.max(0, Number(e.ded) || 0),
      fecha_ingreso: nn(e.fecha),
      estado: e.estado,
      email: nn(e.email),
    });
    await logAct(`Empleado agregado: ${e.nom}`, "empleado");
    await Promise.all([loadNomina(), refreshLogs()]);
  };

  const deleteEmpleado = async (id: string) => {
    await supabase.from("empleados").delete().eq("id", id);
    await logAct(`Empleado eliminado`, "empleado");
    await Promise.all([loadNomina(), refreshLogs()]);
  };

  const updateEmpleado = async (id: string, e: Omit<Empleado, "id">) => {
    await supabase
      .from("empleados")
      .update({
        nombre: e.nom,
        puesto: nn(e.puesto),
        departamento: nn(e.dept),
        salario: Math.max(0, Number(e.sal) || 0),
        deducciones: Math.max(0, Number(e.ded) || 0),
        fecha_ingreso: nn(e.fecha),
        estado: e.estado,
        email: nn(e.email),
      })
      .eq("id", id);
    await logAct(`Empleado actualizado: ${e.nom}`, "empleado");
    await Promise.all([loadNomina(), refreshLogs()]);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  };

  const value: DataContextType = {
    clientes,
    productos,
    facturas,
    ordenes,
    nomina,
    logs,
    loading,
    userEmail,
    signOut,
    addCliente,
    deleteCliente,
    updateCliente,
    addProducto,
    updateProducto,
    deleteProducto,
    addFactura,
    deleteFactura,
    addOrden,
    deleteOrden,
    updateOrden,
    addEmpleado,
    deleteEmpleado,
    updateEmpleado,
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
    return Number(localStorage.getItem("ph_meta") || 150000);
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
const Inventario = () => {
  const { productos, addProducto, updateProducto, deleteProducto } = useData();
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [form, setForm] = useState({
    nom: "",
    sku: "",
    cat: "",
    precio: "",
    stock: "",
    min: "5",
    icon: "",
    barcode: "",
  });

  const filtered = q
    ? productos.filter(
        (p) =>
          p.nom.toLowerCase().includes(q.toLowerCase()) ||
          p.sku?.toLowerCase().includes(q.toLowerCase()) ||
          (p.barcode || "").includes(q)
      )
    : productos;

  const openNew = () => {
    setEditId(null);
    setFoto(null);
    setForm({
      nom: "",
      sku: "",
      cat: "",
      precio: "",
      stock: "",
      min: "5",
      icon: "",
      barcode: "",
    });
    setShow(true);
  };

  const openEdit = (p: Producto) => {
    setEditId(p.id);
    setFoto(p.foto || null);
    setForm({
      nom: p.nom || "",
      sku: p.sku || "",
      cat: p.cat || "",
      precio: String(p.precio),
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
    const productData = {
      nom: form.nom,
      sku: form.sku,
      cat: form.cat,
      precio: Number(form.precio),
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

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar producto o codigo..."
        className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base mb-3 outline-none focus:ring-2 focus:ring-ring"
      />
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
                className="bg-card border border-border rounded-2xl p-3 relative"
              >
                <button
                  onClick={() => openEdit(p)}
                  className="absolute top-2 right-2 bg-card border border-border rounded-lg px-2 py-1 text-xs font-bold cursor-pointer text-secondary-foreground"
                >
                  Editar
                </button>
                <div className="w-full h-20 rounded-lg overflow-hidden bg-muted flex items-center justify-center text-2xl mb-2">
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
                <div className="text-xs font-bold mb-0.5 truncate text-card-foreground">
                  {p.nom}
                </div>
                <div className="text-xs text-muted-foreground font-mono mb-0.5">
                  {p.sku}
                </div>
                {p.barcode && (
                  <div className="text-xs text-muted-foreground font-mono mb-0.5">
                    CB: {p.barcode}
                  </div>
                )}
                <Badge e={estado} />
                <div className="text-sm font-bold text-secondary-foreground mt-0.5">
                  {fmt(p.precio)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Stock: {stock} uds.
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
      <button
        className="fixed bottom-[72px] right-4 w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg z-[6] flex items-center justify-center"
        onClick={openNew}
      >
        +
      </button>

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
          <Row2>
            <Field label="SKU">
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Categoria">
              <input
                value={form.cat}
                onChange={(e) => setForm({ ...form, cat: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
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
            <Field label="Stock">
              <input
                type="number"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
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
// Nomina
// ------------------------------
const Nomina = () => {
  const { nomina, addEmpleado, deleteEmpleado } = useData();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    nom: "",
    puesto: "",
    dept: "",
    sal: "",
    ded: "",
    fecha: "",
    estado: "Al corriente",
    email: "",
  });

  const totalBruto = useMemo(
    () => nomina.reduce((sum, e) => sum + Number(e.sal), 0),
    [nomina]
  );
  const totalNeto = useMemo(
    () =>
      nomina.reduce((sum, e) => sum + (Number(e.sal) - Number(e.ded || 0)), 0),
    [nomina]
  );

  const handleSave = () => {
    if (!form.nom.trim()) {
      alert("Ingresa el nombre");
      return;
    }
    addEmpleado({
      nom: form.nom,
      puesto: form.puesto,
      dept: form.dept,
      sal: Number(form.sal),
      ded: Number(form.ded),
      fecha: form.fecha,
      estado: form.estado,
      email: form.email,
    });
    setForm({
      nom: "",
      puesto: "",
      dept: "",
      sal: "",
      ded: "",
      fecha: "",
      estado: "Al corriente",
      email: "",
    });
    setShow(false);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 mb-3.5">
        <div className="bg-card rounded-xl p-3.5 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Nomina bruta</div>
          <div className="text-xl font-bold text-card-foreground">{fmt(totalBruto)}</div>
        </div>
        <div className="bg-card rounded-xl p-3.5 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Neto total</div>
          <div className="text-xl font-bold text-card-foreground">{fmt(totalNeto)}</div>
        </div>
      </div>
      <div className="bg-card rounded-2xl p-3.5 border border-border">
        {nomina.length ? (
          nomina.map((n) => (
            <Li
              key={n.id}
              left={
                <>
                  <div className="text-sm font-semibold truncate text-card-foreground">
                    {n.nom}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {n.puesto || ""} - Neto:{" "}
                    {fmt(Number(n.sal) - Number(n.ded || 0))}
                  </div>
                </>
              }
              right={
                <>
                  <Badge e={n.estado} />
                  <br />
                  <button
                    className="mt-1.5 px-2.5 py-1 rounded-lg bg-red-50 text-destructive text-xs"
                    onClick={() => {
                      if (confirm("Eliminar empleado?")) deleteEmpleado(n.id);
                    }}
                  >
                    Eliminar
                  </button>
                </>
              }
            />
          ))
        ) : (
          <Empty text="Sin empleados. Toca + para agregar." />
        )}
      </div>
      <button
        className="fixed bottom-[72px] right-4 w-13 h-13 rounded-full bg-primary text-primary-foreground text-2xl border-none cursor-pointer shadow-lg z-[6] flex items-center justify-center"
        onClick={() => setShow(true)}
      >
        +
      </button>

      {show && (
        <Modal title="Nuevo Empleado" onClose={() => setShow(false)}>
          <Field label="Nombre *">
            <input
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Row2>
            <Field label="Puesto">
              <input
                value={form.puesto}
                onChange={(e) => setForm({ ...form, puesto: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Departamento">
              <input
                value={form.dept}
                onChange={(e) => setForm({ ...form, dept: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          <Row2>
            <Field label="Salario bruto ($)">
              <input
                type="number"
                step="0.01"
                value={form.sal}
                onChange={(e) => setForm({ ...form, sal: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Deducciones ($)">
              <input
                type="number"
                step="0.01"
                value={form.ded}
                onChange={(e) => setForm({ ...form, ded: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </Row2>
          <Row2>
            <Field label="Fecha ingreso">
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
                <option>Al corriente</option>
                <option>Incidencia</option>
                <option>Baja</option>
              </select>
            </Field>
          </Row2>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base outline-none focus:ring-2 focus:ring-ring"
            />
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
              Guardar Empleado
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
  nom: "M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
};

const TABS = [
  { id: "dash", label: "Inicio" },
  { id: "fact", label: "Facturas" },
  { id: "cli", label: "Clientes" },
  { id: "inv", label: "Inventario" },
  { id: "ord", label: "Ordenes" },
  { id: "nom", label: "Nomina" },
];

const TITLES: Record<string, string> = {
  dash: "Dashboard",
  fact: "Facturacion",
  cli: "Clientes",
  inv: "Inventario",
  ord: "Ordenes",
  nom: "Nomina",
};

function AppContent() {
  const [tab, setTab] = useState("dash");
  const { loading, userEmail, signOut } = useData();

  if (loading) {
    return (
      <div className="max-w-[480px] mx-auto min-h-svh flex flex-col items-center justify-center bg-background gap-3">
        <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-xl font-black text-primary font-serif border border-secondary tracking-tighter">
          PH
        </div>
        <div className="text-sm text-muted-foreground">Cargando datos...</div>
      </div>
    );
  }

  const panels: Record<string, ReactNode> = {
    dash: <Dashboard />,
    fact: <Facturas />,
    cli: <Clientes />,
    inv: <Inventario />,
    ord: <Ordenes />,
    nom: <Nomina />,
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
        <div className="flex items-center gap-2.5">
          <div className="text-right hidden xs:block">
            <div className="text-xs text-muted-foreground font-medium">
              {TITLES[tab]}
            </div>
            {userEmail && (
              <div className="text-[10px] text-muted-foreground/70 truncate max-w-[120px]">
                {userEmail}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              if (confirm("Cerrar sesion?")) signOut();
            }}
            aria-label="Cerrar sesion"
            className="shrink-0 w-9 h-9 rounded-lg border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
          >
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>
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
