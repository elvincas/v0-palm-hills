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

interface LineaOrden {
  prodId: string
  prodNom: string
  barcode: string
  sku: string
  precio: number
  qty: number
}

interface Orden {
  id: string
  num: number
  cli: string
  fecha: string
  estado: string
  total: number
  lineas?: LineaOrden[]
}

interface Producto {
  id: string
  nom: string
  sku?: string
  barcode?: string
  precio: number
}

const today = () => new Date().toISOString().slice(0, 10)

export default function ClienteDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clienteId = params.id as string

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [ordenes, setOrdenes] = useState<Orden[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)

  // Estado del modal de nueva orden
  const [showOrden, setShowOrden] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fecha, setFecha] = useState(today())
  const [lineas, setLineas] = useState([{ prodId: '', qty: 1 }])

  useEffect(() => {
    const loadData = async () => {
      try {
        const supabase = createClient()

        const { data: c } = await supabase.from('clientes').select('*').eq('id', clienteId).single()
        if (c) setCliente(c as Cliente)

        const { data: f } = await supabase.from('facturas').select('*').eq('cli', clienteId)
        if (f) setFacturas(f as Factura[])

        const { data: o } = await supabase.from('ordenes').select('*').eq('cli', clienteId)
        if (o) setOrdenes(o as Orden[])

        const { data: p } = await supabase.from('productos').select('*')
        if (p) setProductos(p as Producto[])

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

  const totalOrden = lineas.reduce((acc, l) => {
    const p = productos.find((x) => x.id === l.prodId)
    return acc + (p ? Number(p.precio) * Number(l.qty || 1) : 0)
  }, 0)

  const handleSaveOrden = async () => {
    const items = lineas.filter((l) => l.prodId)
    if (items.length === 0) {
      alert('Agrega al menos un producto')
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()
      const lineasDetalle = items.map((l) => {
        const p = productos.find((x) => x.id === l.prodId)!
        return {
          prodId: p.id,
          prodNom: p.nom,
          barcode: p.barcode || '',
          sku: p.sku || '',
          precio: Number(p.precio),
          qty: Number(l.qty),
        }
      })

      // Calcular siguiente número de orden global
      const { data: allOrdenes } = await supabase.from('ordenes').select('num')
      const maxNum = (allOrdenes || []).reduce((m, o) => Math.max(m, o.num || 0), 0)
      const num = maxNum + 1

      const { data } = await supabase
        .from('ordenes')
        .insert({
          cli: clienteId,
          fecha,
          estado: 'Pendiente',
          total: +totalOrden.toFixed(2),
          lineas: lineasDetalle,
          num,
        })
        .select()
        .single()

      if (data) {
        setOrdenes((prev) => [data as Orden, ...prev])
      }

      setShowOrden(false)
      setLineas([{ prodId: '', qty: 1 }])
      setFecha(today())
    } catch (error) {
      console.log('[v0] Error creating orden:', error)
      alert('Error al crear la orden')
    } finally {
      setSaving(false)
    }
  }

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
            <img src={cliente.foto_local || "/placeholder.svg"} alt={cliente.nom} className="w-full h-32 object-cover" />
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

      {/* Botón flotante para nueva orden */}
      <button
        onClick={() => setShowOrden(true)}
        aria-label="Nueva orden"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-primary-foreground text-3xl flex items-center justify-center shadow-lg z-10"
      >
        +
      </button>

      {/* Modal de nueva orden */}
      {showOrden && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-20 p-0 sm:p-4">
          <div className="bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border max-h-[90vh] overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-card-foreground">Nueva Orden</h3>
                <button onClick={() => setShowOrden(false)} className="text-muted-foreground text-2xl leading-none">
                  ×
                </button>
              </div>

              <p className="text-sm text-muted-foreground mb-3">Cliente: <span className="font-medium text-card-foreground">{cliente.nom}</span></p>

              <label className="block text-xs font-medium text-muted-foreground mb-1">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-card-foreground mb-4"
              />

              <label className="block text-xs font-medium text-muted-foreground mb-2">Productos</label>
              <div className="space-y-2 mb-3">
                {lineas.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <select
                      value={l.prodId}
                      onChange={(e) => {
                        const next = [...lineas]
                        next[i] = { ...next[i], prodId: e.target.value }
                        setLineas(next)
                      }}
                      className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-card-foreground text-sm"
                    >
                      <option value="">Selecciona producto</option>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nom} - ${Number(p.precio).toFixed(2)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => {
                        const next = [...lineas]
                        next[i] = { ...next[i], qty: Number(e.target.value) }
                        setLineas(next)
                      }}
                      className="w-16 px-2 py-2 rounded-lg border border-input bg-background text-card-foreground text-sm"
                    />
                    {lineas.length > 1 && (
                      <button
                        onClick={() => setLineas(lineas.filter((_, idx) => idx !== i))}
                        className="px-3 rounded-lg bg-red-50 text-destructive font-bold"
                        aria-label="Quitar producto"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={() => setLineas([...lineas, { prodId: '', qty: 1 }])}
                className="text-primary text-sm font-medium mb-4"
              >
                + Agregar otro producto
              </button>

              <div className="flex justify-between items-center mb-4 pt-3 border-t border-border">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-xl font-bold text-primary">${totalOrden.toFixed(2)}</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowOrden(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground font-bold"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveOrden}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : 'Crear Orden'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
