"use client";

// app/clientes/[id]/page.tsx

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { BackButton } from "@/components/back-button";

interface TelefonoContacto {
  rol: string;
  nombre?: string;
  num: string;
}

interface NotaVisita {
  id: string;
  fecha: string;
  texto: string;
  ts: string;
}

interface TodoCliente {
  id: string;
  texto: string;
  completado: boolean;
  fecha_limite?: string;
  created_at: string;
}

interface Cliente {
  id: string;
  nom: string;
  codigo_cliente?: string;
  dir?: string;
  ciudad?: string;
  estado_dir?: string;
  estado: string;
  contacto?: string;
  tel?: string;
  email?: string;
  abierto_sabados?: boolean;
  foto_local?: string;
  telefonos?: TelefonoContacto[];
  fax?: string;
  notas_visita?: NotaVisita[];
  lista_precio_id?: string | null;
}

interface Factura {
  id: string;
  num: number;
  fecha: string;
  estado: string;
  total: number;
  lineas?: { prodNom: string; sku?: string; qty: number; precio: number }[];
}

interface NotaCredito {
  id: string;
  num: number;
  fecha: string;
  monto: number;
  motivo: string;
  aplicada?: boolean;
  aplicada_en?: string;
}

interface Orden {
  id: string;
  num: number;
  cli: string;
  fecha: string;
  estado: string;
  total: number;
}

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

const FACTURA_BADGE: Record<string, string> = {
  Paid: "bg-green-100 text-green-800",
  Pending: "bg-amber-100 text-amber-800",
  "In Review": "bg-blue-100 text-blue-800",
};

const FacturaBadge = ({ e }: { e: string }) => (
  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold inline-flex ${FACTURA_BADGE[e] || "bg-blue-100 text-blue-800"}`}>
    {e}
  </span>
);

const ORDEN_BADGE: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
  Cancelled: "bg-red-100 text-red-800",
};

const OrdenBadge = ({ e }: { e: string }) => (
  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold inline-flex ${ORDEN_BADGE[e] || "bg-blue-100 text-blue-800"}`}>
    {e}
  </span>
);

const ESTADO_CLIENTE_BADGE: Record<string, string> = {
  Active: "bg-green-100 text-green-800",
  Inactive: "bg-red-100 text-red-800",
  Waiting: "bg-amber-100 text-amber-800",
};

const EstadoClienteBadge = ({ e }: { e: string }) => (
  <span className={`px-3 py-1 rounded-full text-xs font-bold inline-flex ${ESTADO_CLIENTE_BADGE[e] || "bg-blue-100 text-blue-800"}`}>
    {e || "Not specified"}
  </span>
);

// Estilos de botones tipo "vidrio" (glassmorphism), reutilizables en esta pagina
const GLASS_BTN =
  "backdrop-blur-md bg-white/50 border border-white/60 shadow-sm hover:bg-white/70 active:scale-[0.97] transition-all text-card-foreground";
const GLASS_BTN_PRIMARY =
  "backdrop-blur-md bg-primary/85 border border-white/30 shadow-md hover:bg-primary/95 active:scale-[0.97] transition-all text-primary-foreground";

export default function ClientePerfilPage() {
  const params = useParams();
  const clienteId = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [form, setForm] = useState<Cliente | null>(null);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [loadingFacturas, setLoadingFacturas] = useState(true);
  const [notasCredito, setNotasCredito] = useState<NotaCredito[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loadingOrdenes, setLoadingOrdenes] = useState(true);
  const [hasDraft, setHasDraft] = useState(false);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [showNota, setShowNota] = useState(false);
  const [notaTexto, setNotaTexto] = useState("");
  const [savingNota, setSavingNota] = useState(false);
  const [showAddPhone, setShowAddPhone] = useState(false);
  const [newPhoneRol, setNewPhoneRol] = useState("");
  const [newPhoneNombre, setNewPhoneNombre] = useState("");
  const [newPhoneNum, setNewPhoneNum] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [editFax, setEditFax] = useState(false);
  const [faxValue, setFaxValue] = useState("");
  const [todos, setTodos] = useState<TodoCliente[]>([]);
  const [listasPrecios, setListasPrecios] = useState<{ id: string; nombre: string }[]>([]);
  const [savingLista, setSavingLista] = useState(false);
  const [showTodo, setShowTodo] = useState(false);
  const [todoTexto, setTodoTexto] = useState("");
  const [todoFecha, setTodoFecha] = useState("");
  const [savingTodo, setSavingTodo] = useState(false);
  const router = useRouter();

  useEffect(() => {
    cargarCliente();
    setHasDraft(!!localStorage.getItem(`ph_draft_orden_${clienteId}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setReadOnly(data.user?.user_metadata?.role === "visitante");
    });
  }, [supabase]);

  const cargarCliente = async () => {
    setError("");
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", clienteId)
      .single();
    if (error || !data) {
      setError("Couldn't load this client. Check that the link is correct.");
      return;
    }
    setCliente(data as Cliente);
    setForm(data as Cliente);
    cargarFacturas((data as Cliente).nom);
    cargarNotasCredito((data as Cliente).nom);
    cargarOrdenes(clienteId, (data as Cliente).nom);
    cargarTodos(clienteId);
    cargarListasPrecios();
  };

  const cargarListasPrecios = async () => {
    const { data } = await supabase.from("listas_precios").select("id, nombre").order("nombre");
    setListasPrecios((data as { id: string; nombre: string }[]) || []);
  };

  // Asigna (o quita, con "") la lista de precios del cliente — guarda al instante
  const handleListaPrecio = async (listaId: string) => {
    if (!cliente || savingLista) return;
    setSavingLista(true);
    const val = listaId || null;
    const { error: e } = await supabase.from("clientes").update({ lista_precio_id: val }).eq("id", clienteId);
    if (!e) {
      setCliente({ ...cliente, lista_precio_id: val });
      if (form) setForm({ ...form, lista_precio_id: val });
    } else {
      alert("Error saving price list: " + e.message);
    }
    setSavingLista(false);
  };

  const cargarFacturas = async (nombreCliente: string) => {
    setLoadingFacturas(true);
    const { data } = await supabase
      .from("facturas")
      .select("*")
      .eq("cli", nombreCliente)
      .order("num", { ascending: false });
    setFacturas((data as Factura[]) || []);
    setLoadingFacturas(false);
  };

  const cargarNotasCredito = async (nombreCliente: string) => {
    const { data } = await supabase
      .from("notas_credito")
      .select("id, num, fecha, monto, motivo, aplicada, aplicada_en")
      .eq("cli", nombreCliente)
      .order("num", { ascending: false });
    setNotasCredito((data as NotaCredito[]) || []);
  };

  const cargarOrdenes = async (clienteIdParam: string, clienteNom?: string) => {
    setLoadingOrdenes(true);
    const { data: byId } = await supabase
      .from("ordenes")
      .select("*")
      .eq("cli", clienteIdParam)
      .order("num", { ascending: false });
    let todas = (byId as Orden[]) || [];
    if (clienteNom) {
      const { data: byNom } = await supabase
        .from("ordenes")
        .select("*")
        .eq("cli", clienteNom)
        .order("num", { ascending: false });
      const byNomFiltered = ((byNom as Orden[]) || []).filter((o) => o.cli !== clienteIdParam);
      todas = [...todas, ...byNomFiltered].sort((a, b) => b.num - a.num);
    }
    setOrdenes(todas);
    setLoadingOrdenes(false);
  };

  const cargarTodos = async (cid: string) => {
    const { data } = await supabase
      .from("todos")
      .select("id, texto, completado, fecha_limite, created_at")
      .eq("cliente_id", cid)
      .order("created_at", { ascending: false });
    setTodos((data as TodoCliente[]) || []);
  };

  const handleAddTodo = async () => {
    if (!todoTexto.trim() || !cliente) return;
    setSavingTodo(true);
    const { data } = await supabase
      .from("todos")
      .insert({
        cliente_id: clienteId,
        cliente_nom: cliente.nom,
        texto: todoTexto.trim(),
        fecha_limite: todoFecha || null,
        completado: false,
      })
      .select()
      .single();
    if (data) setTodos((prev) => [data as TodoCliente, ...prev]);
    setTodoTexto("");
    setTodoFecha("");
    setShowTodo(false);
    setSavingTodo(false);
  };

  const handleToggleTodo = async (todo: TodoCliente) => {
    const nuevoEstado = !todo.completado;
    await supabase
      .from("todos")
      .update({ completado: nuevoEstado, completado_at: nuevoEstado ? new Date().toISOString() : null })
      .eq("id", todo.id);
    setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, completado: nuevoEstado } : t));
  };

  const handleDeleteTodo = async (id: string) => {
    await supabase.from("todos").delete().eq("id", id);
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const handleGuardar = async () => {
    if (!form) return;
    if (!form.nom?.trim()) {
      alert("Enter the name");
      return;
    }
    setGuardando(true);
    const { id, ...updated } = form;
    const { data } = await supabase
      .from("clientes")
      .update(updated)
      .eq("id", clienteId)
      .select()
      .single();
    setGuardando(false);
    if (data) {
      setCliente(data as Cliente);
      setForm(data as Cliente);
      setEditando(false);
    }
  };

  const handleDeleteNota = async (notaId: string) => {
    if (!cliente) return;
    const nuevasNotas = (cliente.notas_visita || []).filter((n) => n.id !== notaId);
    await supabase.from("clientes").update({ notas_visita: nuevasNotas }).eq("id", clienteId);
    const updated = { ...cliente, notas_visita: nuevasNotas };
    setCliente(updated);
    setForm(updated);
  };

  const handleSaveNota = async () => {
    if (!notaTexto.trim() || !cliente) return;
    setSavingNota(true);
    const nota: NotaVisita = {
      id: crypto.randomUUID(),
      fecha: new Date().toISOString().slice(0, 10),
      texto: notaTexto.trim(),
      ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    };
    const nuevasNotas = [nota, ...(cliente.notas_visita || [])];
    await supabase.from("clientes").update({ notas_visita: nuevasNotas }).eq("id", clienteId);
    const updated = { ...cliente, notas_visita: nuevasNotas };
    setCliente(updated);
    setForm(updated);
    setNotaTexto("");
    setShowNota(false);
    setSavingNota(false);
  };

  const ROLES_TELEFONO = ["Store", "Owner", "Manager", "Payments", "Places orders"];

  const handleAddTelefono = async () => {
    if (!newPhoneRol || !newPhoneNum.trim() || !cliente) return;
    setSavingPhone(true);
    const nuevos: TelefonoContacto[] = [...(cliente.telefonos || []), { rol: newPhoneRol, nombre: newPhoneNombre.trim() || undefined, num: newPhoneNum.trim() }];
    const { error: e } = await supabase.from("clientes").update({ telefonos: nuevos }).eq("id", clienteId);
    if (!e) {
      const updated = { ...cliente, telefonos: nuevos };
      setCliente(updated);
      setForm(updated);
      setShowAddPhone(false);
      setNewPhoneRol("");
      setNewPhoneNombre("");
      setNewPhoneNum("");
    }
    setSavingPhone(false);
  };

  const handleDeleteTelefono = async (idx: number) => {
    if (!cliente) return;
    const nuevos = (cliente.telefonos || []).filter((_, i) => i !== idx);
    const { error: e } = await supabase.from("clientes").update({ telefonos: nuevos }).eq("id", clienteId);
    if (!e) {
      const updated = { ...cliente, telefonos: nuevos };
      setCliente(updated);
      setForm(updated);
    }
  };

  const handleSaveFax = async () => {
    if (!cliente) return;
    const { error: e } = await supabase.from("clientes").update({ fax: faxValue.trim() || null }).eq("id", clienteId);
    if (!e) {
      const updated = { ...cliente, fax: faxValue.trim() || undefined };
      setCliente(updated);
      setForm(updated);
      setEditFax(false);
    }
  };

  if (error) {
    return (
      <div className="p-6 max-w-md mx-auto text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <BackButton fallback="/?tab=cli" />
      </div>
    );
  }

  if (!cliente || !form) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  const PH = "#4a6741";

  return (
    <div className="min-h-screen pb-28" style={{ background: "linear-gradient(160deg,#eef5ea 0%,#f7faf5 100%)" }}>

      {/* ── HERO ── */}
      <div className="relative w-full h-60 overflow-hidden">
        {cliente.foto_local ? (
          <img src={cliente.foto_local} alt={cliente.nom} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full" style={{ background: `linear-gradient(135deg,#3d5636 0%,${PH} 55%,#7aaa64 100%)` }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />

        {/* Back */}
        <div className="absolute left-4" style={{ top: "calc(0.9rem + env(safe-area-inset-top))" }}>
          <BackButton fallback="/?tab=cli" />
        </div>

        {/* Edit toggle */}
        {!readOnly && (
          <button
            onClick={() => { if (editando) setForm(cliente); setEditando(!editando); }}
            style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
            className="absolute right-4 px-4 py-1.5 rounded-full text-xs font-bold bg-white/20 backdrop-blur-md border border-white/30 text-white active:scale-95 transition-all"
          >
            {editando ? "Cancel" : "Edit"}
          </button>
        )}

        {/* Name block */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
          {editando ? (
            <input
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              className="w-full bg-white/20 backdrop-blur-md border border-white/30 text-white text-xl font-black uppercase rounded-2xl px-4 py-2.5 outline-none mb-2"
            />
          ) : (
            <h1 className="text-[1.65rem] font-black uppercase tracking-wide text-white leading-tight drop-shadow-sm">{cliente.nom}</h1>
          )}
          <div className="flex items-center gap-2 mt-1">
            {cliente.codigo_cliente && (
              <span className="text-[11px] font-mono text-white/60 tracking-wider">#{cliente.codigo_cliente}</span>
            )}
            <EstadoClienteBadge e={cliente.estado} />
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="px-4 pt-4 space-y-3 max-w-2xl mx-auto">

        {/* Quick actions */}
        {!readOnly && (
          <div className="flex gap-2.5">
            <button
              onClick={() => router.push(`/clientes/${clienteId}/nueva-orden`)}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm text-white shadow-md active:scale-[0.97] transition-all"
              style={{ background: `linear-gradient(135deg,#3d5636,${PH})` }}
            >
              <span className="text-base leading-none">+</span> New Order
            </button>
            <button
              onClick={() => router.push(`/clientes/${clienteId}/estado-cuenta`)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3.5 rounded-2xl font-semibold text-sm bg-white/70 backdrop-blur-xl border border-white/60 shadow-sm active:scale-[0.97] transition-all"
              style={{ color: PH }}
            >
              📄 Statement
            </button>
          </div>
        )}

        {/* Draft banner */}
        {hasDraft && (
          <button
            onClick={() => router.push(`/clientes/${clienteId}/nueva-orden`)}
            className="w-full flex items-center justify-between gap-3 bg-amber-50/90 backdrop-blur-sm border border-amber-200 rounded-2xl px-4 py-3 text-left active:scale-[0.98] transition-all"
          >
            <div>
              <div className="text-xs font-bold text-amber-700">Draft in progress</div>
              <div className="text-[11px] text-amber-500">Tap to continue editing</div>
            </div>
            <span className="text-amber-400 text-xl">→</span>
          </button>
        )}

        {/* ── INFO CARD ── */}
        <div className="bg-white/65 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-1 space-y-3.5">

            <div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: `${PH}99` }}>Address</p>
              {editando ? (
                <div className="space-y-1.5">
                  <input value={form.dir || ""} onChange={(e) => setForm({ ...form, dir: e.target.value })} placeholder="Street" className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25" />
                  <div className="grid grid-cols-2 gap-1.5">
                    <input value={form.ciudad || ""} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} placeholder="City" className="px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25" />
                    <input value={form.estado_dir || ""} onChange={(e) => setForm({ ...form, estado_dir: e.target.value })} placeholder="State" className="px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25" />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-700">
                  {[cliente.dir, cliente.ciudad, cliente.estado_dir].filter(Boolean).join(", ") || <span className="text-gray-400 text-xs">Not specified</span>}
                </p>
              )}
            </div>

            <div className="border-t border-black/5" />

            <div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: `${PH}99` }}>Email</p>
              {editando ? (
                <input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25" />
              ) : (
                <p className="text-sm text-gray-700 break-all">{cliente.email || <span className="text-gray-400 text-xs">Not specified</span>}</p>
              )}
            </div>

            <div className="border-t border-black/5" />

            <div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: `${PH}99` }}>Price List</p>
              <select
                value={cliente.lista_precio_id || ""}
                disabled={readOnly || savingLista}
                onChange={(e) => handleListaPrecio(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl border border-black/10 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25 ${cliente.lista_precio_id ? "font-semibold text-[#b09060]" : "text-gray-700"}`}
              >
                <option value="">Base prices</option>
                {listasPrecios.map((l) => (
                  <option key={l.id} value={l.id}>{l.nombre}</option>
                ))}
              </select>
            </div>

            <div className="border-t border-black/5" />

            <div className="flex items-center justify-between gap-4 pb-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: `${PH}99` }}>Status</p>
                {editando ? (
                  <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className="px-3 py-1.5 rounded-xl border border-black/10 bg-white/80 text-sm outline-none">
                    <option>Active</option><option>Inactive</option><option>Waiting</option>
                  </select>
                ) : (
                  <EstadoClienteBadge e={cliente.estado} />
                )}
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-gray-400 text-right leading-tight">Open<br />Sat</span>
                <button
                  disabled={!editando}
                  onClick={() => editando && setForm({ ...form, abierto_sabados: !form.abierto_sabados })}
                  className={`relative w-12 h-6 rounded-full transition-all shrink-0 ${form.abierto_sabados ? "" : "bg-gray-200"} ${!editando ? "opacity-60" : ""}`}
                  style={form.abierto_sabados ? { background: PH } : {}}
                >
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.abierto_sabados ? "right-0.5" : "left-0.5"}`} />
                </button>
              </div>
            </div>
          </div>

          {editando && (
            <div className="px-5 pb-4">
              <button disabled={guardando} onClick={handleGuardar} className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50 active:scale-[0.98] transition-all" style={{ background: PH }}>
                {guardando ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}
        </div>

        {/* ── CONTACTS ── */}
        <div className="bg-white/65 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: `${PH}99` }}>Contacts & Phones</p>
              {!readOnly && !showAddPhone && (
                <button onClick={() => setShowAddPhone(true)} className="text-xs font-bold px-3 py-1 rounded-full active:scale-95 transition-all" style={{ color: PH, background: `${PH}18` }}>+ Add</button>
              )}
            </div>

            <div className="space-y-3">
              {cliente.tel && (
                <a href={`tel:${cliente.tel}`} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-black text-white" style={{ background: PH }}>P</div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Principal</p>
                    <p className="text-sm font-semibold" style={{ color: PH }}>{cliente.tel}</p>
                  </div>
                </a>
              )}

              {(cliente.telefonos || []).filter(t => t.num).map((t, i) => (
                <div key={i} className="flex items-center gap-3 group">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-black text-white" style={{ background: `${PH}cc` }}>
                    {(t.nombre || t.rol)[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{t.rol}</p>
                    {t.nombre && <p className="text-xs font-semibold text-gray-700 leading-tight">{t.nombre}</p>}
                    <a href={`tel:${t.num}`} className="text-sm font-semibold" style={{ color: PH }}>{t.num}</a>
                  </div>
                  {!readOnly && (
                    <button onClick={() => handleDeleteTelefono(i)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all text-xl leading-none shrink-0">×</button>
                  )}
                </div>
              ))}

              {/* FAX */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-xs font-black text-gray-400">F</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Fax</p>
                  {editFax ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <input type="tel" value={faxValue} onChange={(e) => setFaxValue(e.target.value)} autoFocus placeholder="Fax number" className="flex-1 px-2 py-1 rounded-lg border border-black/10 bg-white text-sm outline-none" />
                      <button onClick={handleSaveFax} className="text-xs font-bold px-2 py-1 rounded-lg text-white" style={{ background: PH }}>Save</button>
                      <button onClick={() => { setEditFax(false); setFaxValue(""); }} className="text-xs text-gray-400">✕</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-700">{cliente.fax || <span className="text-gray-400 text-xs">—</span>}</span>
                      {!readOnly && (
                        <button onClick={() => { setFaxValue(cliente.fax || ""); setEditFax(true); }} className="text-xs font-semibold" style={{ color: PH }}>{cliente.fax ? "Edit" : "Add"}</button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {!cliente.tel && (cliente.telefonos || []).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-1">No contacts yet</p>
              )}
            </div>

            {/* Add phone panel */}
            {showAddPhone && (
              <div className="mt-4 pt-4 border-t border-black/5 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Who answers this number?</p>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES_TELEFONO.map(r => (
                    <button key={r} onClick={() => setNewPhoneRol(r)} className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95" style={newPhoneRol === r ? { background: PH, color: "#fff" } : { background: `${PH}15`, color: PH }}>
                      {r}
                    </button>
                  ))}
                </div>
                {newPhoneRol && (
                  <div className="space-y-2">
                    <input type="text" value={newPhoneNombre} onChange={(e) => setNewPhoneNombre(e.target.value)} placeholder="Name (Pete, Rafael…)" autoFocus className="w-full px-3 py-2.5 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25" />
                    <input type="tel" value={newPhoneNum} onChange={(e) => setNewPhoneNum(e.target.value)} placeholder={`Phone — ${newPhoneRol}`} onKeyDown={(e) => e.key === "Enter" && handleAddTelefono()} className="w-full px-3 py-2.5 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25" />
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={handleAddTelefono} disabled={!newPhoneRol || !newPhoneNum.trim() || savingPhone} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 active:scale-[0.98] transition-all" style={{ background: PH }}>
                    {savingPhone ? "Saving…" : "Save Contact"}
                  </button>
                  <button onClick={() => { setShowAddPhone(false); setNewPhoneRol(""); setNewPhoneNombre(""); setNewPhoneNum(""); }} className="px-4 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── ACCOUNT BALANCE ── */}
        {!loadingFacturas && (() => {
          const deuda = facturas.filter(f => !["Paid","Completed","Cancelled"].includes(f.estado)).reduce((acc, f) => {
            const pagado = ((f as unknown as { pagos?: {monto:number}[] }).pagos || []).reduce((s, p) => s + p.monto, 0);
            return acc + Math.max(0, f.total - pagado);
          }, 0);
          // Las NC aplicadas ya se usaron contra una factura: no restan del balance
          const credito = notasCredito.filter(n => !n.aplicada).reduce((acc, n) => acc + n.monto, 0);
          const neto = deuda - credito;
          return (
            <div className="rounded-2xl shadow-sm overflow-hidden" style={{ background: `linear-gradient(135deg,#2e4029 0%,${PH} 60%,#6b9660 100%)` }}>
              <div className="px-5 py-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/50 mb-3">Account Balance</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Pending", val: fmt(deuda), color: "#fcd34d" },
                    { label: "Credits", val: `−${fmt(credito)}`, color: "#6ee7b7" },
                    { label: "Net Due",  val: `${neto < 0 ? "−" : ""}${fmt(Math.abs(neto))}`, color: neto > 0 ? "#fcd34d" : "#6ee7b7", border: true },
                  ].map(item => (
                    <div key={item.label} className={`rounded-xl p-3 text-center ${item.border ? "border border-white/25" : ""}`} style={{ background: "rgba(255,255,255,0.12)" }}>
                      <p className="text-[8px] uppercase tracking-wide text-white/50 mb-1">{item.label}</p>
                      <p className="text-sm font-black" style={{ color: item.color }}>{item.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── TO-DO LIST ── */}
        <div className="bg-white/65 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: `${PH}99` }}>To-Do List</p>
              {!readOnly && (
                <button onClick={() => { setShowTodo(true); setTodoTexto(""); setTodoFecha(""); }} className="text-xs font-bold px-3 py-1 rounded-full active:scale-95 transition-all" style={{ color: PH, background: `${PH}18` }}>+ Add</button>
              )}
            </div>

            {showTodo && !readOnly && (
              <div className="mb-3 p-3 rounded-xl space-y-2" style={{ background: `${PH}0d` }}>
                <textarea autoFocus rows={2} placeholder="Describe the task or requirement…" value={todoTexto} onChange={(e) => setTodoTexto(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25 resize-none" />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 shrink-0">Due date</span>
                  <input type="date" value={todoFecha} onChange={(e) => setTodoFecha(e.target.value)} className="flex-1 px-2 py-1.5 rounded-lg border border-black/10 bg-white text-xs outline-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddTodo} disabled={savingTodo || !todoTexto.trim()} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-40 active:scale-[0.98] transition-all" style={{ background: PH }}>
                    {savingTodo ? "Saving…" : "Save Task"}
                  </button>
                  <button onClick={() => setShowTodo(false)} className="px-4 py-2.5 rounded-xl text-xs text-gray-500 bg-gray-100">Cancel</button>
                </div>
              </div>
            )}

            {(() => {
              const pending = todos.filter(t => !t.completado);
              const done    = todos.filter(t => t.completado);
              const today   = new Date().toISOString().slice(0, 10);
              return todos.length ? (
                <div className="space-y-2.5">
                  {pending.map(t => {
                    const overdue = t.fecha_limite && t.fecha_limite < today;
                    return (
                      <div key={t.id} className="flex items-start gap-3 group">
                        <button onClick={() => { if (!readOnly) handleToggleTodo(t); }} disabled={readOnly} className="mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 transition-colors flex-none disabled:opacity-40" style={{ borderColor: overdue ? "#f87171" : PH }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 leading-snug">{t.texto}</p>
                          {t.fecha_limite && (
                            <p className="text-[11px] mt-0.5 font-medium" style={{ color: overdue ? "#ef4444" : "#9ca3af" }}>
                              {overdue ? "⚠️ Overdue · " : "📅 "}{fdate(t.fecha_limite)}
                            </p>
                          )}
                        </div>
                        {!readOnly && <button onClick={() => handleDeleteTodo(t.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all text-xl leading-none shrink-0">×</button>}
                      </div>
                    );
                  })}
                  {done.length > 0 && (
                    <details className="mt-1">
                      <summary className="text-[11px] text-gray-400 cursor-pointer select-none">{done.length} completed</summary>
                      <div className="space-y-2 mt-2">
                        {done.map(t => (
                          <div key={t.id} className="flex items-start gap-3 opacity-50 group">
                            <div className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] shrink-0" style={{ background: PH }}>✓</div>
                            <p className="flex-1 text-sm text-gray-600 line-through leading-snug">{t.texto}</p>
                            {!readOnly && <button onClick={() => handleDeleteTodo(t.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all text-xl leading-none">×</button>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-1">No pending tasks</p>
              );
            })()}
          </div>
        </div>

        {/* ── VISIT HISTORY ── */}
        <div className="bg-white/65 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: `${PH}99` }}>Visit History</p>
              {!readOnly && (
                <button onClick={() => setShowNota(true)} className="text-xs font-bold px-3 py-1 rounded-full active:scale-95 transition-all" style={{ color: PH, background: `${PH}18` }}>+ Add</button>
              )}
            </div>
            {(cliente.notas_visita || []).length ? (
              <div className="space-y-0">
                {(cliente.notas_visita || []).map((n, idx) => (
                  <div key={n.id} className="flex gap-3 group">
                    <div className="flex flex-col items-center pt-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PH }} />
                      {idx < (cliente.notas_visita || []).length - 1 && <div className="w-px flex-1 mt-1 mb-0" style={{ background: `${PH}30` }} />}
                    </div>
                    <div className="flex-1 min-w-0 pb-4">
                      <p className="text-[10px] text-gray-400 mb-0.5">{n.fecha} · {n.ts}</p>
                      <p className="text-sm text-gray-800 leading-relaxed">{n.texto}</p>
                    </div>
                    {!readOnly && (
                      <button onClick={() => handleDeleteNota(n.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all text-xl leading-none shrink-0 mt-0.5">×</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-1">No visit history yet</p>
            )}
          </div>
        </div>

        {/* ── ORDERS ── */}
        <div className="bg-white/65 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4">
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: `${PH}99` }}>Orders</p>
            {loadingOrdenes ? (
              <p className="text-xs text-gray-400 text-center py-1">Loading…</p>
            ) : ordenes.length ? (
              <div className="divide-y divide-black/5">
                {ordenes.map(o => (
                  <div key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">Order #{o.num}</p>
                      <p className="text-[11px] text-gray-400">{fdate(o.fecha)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => router.push(`/ordenes/${o.id}/estimado`)} className="px-3 py-1 rounded-full text-xs font-semibold active:scale-95 transition-all" style={{ color: PH, background: `${PH}18` }}>
                        Estimate
                      </button>
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-800">{fmt(o.total)}</p>
                        <OrdenBadge e={o.estado} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-1">No orders recorded</p>
            )}
          </div>
        </div>

        {/* ── INVOICES ── */}
        <div className="bg-white/65 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4">
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: `${PH}99` }}>Invoices</p>
            {loadingFacturas ? (
              <p className="text-xs text-gray-400 text-center py-1">Loading…</p>
            ) : facturas.length ? (
              <div className="divide-y divide-black/5">
                {facturas.map(f => {
                  const pagado  = ((f as unknown as { pagos?: {monto:number}[] }).pagos || []).reduce((s, p) => s + p.monto, 0);
                  const balance = ["Paid","Completed","Cancelled"].includes(f.estado) ? 0 : Math.max(0, f.total - pagado);
                  return (
                    <button key={f.id} onClick={() => router.push(`/facturas/${f.id}`)} className="w-full flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 active:opacity-60 transition-opacity text-left">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">Invoice #{f.num}</p>
                        <p className="text-[11px] text-gray-400">{fdate(f.fecha)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-800">{fmt(balance)}</p>
                          <FacturaBadge e={f.estado} />
                        </div>
                        <span className="text-gray-300 text-lg">›</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-1">No invoices recorded</p>
            )}
          </div>
        </div>

        {/* ── CREDIT NOTES ── */}
        {notasCredito.length > 0 && (
          <div className="bg-white/65 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4">
              <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: `${PH}99` }}>Credit Notes</p>
              <div className="divide-y divide-black/5">
                {notasCredito.map(n => (
                  <button key={n.id} onClick={() => router.push(`/notas-credito/${n.id}`)} className="w-full flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 active:opacity-60 transition-opacity text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold" style={{ color: PH }}>CN #{String(n.num).padStart(3,"0")}</p>
                      <p className="text-[11px] text-gray-400">{fdate(n.fecha)}{n.motivo ? ` · ${n.motivo}` : ""}</p>
                      {n.aplicada && (
                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-bold text-[10px]">
                          ✓ Applied{n.aplicada_en ? ` · ${n.aplicada_en}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <p className={`text-sm font-bold ${n.aplicada ? "text-gray-300 line-through" : "text-emerald-600"}`}>−{fmt(n.monto)}</p>
                      <span className="text-gray-300 text-lg">›</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TOP PRODUCTS DEL CLIENTE (top 25% por monto, scroll horizontal) ── */}
        {(() => {
          const totals: Record<string, { nom: string; sku: string; qty: number; monto: number }> = {};
          for (const f of facturas) {
            for (const l of f.lineas || []) {
              const key = l.sku || l.prodNom;
              if (!totals[key]) totals[key] = { nom: l.prodNom, sku: l.sku || "", qty: 0, monto: 0 };
              totals[key].qty += Number(l.qty) || 0;
              totals[key].monto += (Number(l.qty) || 0) * (Number(l.precio) || 0);
            }
          }
          const arr = Object.values(totals).sort((a, b) => b.monto - a.monto);
          if (!arr.length) return null;
          // Top 25% de los productos que compra (minimo 3 para que se vea)
          const top = arr.slice(0, Math.max(Math.min(arr.length, 3), Math.ceil(arr.length * 0.25)));
          return (
            <div className="bg-white/65 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 pt-4 pb-1 flex items-baseline justify-between">
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: `${PH}99` }}>Top Products · This Client</p>
                <p className="text-[9px] text-gray-400">top 25% by amount</p>
              </div>
              <div
                className="flex gap-2.5 overflow-x-auto px-5 py-3"
                style={{ WebkitOverflowScrolling: "touch", scrollSnapType: "x proximity" }}
              >
                {top.map((p, i) => (
                  <div
                    key={p.sku || p.nom}
                    className="shrink-0 w-32 bg-white border border-black/5 rounded-xl p-2.5 flex flex-col"
                    style={{ scrollSnapAlign: "start" }}
                  >
                    <div className="text-[9px] font-black mb-1" style={{ color: PH }}>#{i + 1}</div>
                    <div className="text-[11px] font-semibold text-gray-800 leading-snug mb-1" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "2.1rem" }}>
                      {p.nom}
                    </div>
                    {p.sku && <div className="text-[9px] font-mono text-gray-400 truncate">{p.sku}</div>}
                    <div className="mt-auto pt-1.5 flex items-baseline justify-between gap-1">
                      <span className="text-xs font-bold text-gray-800">{fmt(p.monto)}</span>
                      <span className="text-[9px] text-gray-400">{p.qty}u</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      </div>

      <BottomNav active="cli" />

      {/* ── VISIT NOTE MODAL ── */}
      {showNota && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 px-4 pb-8">
          <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-sm p-5 border border-white/60">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-gray-800 text-base">Visit Note</h3>
              <button onClick={() => { setShowNota(false); setNotaTexto(""); }} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-lg leading-none">×</button>
            </div>
            <textarea
              value={notaTexto}
              onChange={(e) => setNotaTexto(e.target.value)}
              placeholder="What happened during this visit…"
              rows={4}
              autoFocus
              className="w-full px-3 py-2.5 rounded-2xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25 resize-none mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => { setShowNota(false); setNotaTexto(""); }} className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-semibold text-gray-500 bg-gray-100 active:scale-[0.98] transition-all">
                Cancel
              </button>
              <button onClick={handleSaveNota} disabled={savingNota || !notaTexto.trim()} className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-bold text-white disabled:opacity-50 active:scale-[0.98] transition-all" style={{ background: PH }}>
                {savingNota ? "Saving…" : "Save Note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
