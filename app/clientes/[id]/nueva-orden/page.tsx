'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Cliente {
  id: string
  nom: string
}

interface Producto {
  id: string
  nom: string
  sku?: string
  barcode?: string
  fabricante?: string
  etiquetas?: string[]
  precio: number
  stock: number
  reservado?: number
  icon?: string
  foto?: string | null
}

const today = () => new Date().toISOString().slice(0, 10)
const fmt = (n: number) =>
  new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'USD' }).format(n || 0)

export default function NuevaOrdenPage() {
  const params = useParams()
  const router = useRouter()
  const clienteId = params.id as string

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [fecha, setFecha] = useState(today())
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string>('')
  // cantidades por producto: { [prodId]: qty }
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: c } = await supabase.from('clientes').select('id, nom').eq('id', clienteId).single()
        if (c) setCliente(c as Cliente)
        const { data: p } = await supabase.from('productos').select('*').order('nom')
        if (p) setProductos(p as Producto[])
      } catch (error) {
        console.log('[v0] Error loading nueva orden:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [clienteId])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    productos.forEach((p) => (p.etiquetas || []).forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [productos])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return productos.filter((p) => {
      const matchSearch =
        !q ||
        p.nom.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q)
      const matchTag = !tagFilter || (p.etiquetas || []).includes(tagFilter)
      return matchSearch && matchTag
    })
  }, [productos, search, tagFilter])

  const disponible = (p: Producto) => Number(p.stock || 0) - Number(p.reservado || 0)

  const setQty = (prodId: string, qty: number) => {
    setCantidades((prev) => {
      const next = { ...prev }
      if (!qty || qty <= 0) {
        delete next[prodId]
      } else {
        next[prodId] = qty
      }
      return next
    })
  }

  const seleccionados = useMemo(
    () =>
      Object.entries(cantidades)
        .map(([prodId, qty]) => {
          const p = productos.find((x) => x.id === prodId)
          return p ? { p, qty } : null
        })
        .filter(Boolean) as { p: Producto; qty: number }[],
    [cantidades, productos],
  )

  const total = seleccionados.reduce((acc, { p, qty }) => acc + Number(p.precio) * qty, 0)
  const totalUnidades = seleccionados.reduce((acc, { qty }) => acc + qty, 0)

  const handleEnviar = async () => {
    if (seleccionados.length === 0) {
      alert('Agrega al menos un producto')
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()

      const lineasDetalle = seleccionados.map(({ p, qty }) => ({
        prodId: p.id,
        prodNom: p.nom,
        barcode: p.barcode || '',
        sku: p.sku || '',
        precio: Number(p.precio),
        qty,
      }))

      // Siguiente número de orden global
      const { data: allOrdenes } = await supabase.from('ordenes').select('num')
      const maxNum = (allOrdenes || []).reduce((m, o) => Math.max(m, o.num || 0), 0)
      const num = maxNum + 1

      // Pick sheet generado
      const pickSheet = {
        generado: new Date().toISOString(),
        cliente: cliente?.nom || '',
        items: seleccionados.map(({ p, qty }) => ({
          prodId: p.id,
          prodNom: p.nom,
          sku: p.sku || '',
          barcode: p.barcode || '',
          qty,
          recogido: false,
        })),
      }

      // Insertar orden
      const { data: orden, error: ordenError } = await supabase
        .from('ordenes')
        .insert({
          cli: clienteId,
          fecha,
          estado: 'Pendiente',
          total: +total.toFixed(2),
          lineas: lineasDetalle,
          pick_sheet: pickSheet,
          num,
        })
        .select()
        .single()

      if (ordenError) throw ordenError

      // Reservar inventario: reservado += qty para cada producto
      for (const { p, qty } of seleccionados) {
        const nuevoReservado = Number(p.reservado || 0) + qty
        await supabase.from('productos').update({ reservado: nuevoReservado }).eq('id', p.id)
      }

      // Ir al pick sheet de la orden recién creada
      router.push(`/ordenes/${orden.id}/pick-sheet`)
    } catch (error) {
      console.log('[v0] Error creando orden:', error)
      alert('Error al crear la orden. Intenta de nuevo.')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando productos...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header fijo */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto p-4">
          <button
            onClick={() => router.push(`/clientes/${clienteId}`)}
            className="text-primary text-sm font-medium mb-2 cursor-pointer"
          >
            ← Volver al cliente
          </button>
          <h1 className="text-xl font-bold text-card-foreground">Nueva Orden</h1>
          {cliente && <p className="text-sm text-muted-foreground">Cliente: {cliente.nom}</p>}

          <div className="mt-3 flex flex-col gap-2">
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-card-foreground text-sm"
            />
            <input
              type="search"
              inputMode="search"
              placeholder="Buscar por nombre, SKU o código de barras"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-card-foreground text-base"
            />
            {allTags.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button
                  onClick={() => setTagFilter('')}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${
                    !tagFilter
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-secondary-foreground border-border'
                  }`}
                >
                  Todos
                </button>
                {allTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTagFilter(t === tagFilter ? '' : t)}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${
                      tagFilter === t
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-secondary-foreground border-border'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Catálogo de productos */}
      <div className="max-w-2xl mx-auto p-4 pb-40">
        <div className="grid grid-cols-2 gap-2.5">
          {filtered.length ? (
            filtered.map((p) => {
              const disp = disponible(p)
              const qty = cantidades[p.id] || 0
              const excede = qty > disp
              return (
                <div
                  key={p.id}
                  className={`bg-card border rounded-2xl p-3 flex flex-col h-full ${
                    qty > 0 ? 'border-primary' : 'border-border'
                  }`}
                >
                  <div className="w-full aspect-square rounded-lg bg-white flex items-center justify-center text-2xl mb-2 shrink-0">
                    {p.foto ? (
                      <img src={p.foto || "/placeholder.svg"} alt={p.nom} className="w-full h-full object-contain" />
                    ) : (
                      p.icon || '📦'
                    )}
                  </div>
                  <div className="text-xs font-bold mb-1 text-card-foreground leading-snug break-words min-h-[2.25rem]">
                    {p.nom}
                  </div>
                  {p.sku && (
                    <div className="text-xs text-muted-foreground font-mono mb-0.5 break-all">{p.sku}</div>
                  )}
                  {p.barcode && (
                    <div className="text-xs text-muted-foreground font-mono mb-0.5 break-all">CB: {p.barcode}</div>
                  )}
                  <div className="text-sm font-bold text-secondary-foreground mt-1">{fmt(p.precio)}</div>
                  <div className={`text-xs mt-0.5 ${disp <= 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    Disponible: {disp} uds.
                  </div>

                  {/* Casilla de cantidad */}
                  <div className="mt-2 pt-2 border-t border-border">
                    <label className="text-[10px] text-muted-foreground block mb-1">Cantidad</label>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="0"
                      value={qty || ''}
                      onChange={(e) => setQty(p.id, Number(e.target.value))}
                      className={`w-full px-2 py-2 rounded-lg border bg-background text-card-foreground text-base text-center font-bold ${
                        excede ? 'border-destructive text-destructive' : 'border-input'
                      }`}
                    />
                    {excede && (
                      <p className="text-[10px] text-destructive mt-1">Excede stock disponible ({disp})</p>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="col-span-2 text-center text-muted-foreground py-10 text-sm">
              No se encontraron productos
            </div>
          )}
        </div>
      </div>

      {/* Barra inferior con resumen */}
      {seleccionados.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-card border-t border-border">
          <div className="max-w-2xl mx-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {seleccionados.length} productos · {totalUnidades} uds.
                </p>
                <p className="text-xl font-bold text-primary">{fmt(total)}</p>
              </div>
              <button
                onClick={() => setReviewing(true)}
                className="px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold"
              >
                Revisar orden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de revisión */}
      {reviewing && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-30">
          <div className="bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border max-h-[90vh] overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-card-foreground">Revisar Orden</h3>
                <button onClick={() => setReviewing(false)} className="text-muted-foreground text-2xl leading-none">
                  ×
                </button>
              </div>

              <p className="text-sm text-muted-foreground mb-1">
                Cliente: <span className="font-medium text-card-foreground">{cliente?.nom}</span>
              </p>
              <p className="text-sm text-muted-foreground mb-4">Fecha: {fecha}</p>

              <div className="space-y-2 mb-4">
                {seleccionados.map(({ p, qty }) => {
                  const disp = disponible(p)
                  const excede = qty > disp
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 bg-background rounded-xl p-2 border border-border"
                    >
                      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-lg shrink-0 overflow-hidden">
                        {p.foto ? (
                          <img src={p.foto || "/placeholder.svg"} alt={p.nom} className="w-full h-full object-contain" />
                        ) : (
                          p.icon || '📦'
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-card-foreground truncate">{p.nom}</p>
                        <p className="text-xs text-muted-foreground">
                          {qty} × {fmt(p.precio)}
                        </p>
                        {excede && <p className="text-[10px] text-destructive">Excede disponible ({disp})</p>}
                      </div>
                      <p className="text-sm font-bold text-card-foreground">{fmt(p.precio * qty)}</p>
                    </div>
                  )
                })}
              </div>

              <div className="flex justify-between items-center mb-4 pt-3 border-t border-border">
                <span className="text-sm text-muted-foreground">Total ({totalUnidades} uds.)</span>
                <span className="text-xl font-bold text-primary">{fmt(total)}</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setReviewing(false)}
                  className="flex-1 px-4 py-3 rounded-xl bg-secondary text-secondary-foreground font-bold"
                >
                  Seguir editando
                </button>
                <button
                  onClick={handleEnviar}
                  disabled={saving}
                  className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-60"
                >
                  {saving ? 'Enviando...' : 'Enviar orden'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
