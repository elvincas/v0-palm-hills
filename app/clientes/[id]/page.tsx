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
  fecha: string
  estado: string
  total: number
}

export default function ClienteDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clienteId = params.id as string

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [ordenes, setOrdenes] = useState<Orden[]>([])
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)

  useEffect(() => {
    const loadData = async () => {
      try {
        const supabase = createClient()

        // Cargar cliente
        const { data: c } = await supabase.from('clientes').select('*').eq('id', clienteId).single()
        if (c) setCliente(c as Cliente)

        // Cargar facturas
        const { data: f } = await supabase.from('facturas').select('*').eq('cli', clienteId)
        if (f) setFacturas(f as Factura[])

        // Cargar órdenes
        const { data: o } = await supabase.from('ordenes').select('*').eq('cli', clienteId)
        if (o) setOrdenes(o as Orden[])

        // Calcular balance
        if (f) {
          const total = f.reduce((sum, fac) => sum + (fac.total || 0), 0)
          const pagado = f.filter((fac) => fac.estado === 'Pagada').reduce((sum, fac) => sum + (fac.total || 0), 0)
          setBalance(total - pagado)
        }
      } catch (error) {
        console.log('[v0] Error loading cliente details:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [clienteId])

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!cliente) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center h-96">
          <p className="text-destructive">Cliente no encontrado</p>
        </div>
      </div>
    )
  }

  const facturasPendientes = facturas.filter((f) => f.estado !== 'Pagada')
  const facturasPagadas = facturas.filter((f) => f.estado === 'Pagada')
  const ordenesPendientes = ordenes.filter((o) => o.estado !== 'Completada')

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto p-4 pb-20">
        {/* Botón volver */}
        <button onClick={() => router.back()} className="text-primary text-sm font-medium mb-4">
          ← Volver
        </button>

        {/* Header del Cliente */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden mb-6">
          {cliente.foto_local && (
            <img src={cliente.foto_local} alt={cliente.nom} className="w-full h-32 object-cover" />
          )}

          <div className="p-4">
            <h1 className="text-2xl font-bold text-card-foreground mb-2">{cliente.nom}</h1>

            <div className="space-y-1 text-sm text-muted-foreground mb-4">
              {cliente.rfc && <p>ID: {cliente.rfc}</p>}
              {cliente.email && <p>Email: {cliente.email}</p>}
              {cliente.tel && <p>Teléfono: {cliente.tel}</p>}
              {cliente.dir && <p>Dirección: {cliente.dir}</p>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-primary bg-opacity-10 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Balance Pendiente</p>
                <p className="text-lg font-bold text-primary">${balance.toFixed(2)}</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Total Facturas</p>
                <p className="text-lg font-bold text-green-600">{facturas.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Facturas Pendientes */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-card-foreground mb-3">
            Facturas Pendientes ({facturasPendientes.length})
          </h2>

          {facturasPendientes.length > 0 ? (
            <div className="space-y-2">
              {facturasPendientes.map((f) => (
                <div key={f.id} className="bg-card rounded-xl p-3 border border-border flex justify-between items-center">
                  <div>
                    <p className="font-medium text-card-foreground">Factura #{f.num}</p>
                    <p className="text-xs text-muted-foreground">{f.fecha}</p>
                  </div>
                  <p className="font-bold text-primary">${f.total?.toFixed(2)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-card rounded-xl p-4 border border-border text-center text-muted-foreground text-sm">
              Sin facturas pendientes
            </div>
          )}
        </div>

        {/* Órdenes Pendientes */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-card-foreground mb-3">
            Órdenes Pendientes ({ordenesPendientes.length})
          </h2>

          {ordenesPendientes.length > 0 ? (
            <div className="space-y-2">
              {ordenesPendientes.map((o) => (
                <div key={o.id} className="bg-card rounded-xl p-3 border border-border">
                  <p className="font-medium text-card-foreground">Orden #{o.num}</p>
                  <p className="text-xs text-muted-foreground mt-1">Fecha: {o.fecha}</p>
                  <p className="text-xs text-primary font-medium mt-1">Total: ${o.total?.toFixed(2)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-card rounded-xl p-4 border border-border text-center text-muted-foreground text-sm">
              Sin órdenes pendientes
            </div>
          )}
        </div>

        {/* Facturas Pagadas */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-card-foreground mb-3">
            Facturas Pagadas ({facturasPagadas.length})
          </h2>

          {facturasPagadas.length > 0 ? (
            <div className="space-y-2">
              {facturasPagadas.map((f) => (
                <div
                  key={f.id}
                  className="bg-card rounded-xl p-3 border border-border flex justify-between items-center opacity-75"
                >
                  <div>
                    <p className="font-medium text-card-foreground">Factura #{f.num}</p>
                    <p className="text-xs text-muted-foreground">{f.fecha}</p>
                  </div>
                  <p className="font-bold text-green-600">${f.total?.toFixed(2)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-card rounded-xl p-4 border border-border text-center text-muted-foreground text-sm">
              Sin facturas pagadas
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
