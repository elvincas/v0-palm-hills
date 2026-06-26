"use client";

// app/clientes/[id]/page.tsx

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";

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
}

interface Factura {
  id: string;
  num: number;
  fecha: string;
  estado: string;
  total: number;
}

interface NotaCredito {
  id: string;
  num: number;
  fecha: string;
  monto: number;
  motivo: string;
}

interface Orden {
  id: string;
  num: number;
  fecha: string;
  estado: string;
  total: number;
}

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fdate = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
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
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const router = useRouter();

  useEffect(() => {
    cargarCliente();
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
    cargarOrdenes(clienteId);
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
      .select("id, num, fecha, monto, motivo")
      .eq("cli", nombreCliente)
      .order("num", { ascending: false });
    setNotasCredito((data as NotaCredito[]) || []);
  };

  const cargarOrdenes = async (clienteIdParam: string) => {
    setLoadingOrdenes(true);
    const { data } = await supabase
      .from("ordenes")
      .select("*")
      .eq("cli", clienteIdParam)
      .order("num", { ascending: false });
    setOrdenes((data as Orden[]) || []);
    setLoadingOrdenes(false);
  };

  const handleGuardar = async () => {
    if (!form) return;
    if (!form.nom?.trim()) {
      alert("Enter the name");
      return;
    }
    if (!form.codigo_cliente?.trim()) {
      alert("Enter the client number");
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

  if (error) {
    return (
      <div className="p-6 max-w-md mx-auto text-center">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <button
          onClick={() => router.push("/?tab=cli")}
          className={`px-4 py-2 rounded-full text-sm font-medium ${GLASS_BTN}`}
        >
          ← Back
        </button>
      </div>
    );
  }

  if (!cliente || !form) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-4 pb-24 max-w-3xl mx-auto" style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}>
      <button
        onClick={() => router.push("/?tab=cli")}
        className={`px-4 py-2 rounded-full text-sm font-medium mb-3 ${GLASS_BTN}`}
      >
        ← Back
      </button>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {/* Banner con la foto del cliente */}
        <div className="w-full h-40 bg-gradient-to-r from-secondary to-secondary-foreground flex items-center justify-center relative overflow-hidden">
          {cliente.foto_local ? (
            <img src={cliente.foto_local} alt={cliente.nom} className="w-full h-full object-cover" />
          ) : (
            <div className="text-5xl">🏪</div>
          )}
        </div>

        <div className="p-5">
          {/* Encabezado: numero de cliente, nombre y boton de editar */}
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Client Number</span>
                {editando ? (
                  <input
                    value={form.codigo_cliente || ""}
                    onChange={(e) => setForm({ ...form, codigo_cliente: e.target.value })}
                    className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground font-mono text-lg outline-none focus:ring-2 focus:ring-ring"
                  />
                ) : (
                  <p className="font-mono text-lg font-bold text-primary">
                    {cliente.codigo_cliente || "Not assigned"}
                  </p>
                )}
              </div>

              {editando ? (
                <input
                  value={form.nom}
                  onChange={(e) => setForm({ ...form, nom: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-lg font-bold uppercase outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <h1 className="text-2xl font-bold uppercase tracking-wide text-card-foreground break-words">{cliente.nom}</h1>
              )}

              <div className="mt-2">
                <EstadoClienteBadge e={cliente.estado} />
              </div>
            </div>

            {!readOnly && (
              <button
                onClick={() => {
                  if (editando) setForm(cliente);
                  setEditando(!editando);
                }}
                className={`shrink-0 px-4 py-2 rounded-full font-medium text-sm ${GLASS_BTN}`}
              >
                {editando ? "Cancel" : "Edit"}
              </button>
            )}
          </div>

          {/* Informacion del cliente */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">📍 Address</label>
              {editando ? (
                <input
                  value={form.dir || ""}
                  onChange={(e) => setForm({ ...form, dir: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <p className="text-sm font-medium text-card-foreground mt-0.5">{cliente.dir || "No especificada"}</p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ciudad</label>
              {editando ? (
                <input
                  value={form.ciudad || ""}
                  onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <p className="text-sm font-medium text-card-foreground mt-0.5">{cliente.ciudad || "No especificada"}</p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estado</label>
              {editando ? (
                <input
                  value={form.estado_dir || ""}
                  onChange={(e) => setForm({ ...form, estado_dir: e.target.value })}
                  placeholder="Ej. New York"
                  className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <p className="text-sm font-medium text-card-foreground mt-0.5">{cliente.estado_dir || "No especificado"}</p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contacto</label>
              {editando ? (
                <input
                  value={form.contacto || ""}
                  onChange={(e) => setForm({ ...form, contacto: e.target.value })}
                  placeholder="Contact person's name"
                  className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <p className="text-sm font-medium text-card-foreground mt-0.5">{cliente.contacto || "No especificado"}</p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">📞 Phone</label>
              {editando ? (
                <input
                  type="tel"
                  value={form.tel || ""}
                  onChange={(e) => setForm({ ...form, tel: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <p className="text-sm font-medium text-card-foreground mt-0.5">{cliente.tel || "No especificado"}</p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">✉️ Email</label>
              {editando ? (
                <input
                  type="email"
                  value={form.email || ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <p className="text-sm font-medium text-card-foreground mt-0.5 break-all">{cliente.email || "No especificado"}</p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Client Status</label>
              {editando ? (
                <select
                  value={form.estado}
                  onChange={(e) => setForm({ ...form, estado: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option>Active</option>
                  <option>Inactive</option>
                  <option>Waiting</option>
                </select>
              ) : (
                <div className="mt-0.5">
                  <EstadoClienteBadge e={cliente.estado} />
                </div>
              )}
            </div>
          </div>

          {/* Toggle: Abierto los sabados */}
          <div className="mt-6 p-4 bg-muted rounded-xl flex items-center justify-between">
            <div>
              <span className="font-medium text-card-foreground">📅 Open on Saturdays</span>
              <p className="text-sm text-muted-foreground">Does this client receive orders on Saturdays?</p>
            </div>
            <button
              disabled={!editando}
              onClick={() => editando && setForm({ ...form, abierto_sabados: !form.abierto_sabados })}
              className={`relative w-14 h-8 rounded-full transition-all shrink-0 ${
                form.abierto_sabados ? "bg-primary" : "bg-gray-300"
              } ${!editando ? "opacity-70" : ""}`}
            >
              <div
                className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${
                  form.abierto_sabados ? "right-1" : "left-1"
                }`}
              />
            </button>
          </div>

          {/* Boton Guardar (solo en modo edicion) */}
          {editando && (
            <div className="mt-4 flex justify-end">
              <button
                disabled={guardando}
                onClick={handleGuardar}
                className={`px-5 py-2.5 rounded-full font-bold text-sm disabled:opacity-50 ${GLASS_BTN_PRIMARY}`}
              >
                {guardando ? "Saving..." : "💾 Save Changes"}
              </button>
            </div>
          )}

          {/* Boton Nueva Orden */}
          {!readOnly && (
            <button
              onClick={() => router.push(`/clientes/${clienteId}/nueva-orden`)}
              className={`mt-6 w-full px-4 py-3 rounded-full font-bold text-sm flex items-center justify-center gap-2 ${GLASS_BTN_PRIMARY}`}
            >
              <span className="text-xl leading-none">+</span> New Order
            </button>
          )}

          {/* Seccion Ordenes */}
          <div className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Orders</h2>
            {loadingOrdenes ? (
              <p className="text-sm text-muted-foreground">Loading orders...</p>
            ) : ordenes.length ? (
              <div className="space-y-2">
                {ordenes.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-2 bg-muted rounded-xl px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-card-foreground">Order #{o.num}</div>
                      <div className="text-xs text-muted-foreground">{fdate(o.fecha)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-card-foreground">{fmt(o.total)}</div>
                      <OrdenBadge e={o.estado} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No orders recorded.</p>
            )}
          </div>

          {/* Balance Neto */}
          {!loadingFacturas && (() => {
            const deuda = facturas.filter(f => !["Paid", "Completed", "Cancelled"].includes(f.estado)).reduce((acc, f) => acc + f.total, 0);
            const credito = notasCredito.reduce((acc, n) => acc + n.monto, 0);
            const neto = deuda - credito;
            return (
              <div className="mt-6 rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-[#f0f7ed] to-[#fafaf7] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[#4a6741]">Account Balance</h2>
                  <button
                    onClick={() => router.push(`/clientes/${clienteId}/estado-cuenta`)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-bold ${GLASS_BTN_PRIMARY}`}
                  >
                    📄 Statement PDF
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white/70 rounded-xl p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Pending</div>
                    <div className="text-sm font-bold text-amber-700">{fmt(deuda)}</div>
                  </div>
                  <div className="bg-white/70 rounded-xl p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Credits</div>
                    <div className="text-sm font-bold text-green-700">−{fmt(credito)}</div>
                  </div>
                  <div className="bg-white/70 rounded-xl p-2.5 border border-primary/20">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Net Due</div>
                    <div className={`text-sm font-bold ${neto > 0 ? "text-amber-700" : "text-green-700"}`}>{neto < 0 ? "-" : ""}{fmt(Math.abs(neto))}</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Seccion Facturas */}
          <div className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Invoices</h2>
            {loadingFacturas ? (
              <p className="text-sm text-muted-foreground">Loading invoices...</p>
            ) : facturas.length ? (
              <div className="space-y-2">
                {facturas.map((f) => {
                  const balance = ["Paid","Completed","Cancelled"].includes(f.estado) ? 0 : f.total;
                  return (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-2 bg-muted rounded-xl px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-card-foreground">Invoice #{f.num}</div>
                        <div className="text-xs text-muted-foreground">{fdate(f.fecha)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</div>
                        <div className="text-sm font-bold text-card-foreground">{fmt(balance)}</div>
                        <FacturaBadge e={f.estado} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No invoices recorded.</p>
            )}
          </div>

          {/* Notas de Crédito */}
          {notasCredito.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Credit Notes</h2>
              <div className="space-y-2">
                {notasCredito.map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-xl px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-green-800">CN #{String(n.num).padStart(3,"0")}</div>
                      <div className="text-xs text-green-700">{fdate(n.fecha)}{n.motivo ? ` · ${n.motivo}` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-green-700">−{fmt(n.monto)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <BottomNav active="cli" />
    </div>
  );
}
