'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Cliente {
  id: string
  nom: string
  rfc?: string
  tel?: string
  email?: string
  dir?: string
  estado: string
  foto_local?: string
}

interface Factura {
  id: string
  num: number
  cli: string
  fecha: string
  estado: string
  total: number
}

interface Orden {
  id: string
  num: number
  cli: string
  fecha?: string
  estado: string
  total?: number
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'USD' }).format(n || 0)

const fmtDate = (d?: string) => {
  if (!d) return ''
  const date = new Date(d + 'T00:00:00')
  return date.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

const estadoBadgeClass = (estado: string) => {
  switch (estado?.toLowerCase()) {
    case 'pagada':
    case 'completada':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-100'
    case 'pendiente':
      return 'bg-amber-50 text-amber-700 border border-amber-100'
    case 'cancelada':
      return 'bg-red-50 text-red-600 border border-red-100'
    default:
      return 'bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)]'
  }
}

export default function ClientePerfilPage() {
  const params = useParams()
  const router = useRouter()
  const clienteId = params.id as string
  const supabase = createClient()

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [ordenes, setOrdenes] = useState<Orden[]>([])
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [activeTab, setActiveTab] = useState<'facturas' | 'ordenes'>('facturas')

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: c } = await supabase.from('clientes').select('*').eq('id', clienteId).single()
        if (c) setCliente(c as Cliente)

        const { data: f } = await supabase
          .from('facturas')
          .select('*')
          .eq('cli', clienteId)
          .order('fecha', { ascending: false })
        if (f) {
          setFacturas(f as Factura[])
          const total = f.reduce((sum, fac) => sum + (fac.total || 0), 0)
          const pagado = f
            .filter((fac) => fac.estado === 'Pagada')
            .reduce((sum, fac) => sum + (fac.total || 0), 0)
          setBalance(total - pagado)
        }

        const { data: o } = await supabase
          .from('ordenes')
          .select('*')
          .eq('cli', clienteId)
          .order('fecha', { ascending: false })
        if (o) setOrdenes(o as Orden[])
      } catch (error) {
        console.error('Error loading perfil:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [clienteId])

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
          <p className="text-sm text-[var(--muted-foreground)]">Cargando perfil...</p>
        </div>
      </div>
    )
  }

  if (!cliente) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <p className="text-sm text-[var(--muted-foreground)]">Perfil no encontrado</p>
      </div>
    )
  }

  const facturasPendientes = facturas.filter((f) => f.estado !== 'Pagada')
  const ordenesPendientes = ordenes.filter((o) => o.estado !== 'Completada')
  const totalFacturas = facturas.reduce((s, f) => s + (f.total || 0), 0)

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Banner + Hero */}
      <div className="relative">
        {/* Foto banner */}
        <div className="w-full h-48 bg-gradient-to-br from-[var(--secondary)] to-[var(--muted)] overflow-hidden">
          {cliente.foto_local ? (
            <img
              src={cliente.foto_local}
              alt={cliente.nom}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-white/40 backdrop-blur-sm flex items-center justify-center text-3xl">
                🏪
              </div>
            </div>
          )}
          {/* Overlay gradiente inferior */}
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[var(--background)] to-transparent" />
        </div>

        {/* Boton volver — glass pill */}
        <button
          onClick={() => router.push('/?tab=cli')}
          className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-[var(--card-foreground)] backdrop-blur-md bg-white/70 border border-white/50 shadow-sm hover:bg-white/90 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3L5 7l3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Clientes
        </button>
      </div>

      {/* Contenido principal */}
      <div className="px-4 pb-28 -mt-2">

        {/* Nombre y estado */}
        <div className="mb-4">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-bold text-[var(--card-foreground)] leading-tight text-balance">
              {cliente.nom}
            </h1>
            <span className={`shrink-0 mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${estadoBadgeClass(cliente.estado)}`}>
              {cliente.estado}
            </span>
          </div>
          {/* Info de contacto compacta */}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {cliente.rfc && (
              <span className="text-xs text-[var(--muted-foreground)]">ID {cliente.rfc}</span>
            )}
            {cliente.tel && (
              <a href={`tel:${cliente.tel}`} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors">
                {cliente.tel}
              </a>
            )}
            {cliente.email && (
              <a href={`mailto:${cliente.email}`} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors truncate max-w-[180px]">
                {cliente.email}
              </a>
            )}
            {cliente.dir && (
              <span className="text-xs text-[var(--muted-foreground)] w-full">{cliente.dir}</span>
            )}
          </div>
        </div>

        {/* Tarjetas de resumen — glass style */}
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-3.5 border border-white shadow-sm">
            <p className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">Balance</p>
            <p className={`text-base font-bold leading-tight ${balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {fmt(balance)}
            </p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-3.5 border border-white shadow-sm">
            <p className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">Facturas</p>
            <p className="text-base font-bold text-[var(--card-foreground)] leading-tight">{facturas.length}</p>
            {facturasPendientes.length > 0 && (
              <p className="text-[10px] text-amber-500 mt-0.5">{facturasPendientes.length} pendiente{facturasPendientes.length > 1 ? 's' : ''}</p>
            )}
          </div>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-3.5 border border-white shadow-sm">
            <p className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">Ordenes</p>
            <p className="text-base font-bold text-[var(--card-foreground)] leading-tight">{ordenes.length}</p>
            {ordenesPendientes.length > 0 && (
              <p className="text-[10px] text-amber-500 mt-0.5">{ordenesPendientes.length} activa{ordenesPendientes.length > 1 ? 's' : ''}</p>
            )}
          </div>
        </div>

        {/* Tabs Facturas / Ordenes */}
        <div className="bg-[var(--muted)] rounded-xl p-1 flex gap-1 mb-4">
          <button
            onClick={() => setActiveTab('facturas')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'facturas'
                ? 'bg-white text-[var(--card-foreground)] shadow-sm'
                : 'text-[var(--muted-foreground)]'
            }`}
          >
            Facturas
          </button>
          <button
            onClick={() => setActiveTab('ordenes')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'ordenes'
                ? 'bg-white text-[var(--card-foreground)] shadow-sm'
                : 'text-[var(--muted-foreground)]'
            }`}
          >
            Ordenes
          </button>
        </div>

        {/* Panel Facturas */}
        {activeTab === 'facturas' && (
          <div>
            {facturas.length === 0 ? (
              <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-6 border border-white text-center">
                <p className="text-sm text-[var(--muted-foreground)]">Sin facturas registradas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {facturas.map((f) => (
                  <div
                    key={f.id}
                    className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Icono estado */}
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        f.estado === 'Pagada' ? 'bg-emerald-50' : 'bg-amber-50'
                      }`}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={f.estado === 'Pagada' ? 'text-emerald-600' : 'text-amber-500'}>
                          {f.estado === 'Pagada' ? (
                            <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          ) : (
                            <path d="M7 3v4.5l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          )}
                        </svg>
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--card-foreground)]">Factura #{f.num}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{fmtDate(f.fecha)}</p>
                      </div>
                      {/* Monto y estado */}
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${f.estado === 'Pagada' ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {fmt(f.total)}
                        </p>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${estadoBadgeClass(f.estado)}`}>
                          {f.estado}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Total acumulado */}
                <div className="bg-[var(--secondary)]/60 backdrop-blur-sm rounded-2xl px-4 py-3 border border-[var(--secondary)] flex justify-between items-center mt-1">
                  <p className="text-xs font-medium text-[var(--secondary-foreground)]">Total facturado</p>
                  <p className="text-sm font-bold text-[var(--primary)]">{fmt(totalFacturas)}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Panel Ordenes */}
        {activeTab === 'ordenes' && (
          <div>
            {/* Boton Nueva Orden — inline rectangular cerca de las ordenes */}
            <button
              onClick={() => router.push(`/clientes/${clienteId}/nueva-orden`)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-semibold border border-[var(--secondary-foreground)]/10 hover:bg-[var(--secondary-foreground)]/10 transition-colors mb-3"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Nueva Orden
            </button>

            {ordenes.length === 0 ? (
              <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-6 border border-white text-center">
                <p className="text-sm text-[var(--muted-foreground)]">Sin ordenes registradas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {ordenes.map((o) => (
                  <div
                    key={o.id}
                    className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Icono */}
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        o.estado === 'Completada' ? 'bg-emerald-50' : 'bg-amber-50'
                      }`}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={o.estado === 'Completada' ? 'text-emerald-600' : 'text-amber-500'}>
                          <rect x="2" y="3" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                          <path d="M4.5 6.5h5M4.5 8.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                        </svg>
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--card-foreground)]">Orden #{o.num}</p>
                        {o.fecha && <p className="text-xs text-[var(--muted-foreground)]">{fmtDate(o.fecha)}</p>}
                      </div>
                      {/* Acciones */}
                      <div className="flex items-center gap-2 shrink-0">
                        {o.total != null && (
                          <p className="text-sm font-bold text-[var(--card-foreground)]">{fmt(o.total)}</p>
                        )}
                        <button
                          onClick={() => router.push(`/ordenes/${o.id}/pick-sheet`)}
                          className="px-2.5 py-1.5 rounded-lg bg-[var(--secondary)] text-[var(--secondary-foreground)] text-[10px] font-semibold hover:opacity-80 transition-opacity whitespace-nowrap"
                        >
                          Pick Sheet
                        </button>
                      </div>
                    </div>
                    {/* Badge estado en barra inferior */}
                    <div className={`px-4 py-1.5 border-t border-[var(--border)]/30 ${
                      o.estado === 'Completada' ? 'bg-emerald-50/50' : 'bg-amber-50/50'
                    }`}>
                      <span className={`text-[10px] font-semibold ${estadoBadgeClass(o.estado)} px-2 py-0.5 rounded-full`}>
                        {o.estado}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
