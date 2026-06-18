'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getDeliveryDays, nextDeliveryDate } from '@/lib/delivery'

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
  min?: number
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

  const [fecha, setFecha] = useState(() => nextDeliveryDate(getDeliveryDays()))
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string>('')
  // cantidades por producto: { [prodId]: qty }
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  // precio con descuento manual por producto: { [prodId]: precioFinal }
  const [descuentos, setDescuentos] = useState<Record<string, number>>({})
  const [editandoDescuento, setEditandoDescuento] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [columnas, setColumnas] = useState<2 | 3>(() => {
    if (typeof window === 'undefined') return 2
    return (Number(localStorage.getItem('ph_columnas_orden')) as 2 | 3) || 2
  })

  const cambiarColumnas = (n: 2 | 3) => {
    setColumnas(n)
    localStorage.setItem('ph_columnas_orden', String(n))
  }

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

  const precioEfectivo = (p: Producto) => descuentos[p.id] ?? p.precio

  const setDescuento = (prodId: string, precio: number) => {
    setDescuentos((prev) => ({ ...prev, [prodId]: Math.max(0, precio) }))
  }

  const quitarDescuento = (prodId: string) => {
    setDescuentos((prev) => {
      const next = { ...prev }
      delete next[prodId]
      return next
    })
  }

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

  const total = seleccionados.reduce((acc, { p, qty }) => acc + precioEfectivo(p) * qty, 0)
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
        precioFinal: precioEfectivo(p),
        qty,
        qtyEnviada: qty,
      }))

      // Siguiente número de orden global
      const { data: allOrdenes } = await supabase.from('ordenes').select('num')
      const maxNum = (allOrdenes || []).reduce((m, o) => Math.max(m, o.num || 0), 0)
      const num = maxNum + 1

      // Insertar orden (pendiente, lista para tomarse desde "Ordenes")
      const { data: orden, error: ordenError } = await supabase
        .from('ordenes')
        .insert({
          cli: clienteId,
          fecha,
          estado: 'Pendiente',
          total: +total.toFixed(2),
          lineas: lineasDetalle,
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

      alert(`Orden #${num} creada. Queda pendiente en Ordenes.`)
      router.push(`/clientes/${clienteId}`)
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
        <div className="max-w-2xl mx-auto p-4" style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}>
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
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-card-foreground text-sm"
            />
            <input
              type="search"
              inputMode="search"
              placeholder="Buscar por nombre, SKU o código de barras"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-card-foreground text-base"
            />
            {allTags.length > 0 && (
              <div
                className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1"
                style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
              >
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
      <div className="max-w-2xl mx-auto p-4 pb-44" style={{ paddingBottom: "calc(11rem + env(safe-area-inset-bottom))" }}>
        <div className="flex justify-end mb-2.5">
          <div className="inline-flex backdrop-blur-md bg-white/40 border border-white/60 rounded-full p-1 shadow-sm gap-0.5">
            <button
              onClick={() => cambiarColumnas(2)}
              aria-label="2 columnas"
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                columnas === 2 ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              ▥ 2
            </button>
            <button
              onClick={() => cambiarColumnas(3)}
              aria-label="3 columnas"
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                columnas === 3 ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              ▦ 3
            </button>
          </div>
        </div>
        <div className={`grid gap-2.5 ${columnas === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {filtered.length ? (
            filtered.map((p) => {
              const disp = disponible(p)
              const qty = cantidades[p.id] || 0
              const excede = qty > disp
              const min = Number(p.min || 5)
              const stockEstado = disp <= 0 ? 'Sin stock' : disp <= min ? 'Stock bajo' : 'En stock'
              const estadoColor =
                stockEstado === 'Sin stock'
                  ? 'bg-red-100 text-red-800'
                  : stockEstado === 'Stock bajo'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-green-100 text-green-800'
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
                  {p.fabricante && (
                    <div className="text-xs text-muted-foreground mb-0.5 break-words">{p.fabricante}</div>
                  )}
                  {p.barcode && (
                    <div className="text-xs text-muted-foreground font-mono mb-0.5 break-all">CB: {p.barcode}</div>
                  )}
                  {(p.etiquetas || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {p.etiquetas!.slice(0, 4).map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                          {t}
                        </span>
                      ))}
                      {p.etiquetas!.length > 4 && (
                        <span className="text-[10px] px-1 py-0.5 text-muted-foreground">+{p.etiquetas!.length - 4}</span>
                      )}
                    </div>
                  )}
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold inline-flex mb-1 self-start ${estadoColor}`}>
                    {stockEstado}
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    {descuentos[p.id] !== undefined && descuentos[p.id] !== p.precio ? (
                      <>
                        <span className="text-xs text-muted-foreground line-through">{fmt(p.precio)}</span>
                        <span className="text-sm font-bold text-primary">{fmt(descuentos[p.id])}</span>
                      </>
                    ) : (
                      <span className="text-sm font-bold text-secondary-foreground">{fmt(p.precio)}</span>
                    )}
                  </div>
                  <div className={`text-xs mt-0.5 ${disp <= 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    Disponible: {disp} uds.
                  </div>

                  {/* Aplicar descuento */}
                  {editandoDescuento === p.id ? (
                    <div className="mt-2 pt-2 border-t border-border">
                      <label className="text-[10px] text-muted-foreground block mb-1">Precio para esta orden</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          autoComplete="off"
                          defaultValue={descuentos[p.id] ?? p.precio}
                          autoFocus
                          onBlur={(e) => {
                            setDescuento(p.id, Number(e.target.value))
                            setEditandoDescuento(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setDescuento(p.id, Number((e.target as HTMLInputElement).value))
                              setEditandoDescuento(null)
                            }
                          }}
                          className="flex-1 px-2 py-1.5 rounded-lg border border-input bg-background text-card-foreground text-sm text-center font-bold"
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditandoDescuento(p.id)}
                      className="mt-2 text-[11px] font-medium text-primary underline self-start"
                    >
                      🏷️ Aplicar descuento
                    </button>
                  )}
                  {descuentos[p.id] !== undefined && (
                    <button
                      onClick={() => quitarDescuento(p.id)}
                      className="mt-1 text-[11px] text-destructive underline self-start"
                    >
                      Quitar descuento
                    </button>
                  )}

                  {/* Casilla de cantidad */}
                  <div className="mt-2 pt-2 border-t border-border">
                    <label className="text-[10px] text-muted-foreground block mb-1">Cantidad</label>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      autoComplete="off"
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

      {/* Barra inferior con resumen (siempre visible, estilo vidrio) */}
      <div
        className="fixed bottom-0 inset-x-0 z-30 backdrop-blur-xl bg-card/85 border-t border-white/40 shadow-[0_-12px_32px_-4px_rgba(0,0,0,0.15)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {seleccionados.length} productos · {totalUnidades} uds.
              </p>
              <p className="text-xl font-bold text-primary truncate">{fmt(total)}</p>
            </div>
            <button
              onClick={() => setReviewing(true)}
              disabled={seleccionados.length === 0}
              className="shrink-0 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 shadow-md"
            >
              Revisar orden
            </button>
          </div>
        </div>
      </div>

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
                          {qty} × {fmt(precioEfectivo(p))}
                          {descuentos[p.id] !== undefined && descuentos[p.id] !== p.precio && (
                            <span className="ml-1 line-through text-muted-foreground/70">{fmt(p.precio)}</span>
                          )}
                        </p>
                        {excede && <p className="text-[10px] text-destructive">Excede disponible ({disp})</p>}
                      </div>
                      <p className="text-sm font-bold text-card-foreground">{fmt(precioEfectivo(p) * qty)}</p>
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
