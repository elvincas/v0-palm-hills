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

interface Producto {
  id: string
  cod: string
  nom: string
  stock: number
  reservado: number
  precio: number
  foto?: string
  fab?: string
  sku?: string
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

export default function ClienteDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clienteId = params.id as string
  const supabase = createClient()

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [ordenes, setOrdenes] = useState<Orden[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedProducts, setSelectedProducts] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const loadData = async () => {
      try {
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
        console.log("[v0] Error loading cliente details:", error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [clienteId, supabase])

  const handleQuantityChange = (productId: string, qty: number) => {
    if (qty <= 0) {
      const newSelected = { ...selectedProducts }
      delete newSelected[productId]
      setSelectedProducts(newSelected)
    } else {
      setSelectedProducts({ ...selectedProducts, [productId]: qty })
    }
  }

  const handleSubmitOrder = async () => {
    const itemsToOrder = Object.entries(selectedProducts).filter(([_, qty]) => qty > 0)
    
    if (itemsToOrder.length === 0) {
      alert('Selecciona al menos un producto')
      return
    }

    setSubmitting(true)
    try {
      // Obtener próximo número de orden
      const { data: lastOrder } = await supabase
        .from('ordenes')
        .select('num')
        .order('num', { ascending: false })
        .limit(1)
      
      const nextNum = (lastOrder?.[0]?.num ?? 0) + 1

      // Calcular total y preparar líneas
      let total = 0
      const lineas = []
      const pickSheetItems = []

      for (const [productId, qty] of itemsToOrder) {
        const producto = productos.find(p => p.id === productId)
        if (!producto) continue

        const subtotal = (producto.precio || 0) * qty
        total += subtotal

        lineas.push({
          producto_id: productId,
          cantidad: qty,
          precio_unitario: producto.precio,
          subtotal
        })

        pickSheetItems.push({
          cod: producto.cod,
          nom: producto.nom,
          cantidad: qty,
          foto: producto.foto,
          fab: producto.fab,
          ubicacion: ''
        })
      }

      // Crear orden
      const { error: orderError } = await supabase
        .from('ordenes')
        .insert({
          num: nextNum,
          cli: clienteId,
          fecha: new Date().toISOString().split('T')[0],
          estado: 'Pendiente',
          total,
          lineas,
          pick_sheet: { items: pickSheetItems, fecha_creacion: new Date().toISOString() }
        })

      if (orderError) throw orderError

      // Actualizar reservado en productos
      for (const [productId, qty] of itemsToOrder) {
        const producto = productos.find(p => p.id === productId)
        if (producto) {
          await supabase
            .from('productos')
            .update({ reservado: (producto.reservado || 0) + qty })
            .eq('id', productId)
        }
      }

      alert(`Orden #${nextNum} creada exitosamente. Total: $${total.toFixed(2)}`)
      setSelectedProducts({})
      setShowNewOrder(false)
      
      // Recargar órdenes y productos
      const { data: o } = await supabase.from('ordenes').select('*').eq('cli', clienteId)
      if (o) setOrdenes(o as Orden[])
      
      const { data: p } = await supabase.from('productos').select('*')
      if (p) setProductos(p as Producto[])
    } catch (error) {
      console.log("[v0] Error creating order:", error)
      alert('Error al crear la orden')
    } finally {
      setSubmitting(false)
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

  const filteredProducts = productos.filter(p =>
    p.nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.sku && p.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const totalOrder = Object.entries(selectedProducts).reduce((sum, [productId, qty]) => {
    const prod = productos.find(p => p.id === productId)
    return sum + ((prod?.precio || 0) * qty)
  }, 0)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-4 pb-20">
        {/* Header del Cliente */}
        <div className="mb-6">
          <button
            onClick={() => router.push("/?tab=cli")}
            className="text-primary text-sm font-medium mb-4 cursor-pointer hover:opacity-80 transition-opacity"
          >
            ← Volver a Clientes
          </button>
          
          <div className="bg-card rounded-2xl p-4 border border-border">
            {cliente.foto_local && (
              <img
                src={cliente.foto_local}
                alt={cliente.nom}
                className="w-full h-32 object-cover rounded-xl mb-4"
              />
            )}
            
            <h1 className="text-2xl font-bold text-card-foreground mb-2">{cliente.nom}</h1>
            
            <div className="space-y-1.5 text-sm text-muted-foreground mb-4">
              {cliente.rfc && <p>ID: {cliente.rfc}</p>}
              {cliente.email && <p>Email: {cliente.email}</p>}
              {cliente.tel && <p>Teléfono: {cliente.tel}</p>}
              {cliente.dir && <p>Dirección: {cliente.dir}</p>}
            </div>

            <div className="flex gap-2">
              <div className="flex-1 bg-primary bg-opacity-10 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Balance Pendiente</p>
                <p className="text-xl font-bold text-primary">${balance.toFixed(2)}</p>
              </div>
              <div className="flex-1 bg-green-50 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Total Facturas</p>
                <p className="text-xl font-bold text-green-600">{facturas.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Facturas Pendientes */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-card-foreground mb-3">Facturas Pendientes ({facturasPendientes.length})</h2>
          
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
          <h2 className="text-lg font-bold text-card-foreground mb-3">Órdenes Pendientes ({ordenesPendientes.length})</h2>
          
          {ordenesPendientes.length > 0 ? (
            <div className="space-y-2">
              {ordenesPendientes.map((o) => (
                <div key={o.id} className="bg-card rounded-xl p-3 border border-border">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <p className="font-medium text-card-foreground">Orden #{o.num}</p>
                      {o.fecha && <p className="text-xs text-muted-foreground mt-1">Fecha: {o.fecha}</p>}
                      {o.total && <p className="text-xs text-muted-foreground mt-1">Total: ${o.total.toFixed(2)}</p>}
                    </div>
                    <button
                      onClick={() => router.push(`/ordenes/${o.id}/pick-sheet`)}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold whitespace-nowrap hover:opacity-90"
                    >
                      Ver Pick Sheet
                    </button>
                  </div>
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
          <h2 className="text-lg font-bold text-card-foreground mb-3">Facturas Pagadas ({facturasPagadas.length})</h2>
          
          {facturasPagadas.length > 0 ? (
            <div className="space-y-2">
              {facturasPagadas.map((f) => (
                <div key={f.id} className="bg-card rounded-xl p-3 border border-border flex justify-between items-center opacity-75">
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

        {/* Modal Nueva Orden */}
        {showNewOrder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-background rounded-2xl p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto border border-border">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-card-foreground">Nueva Orden para {cliente.nom}</h2>
                <button
                  onClick={() => {
                    setShowNewOrder(false)
                    setSelectedProducts({})
                    setSearchTerm('')
                  }}
                  className="text-muted-foreground hover:text-card-foreground text-2xl"
                >
                  ×
                </button>
              </div>

              {/* Buscador */}
              <input
                type="text"
                placeholder="Buscar por nombre o código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-input bg-background mb-4 text-card-foreground"
              />

              {/* Grid de Productos */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                {filteredProducts.map((p) => {
                  const disponible = p.stock - p.reservado
                  const qty = selectedProducts[p.id] || 0
                  return (
                    <div key={p.id} className="bg-card rounded-xl border border-border p-3 overflow-hidden">
                      {p.foto && (
                        <img
                          src={p.foto}
                          alt={p.nom}
                          className="w-full h-24 object-cover rounded-lg mb-2"
                        />
                      )}
                      <p className="text-xs text-muted-foreground mb-1">COD: {p.cod}</p>
                      <p className="font-bold text-card-foreground text-sm mb-1 truncate">{p.nom}</p>
                      <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
                        <p>Stock: {p.stock} | Reservado: {p.reservado}</p>
                        <p className="font-medium text-primary">Disponible: {disponible}</p>
                      </div>
                      <p className="text-sm font-bold text-primary mb-3">${p.precio?.toFixed(2)}</p>
                      <input
                        type="number"
                        min="0"
                        max={disponible}
                        value={qty}
                        onChange={(e) => handleQuantityChange(p.id, parseInt(e.target.value) || 0)}
                        placeholder="Cantidad"
                        className="w-full px-2 py-2 rounded-lg border border-input bg-background text-sm text-center text-card-foreground"
                      />
                      {qty > disponible && (
                        <p className="text-xs text-destructive mt-1">Excede disponible</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {filteredProducts.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  No se encontraron productos
                </div>
              )}

              {/* Resumen */}
              <div className="bg-primary bg-opacity-10 rounded-xl p-4 mb-4">
                <p className="text-sm text-muted-foreground mb-1">Total de orden:</p>
                <p className="text-3xl font-bold text-primary">${totalOrder.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-2">{Object.values(selectedProducts).reduce((a, b) => a + b, 0)} producto(s) seleccionado(s)</p>
              </div>

              {/* Botones */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowNewOrder(false)
                    setSelectedProducts({})
                    setSearchTerm('')
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-card-foreground font-medium"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSubmitOrder}
                  disabled={Object.values(selectedProducts).reduce((a, b) => a + b, 0) === 0 || submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Creando...' : 'Crear Orden'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Botón flotante */}
        <button
          onClick={() => setShowNewOrder(true)}
          className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-primary text-primary-foreground text-2xl font-bold shadow-lg hover:opacity-90 transition-opacity z-40"
        >
          +
        </button>
      </div>
    </div>
  )
}
