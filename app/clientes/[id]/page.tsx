// app/(dashboard)/clientes/[id]/page.tsx

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';

interface Cliente {
  id: string;
  codigo_cliente: string;
  nombre: string;
  direccion: string;
  ciudad: string;
  estado: string;
  contacto: string;
  telefono: string;
  email: string;
  abierto_sabados: boolean;
  foto_url?: string;
}

export default function ClientePerfilPage({ params }: { params: { id: string } }) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [editando, setEditando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    cargarCliente();
  }, []);

  const cargarCliente = async () => {
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', params.id)
      .single();
    setCliente(data);
  };

  if (!cliente) return <div>Cargando...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Tarjeta Glassmorphism */}
      <div className="glass-card p-8">
        {/* Encabezado con foto y código */}
        <div className="flex items-start gap-6">
          <div className="relative">
            <img 
              src={cliente.foto_url || '/default-avatar.png'} 
              alt="Foto de perfil"
              className="w-24 h-24 rounded-full object-cover border-2 border-white/30"
            />
          </div>
          
          <div className="flex-1">
            {/* CÓDIGO DE CLIENTE (con font-mono como productos) */}
            <div className="mb-2">
              <span className="text-xs uppercase tracking-wider text-gray-500">Código de Cliente</span>
              <p className="font-mono text-2xl font-bold text-[#4a6741]">
                {cliente.codigo_cliente || 'Sin asignar'}
              </p>
            </div>
            
            {/* NOMBRE */}
            <h1 className="text-3xl font-bold text-gray-800">
              {cliente.nombre}
            </h1>
          </div>
          
          {/* Botón de edición */}
          <button 
            onClick={() => setEditando(!editando)}
            className="btn-secondary"
          >
            {editando ? 'Cancelar' : 'Editar'}
          </button>
        </div>

        {/* Información del cliente */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Dirección */}
          <div>
            <label className="text-xs uppercase tracking-wider text-gray-500">📍 Dirección</label>
            <p className="text-gray-800">
              {editando ? (
                <input 
                  type="text" 
                  value={cliente.direccion || ''} 
                  onChange={(e) => setCliente({...cliente, direccion: e.target.value})}
                  className="input-glass w-full"
                />
              ) : (
                cliente.direccion || 'No especificada'
              )}
            </p>
          </div>

          {/* Ciudad */}
          <div>
            <label className="text-xs uppercase tracking-wider text-gray-500">Ciudad</label>
            <p className="text-gray-800">
              {editando ? (
                <input 
                  type="text" 
                  value={cliente.ciudad || ''} 
                  onChange={(e) => setCliente({...cliente, ciudad: e.target.value})}
                  className="input-glass w-full"
                />
              ) : (
                cliente.ciudad || 'No especificada'
              )}
            </p>
          </div>

          {/* Estado */}
          <div>
            <label className="text-xs uppercase tracking-wider text-gray-500">Estado</label>
            <p className="text-gray-800">
              {editando ? (
                <input 
                  type="text" 
                  value={cliente.estado || ''} 
                  onChange={(e) => setCliente({...cliente, estado: e.target.value})}
                  className="input-glass w-full"
                />
              ) : (
                cliente.estado || 'No especificado'
              )}
            </p>
          </div>

          {/* Contacto */}
          <div>
            <label className="text-xs uppercase tracking-wider text-gray-500">Contacto</label>
            <p className="text-gray-800">
              {editando ? (
                <input 
                  type="text" 
                  value={cliente.contacto || ''} 
                  onChange={(e) => setCliente({...cliente, contacto: e.target.value})}
                  className="input-glass w-full"
                />
              ) : (
                cliente.contacto || 'No especificado'
              )}
            </p>
          </div>

          {/* Teléfono */}
          <div>
            <label className="text-xs uppercase tracking-wider text-gray-500">📞 Teléfono</label>
            <p className="text-gray-800">
              {editando ? (
                <input 
                  type="tel" 
                  value={cliente.telefono || ''} 
                  onChange={(e) => setCliente({...cliente, telefono: e.target.value})}
                  className="input-glass w-full"
                />
              ) : (
                cliente.telefono || 'No especificado'
              )}
            </p>
          </div>

          {/* Email */}
          <div>
            <label className="text-xs uppercase tracking-wider text-gray-500">✉️ Correo Electrónico</label>
            <p className="text-gray-800">
              {editando ? (
                <input 
                  type="email" 
                  value={cliente.email || ''} 
                  onChange={(e) => setCliente({...cliente, email: e.target.value})}
                  className="input-glass w-full"
                />
              ) : (
                cliente.email || 'No especificado'
              )}
            </p>
          </div>
        </div>

        {/* Toggle: Abierto los sábados */}
        <div className="mt-6 p-4 bg-white/30 rounded-xl flex items-center justify-between">
          <div>
            <span className="font-medium text-gray-800">📅 Abierto los sábados</span>
            <p className="text-sm text-gray-500">¿Este cliente recibe pedidos los sábados?</p>
          </div>
          <button
            onClick={() => setCliente({...cliente, abierto_sabados: !cliente.abierto_sabados})}
            className={`relative w-14 h-8 rounded-full transition-all ${
              cliente.abierto_sabados ? 'bg-[#4a6741]' : 'bg-gray-300'
            }`}
          >
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${
              cliente.abierto_sabados ? 'right-1' : 'left-1'
            }`} />
          </button>
        </div>

        {/* Botón Guardar (solo en modo edición) */}
        {editando && (
          <div className="mt-6 flex justify-end">
            <button 
              onClick={async () => {
                await supabase
                  .from('clientes')
                  .update(cliente)
                  .eq('id', params.id);
                setEditando(false);
              }}
              className="btn-primary"
            >
              💾 Guardar Cambios
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
