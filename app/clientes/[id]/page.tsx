"use client";

// app/clientes/[id]/page.tsx

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";

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

export default function ClientePerfilPage() {
  const params = useParams();
  const clienteId = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [form, setForm] = useState<Cliente | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    cargarCliente();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  const cargarCliente = async () => {
    setError("");
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", clienteId)
      .single();
    if (error || !data) {
      setError("No se pudo cargar este cliente. Verifica que el enlace sea correcto.");
      return;
    }
    setCliente(data as Cliente);
    setForm(data as Cliente);
  };

  const handleGuardar = async () => {
    if (!form) return;
    if (!form.nom?.trim()) {
      alert("Ingresa el nombre");
      return;
    }
    if (!form.codigo_cliente?.trim()) {
      alert("Ingresa el numero de cliente");
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
        <button onClick={() => router.push("/")} className="text-sm text-muted-foreground underline">
          Volver
        </button>
      </div>
    );
  }

  if (!cliente || !form) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando...</div>;
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <button
        onClick={() => router.push("/")}
        className="text-sm text-muted-foreground mb-3"
      >
        ← Volver
      </button>

      <div className="bg-card rounded-2xl border border-border p-5">
        {/* Encabezado con foto, numero de cliente y nombre */}
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0 border border-border">
            {cliente.foto_local ? (
              <img src={cliente.foto_local} alt={cliente.nom} className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl">🏪</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="mb-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Número de Cliente</span>
              {editando ? (
                <input
                  value={form.codigo_cliente || ""}
                  onChange={(e) => setForm({ ...form, codigo_cliente: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground font-mono text-lg outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <p className="font-mono text-xl font-bold text-primary">
                  {cliente.codigo_cliente || "Sin asignar"}
                </p>
              )}
            </div>

            {editando ? (
              <input
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-input bg-card text-card-foreground text-lg font-bold outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <h1 className="text-2xl font-bold text-card-foreground break-words">{cliente.nom}</h1>
            )}
          </div>

          <button
            onClick={() => {
              if (editando) setForm(cliente);
              setEditando(!editando);
            }}
            className="shrink-0 px-3 py-1.5 rounded-xl bg-card border border-border text-card-foreground font-medium text-sm"
          >
            {editando ? "Cancelar" : "Editar"}
          </button>
        </div>

        {/* Informacion del cliente */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">📍 Dirección</label>
            {editando ? (
              <input
                value={form.dir || ""}
                onChange={(e) => setForm({ ...form, dir: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <p className="text-card-foreground">{cliente.dir || "No especificada"}</p>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Ciudad</label>
            {editando ? (
              <input
                value={form.ciudad || ""}
                onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <p className="text-card-foreground">{cliente.ciudad || "No especificada"}</p>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Estado</label>
            {editando ? (
              <input
                value={form.estado_dir || ""}
                onChange={(e) => setForm({ ...form, estado_dir: e.target.value })}
                placeholder="Ej. New York"
                className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <p className="text-card-foreground">{cliente.estado_dir || "No especificado"}</p>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Contacto</label>
            {editando ? (
              <input
                value={form.contacto || ""}
                onChange={(e) => setForm({ ...form, contacto: e.target.value })}
                placeholder="Nombre de la persona de contacto"
                className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <p className="text-card-foreground">{cliente.contacto || "No especificado"}</p>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">📞 Teléfono</label>
            {editando ? (
              <input
                type="tel"
                value={form.tel || ""}
                onChange={(e) => setForm({ ...form, tel: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <p className="text-card-foreground">{cliente.tel || "No especificado"}</p>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">✉️ Correo Electrónico</label>
            {editando ? (
              <input
                type="email"
                value={form.email || ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <p className="text-card-foreground">{cliente.email || "No especificado"}</p>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Estatus del Cliente</label>
            {editando ? (
              <select
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-xl border border-input bg-card text-card-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                <option>Activo</option>
                <option>Inactivo</option>
                <option>En espera</option>
              </select>
            ) : (
              <p className="text-card-foreground">{cliente.estado || "No especificado"}</p>
            )}
          </div>
        </div>

        {/* Toggle: Abierto los sabados */}
        <div className="mt-6 p-4 bg-muted rounded-xl flex items-center justify-between">
          <div>
            <span className="font-medium text-card-foreground">📅 Abierto los sábados</span>
            <p className="text-sm text-muted-foreground">¿Este cliente recibe pedidos los sábados?</p>
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
          <div className="mt-6 flex justify-end">
            <button
              disabled={guardando}
              onClick={handleGuardar}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50"
            >
              {guardando ? "Guardando..." : "💾 Guardar Cambios"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
