'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { flexibleSearch } from '@/lib/search'
import { BackButton } from '@/components/back-button'

interface Cliente {
  id: string
  nom: string
  lista_precio_id?: string | null
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
  almacen?: 'palmhills' | 'castillo'
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

const fdate = (s: string) => {
  const [y, m, d] = s.split('-')
  return `${m}/${d}/${y}`
}

const DIAS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MESES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function DeliveryCalendar({ fechas, value, onChange }: { fechas: string[]; value: string; onChange: (d: string) => void }) {
  const fechaSet = useMemo(() => new Set(fechas), [fechas])

  const initMes = () => {
    const primera = fechas[0]
    if (!primera) { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() } }
    const [y, m] = primera.split('-').map(Number)
    return { year: y, month: m - 1 }
  }

  const [mes, setMes] = useState(initMes)

  const primerDia = new Date(mes.year, mes.month, 1).getDay()
  const diasEnMes = new Date(mes.year, mes.month + 1, 0).getDate()
  const todayStr = today()

  const celdas: (string | null)[] = [
    ...Array(primerDia).fill(null),
    ...Array.from({ length: diasEnMes }, (_, i) => {
      const d = String(i + 1).padStart(2, '0')
      const m = String(mes.month + 1).padStart(2, '0')
      return `${mes.year}-${m}-${d}`
    }),
  ]

  const prevMes = () => setMes(({ year, month }) => month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 })
  const nextMes = () => setMes(({ year, month }) => month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 })

  const hayEntregasEnMes = celdas.some((f) => f && fechaSet.has(f))

  return (
    <div className="bg-card border border-border rounded-2xl p-3 shadow-sm">
      {/* Header mes */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMes} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground font-bold text-lg">‹</button>
        <div className="text-sm font-bold text-card-foreground">{MESES[mes.month]} {mes.year}</div>
        <button onClick={nextMes} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground font-bold text-lg">›</button>
      </div>

      {/* Días de la semana */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DIAS.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* Celdas */}
      <div className="grid grid-cols-7 gap-0.5">
        {celdas.map((f, i) => {
          if (!f) return <div key={i} />
          const esEntrega = fechaSet.has(f)
          const seleccionado = f === value
          const esHoy = f === todayStr
          return (
            <button
              key={f}
              disabled={!esEntrega}
              onClick={() => onChange(f)}
              className={`aspect-square rounded-lg flex items-center justify-center text-xs font-medium transition-all ${
                seleccionado
                  ? 'bg-primary text-primary-foreground font-bold shadow-sm'
                  : esEntrega
                    ? 'bg-primary/15 text-primary hover:bg-primary/25 font-bold cursor-pointer'
                    : 'text-muted-foreground/40 cursor-default'
              } ${esHoy && !seleccionado ? 'ring-1 ring-inset ring-primary/60' : ''}`}
            >
              {Number(f.slice(-2))}
            </button>
          )
        })}
      </div>

      {!hayEntregasEnMes && (
        <p className="text-center text-[11px] text-muted-foreground mt-2">No deliveries this month</p>
      )}

      {value && (
        <div className="mt-3 pt-2 border-t border-border text-center text-xs font-semibold text-primary">
          🚚 {fdate(value)}
        </div>
      )}
    </div>
  )
}

export default function NuevaOrdenPage() {
  const params = useParams()
  const router = useRouter()
  const clienteId = params.id as string

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [fecha, setFecha] = useState('')
  // Fecha tocada en el calendario, pendiente de confirmar con "Accept"
  const [fechaTemp, setFechaTemp] = useState('')
  const [fechasEntrega, setFechasEntrega] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string>('')
  // cantidades por producto: { [prodId]: qty }
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  // precio con descuento manual por producto: { [prodId]: precioFinal }
  const [descuentos, setDescuentos] = useState<Record<string, number>>({})
  // lista de precios asignada al cliente: { [prodId]: precio especial }
  const [listaPrecios, setListaPrecios] = useState<Record<string, number>>({})
  const [listaNombre, setListaNombre] = useState('')
  const [editandoDescuento, setEditandoDescuento] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [columnas, setColumnas] = useState<2 | 3>(() => {
    if (typeof window === 'undefined') return 2
    return (Number(localStorage.getItem('ph_columnas_orden')) as 2 | 3) || 2
  })
  const [almacen, setAlmacen] = useState<'palmhills' | 'castillo' | 'all'>('all')
  const [sortMode, setSortMode] = useState<'sku' | 'nom'>('sku')
  const [readOnly, setReadOnly] = useState(false)

  // Draft: persist order across app closes
  const DRAFT_KEY = `ph_draft_orden_${clienteId}`
  const [initialized, setInitialized] = useState(false)
  const [showDraftModal, setShowDraftModal] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<{ cantidades: Record<string, number>; descuentos: Record<string, number>; fecha: string } | null>(null)

  // Auto-save draft whenever order state changes (after initial load)
  // initialized is intentionally excluded from deps — we only want to run when
  // the user actually changes the order, not when initialization flips the flag.
  useEffect(() => {
    if (!initialized) return
    if (Object.keys(cantidades).length === 0) {
      localStorage.removeItem(DRAFT_KEY)
    } else {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ cantidades, descuentos, fecha }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cantidades, descuentos, fecha])

  const resumeDraft = () => {
    if (pendingDraft) {
      setCantidades(pendingDraft.cantidades)
      setDescuentos(pendingDraft.descuentos || {})
      if (pendingDraft.fecha) setFecha(pendingDraft.fecha)
    }
    setShowDraftModal(false)
    setPendingDraft(null)
  }

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY)
    setShowDraftModal(false)
    setPendingDraft(null)
  }

  const cambiarColumnas = (n: 2 | 3) => {
    setColumnas(n)
    localStorage.setItem('ph_columnas_orden', String(n))
  }

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: userData } = await supabase.auth.getUser()
        if (userData.user?.user_metadata?.role === 'visitante') {
          setReadOnly(true)
          setLoading(false)
          return
        }
        const { data: c } = await supabase.from('clientes').select('id, nom, lista_precio_id').eq('id', clienteId).single()
        if (c) setCliente(c as Cliente)
        // Lista de precios del cliente: sus precios pisan el precio base del
        // inventario en toda la orden (el descuento manual sigue por encima).
        if (c?.lista_precio_id) {
          const { data: lp } = await supabase
            .from('listas_precios')
            .select('nombre, precios')
            .eq('id', c.lista_precio_id)
            .single()
          if (lp) {
            setListaPrecios((lp.precios as Record<string, number>) || {})
            setListaNombre(lp.nombre as string)
          }
        }
        const { data: eventos } = await supabase
          .from('eventos_calendario')
          .select('fecha')
          .eq('tipo', 'delivery')
          .gte('fecha', today())
          .order('fecha')
        const fechas = Array.from(new Set((eventos || []).map((e) => e.fecha as string)))
        setFechasEntrega(fechas)
        // Datos livianos primero (sin foto) para no esperar varios MB de imagenes.
        // Supabase/PostgREST limita cada respuesta (db-max-rows, normalmente 1000),
        // por lo que paginamos con .range() para traer TODOS los productos.
        const PAGE = 1000
        let desde = 0
        let todos: Producto[] = []
        for (;;) {
          const { data: lote, error: loteError } = await supabase
            .from('productos')
            .select('id, nom, sku, barcode, fabricante, etiquetas, precio, stock, min, reservado, almacen')
            .order('nom')
            // Desempate por id: con nombres repetidos el orden entre paginas
            // no es estable y .range() puede duplicar o saltarse filas.
            .order('id')
            .range(desde, desde + PAGE - 1)
          if (loteError) {
            console.log('[v0] Error cargando productos:', loteError.message)
            break
          }
          if (!lote || lote.length === 0) break
          todos = todos.concat(lote as Producto[])
          if (lote.length < PAGE) break
          desde += PAGE
        }
        const p = todos
        if (p.length) setProductos(p)
        setLoading(false)
        // Check for existing draft
        const savedDraft = localStorage.getItem(DRAFT_KEY)
        if (savedDraft) {
          try {
            const draft = JSON.parse(savedDraft)
            if (Object.keys(draft.cantidades || {}).length > 0) {
              setPendingDraft(draft)
              setShowDraftModal(true)
            }
          } catch {}
        }
        setInitialized(true)
        // Fotos en segundo plano, en lotes pequeños para evitar el límite de 10MB de Supabase
        const ids = (p || []).map((r) => r.id)
        const CHUNK = 5
        for (let i = 0; i < ids.length; i += CHUNK) {
          const lote = ids.slice(i, i + CHUNK)
          try {
            const { data: fotos, error: fotoError } = await supabase.from('productos').select('id, foto').in('id', lote)
            if (fotoError) { console.error('[v0] Error cargando fotos:', fotoError.message); continue }
            if (!fotos) continue
            const fotoMap = new Map(fotos.map((r) => [r.id, r.foto]))
            setProductos((prev) => prev.map((prod) => (fotoMap.has(prod.id) ? { ...prod, foto: fotoMap.get(prod.id) } : prod)))
          } catch (err) { console.error('[v0] Error inesperado en fotos:', err) }
        }
      } catch (error) {
        console.log('[v0] Error loading nueva orden:', error)
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
    let list = productos.filter((p) => {
      const matchAlmacen = almacen === 'all' || (p.almacen || 'palmhills') === almacen
      const matchTag = !tagFilter || (p.etiquetas || []).includes(tagFilter)
      return matchAlmacen && matchTag
    })
    if (search.trim()) {
      list = flexibleSearch(
        list,
        search,
        (p) => [p.nom, p.sku, p.barcode, ...(p.etiquetas || [])].filter(Boolean).join(' '),
        (p) => p.nom
      )
    }
    // El orden elegido (SKU o A-Z) se respeta SIEMPRE, tambien sobre los
    // resultados de una busqueda — no se deja el orden de relevancia.
    if (sortMode === 'nom') {
      return list.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'en', { sensitivity: 'base' }))
    }
    // SKU A-Z (los sin SKU van al final)
    return list.slice().sort((a, b) => {
      const skuA = (a.sku || '').trim()
      const skuB = (b.sku || '').trim()
      if (!skuA && skuB) return 1
      if (skuA && !skuB) return -1
      return skuA.localeCompare(skuB, 'en', { numeric: true }) || a.nom.localeCompare(b.nom, 'en')
    })
  }, [productos, search, tagFilter, almacen, sortMode])

  const disponible = (p: Producto) => Number(p.stock || 0) - Number(p.reservado || 0)

  // Precio base para ESTE cliente: el de su lista de precios si el producto
  // esta en ella, si no el precio normal del inventario.
  const precioBase = (p: Producto) => listaPrecios[p.id] ?? p.precio

  const precioEfectivo = (p: Producto) => descuentos[p.id] ?? precioBase(p)

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
      alert('Add at least one product')
      return
    }
    if (!fecha) {
      alert('Select a delivery date')
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
        // El precio de lista del cliente ES su precio base: no se muestra
        // como descuento en la factura. Solo el ajuste manual queda como precioFinal.
        precio: precioBase(p),
        precioFinal: precioEfectivo(p),
        // Precio de catalogo puro (sin lista): permite que la factura/estimate
        // ofrezcan mostrar el descuento de lista como opcional.
        precioCatalogo: Number(p.precio),
        qty,
        qtyEnviada: qty,
        almacen: p.almacen || 'palmhills',
      }))

      // Siguiente número de orden global (consulta solo el máximo, no toda la tabla)
      const { data: maxRow } = await supabase
        .from('ordenes')
        .select('num')
        .order('num', { ascending: false })
        .limit(1)
      const num = (maxRow && maxRow.length ? Number(maxRow[0].num) || 0 : 0) + 1

      // Insertar orden (pendiente, lista para tomarse desde "Ordenes")
      const { data: orden, error: ordenError } = await supabase
        .from('ordenes')
        .insert({
          cli: clienteId,
          fecha,
          estado: 'Pending',
          total: +total.toFixed(2),
          lineas: lineasDetalle,
          num,
        })
        .select()
        .single()

      if (ordenError) throw ordenError

      // Reservar inventario: reservado += qty para cada producto (Castillo no lleva stock en vivo)
      for (const { p, qty } of seleccionados) {
        if ((p.almacen || 'palmhills') === 'castillo') continue
        const nuevoReservado = Number(p.reservado || 0) + qty
        await supabase.from('productos').update({ reservado: nuevoReservado }).eq('id', p.id)
      }

      localStorage.removeItem(DRAFT_KEY)
      alert(`Order #${num} created. It's pending in Orders.`)
      router.push(`/clientes/${clienteId}`)
    } catch (error) {
      console.log('[v0] Error creating order:', error)
      alert('Error creating the order. Please try again.')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading products...</p>
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-3">
        <p className="text-card-foreground font-medium">You don't have permission to create orders.</p>
        <BackButton fallback={`/clientes/${clienteId}`} />
      </div>
    )
  }

  const fechaLabel = fecha ? fdate(fecha) : ''

  // Sin fecha confirmada: pantalla de seleccion de fecha (sin productos).
  // La fecha tocada queda en fechaTemp y solo se confirma con el boton Accept.
  if (!fecha) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto p-4" style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}>
          <BackButton fallback={`/clientes/${clienteId}`} className="mb-2" />
          <h1 className="text-xl font-bold text-card-foreground">New Order</h1>
          {cliente && <p className="text-sm text-muted-foreground mb-4">{cliente.nom}</p>}
          <p className="text-sm font-semibold text-card-foreground mb-3">Select the delivery day</p>
          {fechasEntrega.length ? (
            <>
              <DeliveryCalendar fechas={fechasEntrega} value={fechaTemp} onChange={setFechaTemp} />
              <button
                onClick={() => fechaTemp && setFecha(fechaTemp)}
                disabled={!fechaTemp}
                className="w-full mt-4 py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-md disabled:opacity-40 active:scale-[0.98] transition-all"
              >
                {fechaTemp ? `Accept · ${fdate(fechaTemp)}` : 'Accept'}
              </button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No delivery days available. Add delivery dates in the Calendar.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header fijo — solo visible cuando ya hay fecha seleccionada */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto p-4" style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}>
          {/* Back con fecha ya confirmada: vuelve al paso del calendario de
              fechas (pantalla anterior del flujo), no al perfil del cliente. */}
          <BackButton onClick={() => { setFechaTemp(fecha); setFecha(''); }} className="mb-2" />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-card-foreground leading-tight">New Order</h1>
              {cliente && (
                <p className="text-sm text-muted-foreground truncate">
                  {cliente.nom}
                  {listaNombre && <span className="ml-1.5 text-xs font-semibold text-[#b09060]">· {listaNombre}</span>}
                </p>
              )}
            </div>
            <button
              onClick={() => { setFechaTemp(fecha); setFecha(''); }}
              className="shrink-0 flex items-center gap-1.5 bg-secondary border border-primary/20 rounded-full px-3 py-1.5 text-xs font-semibold text-secondary-foreground"
            >
              🚚 {fechaLabel}
              <span className="text-muted-foreground font-normal">· Change</span>
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <div className="relative">
              <input
                type="text"
                inputMode="search"
                placeholder="Search by name, SKU or barcode"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                // Al volver al buscador (despues de fijar una cantidad, por
                // ejemplo) todo el texto queda seleccionado: escribir la
                // siguiente busqueda lo reemplaza de inmediato.
                onFocus={(e) => e.target.select()}
                autoComplete="off"
                autoCorrect="off"
                className="w-full px-3 py-2 pr-8 rounded-lg border border-input bg-background text-card-foreground text-base"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-card-foreground text-xl leading-none"
                >
                  ×
                </button>
              )}
            </div>
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
                  All
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
        {/* Fila de controles: tres grupos segmentados con exactamente el mismo
            alto, tipografia y radios, para que se vean alineados y simetricos. */}
        {(() => {
          const seg = (activo: boolean) =>
            `px-2 h-6 flex items-center rounded-md text-[10px] font-bold whitespace-nowrap transition-all ${
              activo ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`
          const grupo = 'inline-flex items-center shrink-0 bg-white/40 border border-border/60 rounded-lg p-0.5 gap-0.5'
          return (
            <div className="flex items-center justify-between gap-1.5 mb-2.5 overflow-x-auto no-scrollbar">
              <div className={grupo}>
                <button onClick={() => setAlmacen('all')} className={seg(almacen === 'all')}>All</button>
                <button onClick={() => setAlmacen('palmhills')} className={seg(almacen === 'palmhills')}>🌴 Palm Hills</button>
                <button onClick={() => setAlmacen('castillo')} className={seg(almacen === 'castillo')}>🏰 Castillo</button>
              </div>
              <div className={grupo}>
                <button onClick={() => setSortMode('sku')} aria-label="Sort by SKU" className={seg(sortMode === 'sku')}>SKU</button>
                <button onClick={() => setSortMode('nom')} aria-label="Sort by name" className={seg(sortMode === 'nom')}>A–Z</button>
              </div>
              <div className={grupo}>
                <button onClick={() => cambiarColumnas(2)} aria-label="2 columns" className={seg(columnas === 2)}>▥2</button>
                <button onClick={() => cambiarColumnas(3)} aria-label="3 columns" className={seg(columnas === 3)}>▦3</button>
              </div>
            </div>
          )
        })()}
        <div className={`grid gap-2.5 ${columnas === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {filtered.length ? (
            filtered.map((p) => {
              const esCastillo = (p.almacen || 'palmhills') === 'castillo'
              const disp = disponible(p)
              const qty = cantidades[p.id] || 0
              const excede = !esCastillo && qty > disp
              const min = Number(p.min || 5)
              const stockEstado = disp <= 0 ? 'Out of stock' : disp <= min ? 'Low stock' : 'In Stock'
              const estadoColor =
                stockEstado === 'Out of stock'
                  ? 'bg-red-100 text-red-800'
                  : stockEstado === 'Low stock'
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
                      <img src={p.foto || "/placeholder.svg"} alt={p.nom} loading="lazy" className="w-full h-full object-contain" />
                    ) : (
                      p.icon || '📦'
                    )}
                  </div>
                  <div className="text-xs font-bold mb-1 text-card-foreground leading-snug break-words min-h-[2.25rem] uppercase">
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
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold inline-flex mb-1 self-start ${
                      esCastillo ? 'bg-[#f5eee2] text-[#a3814e]' : estadoColor
                    }`}
                  >
                    {esCastillo ? '🏰 CASTILLO' : stockEstado}
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    {descuentos[p.id] !== undefined && descuentos[p.id] !== precioBase(p) ? (
                      <>
                        <span className="text-xs text-muted-foreground line-through">{fmt(precioBase(p))}</span>
                        <span className="text-sm font-bold text-primary">{fmt(descuentos[p.id])}</span>
                      </>
                    ) : listaPrecios[p.id] !== undefined ? (
                      // Precio de la lista del cliente: en dorado (firma de la app)
                      <span className="text-sm font-bold text-[#b09060]">{fmt(precioBase(p))}</span>
                    ) : (
                      <span className="text-sm font-bold text-secondary-foreground">{fmt(p.precio)}</span>
                    )}
                  </div>
                  {!esCastillo && (
                    <div className={`text-xs mt-0.5 ${disp <= 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      Available: {disp} units
                    </div>
                  )}

                  {/* Aplicar descuento */}
                  {editandoDescuento === p.id ? (
                    <div className="mt-2 pt-2 border-t border-border">
                      <label className="text-[10px] text-muted-foreground block mb-1">Price for this order</label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]*[.,]?[0-9]*"
                          autoComplete="off"
                          defaultValue={descuentos[p.id] ?? precioBase(p)}
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
                      🏷️ Apply discount
                    </button>
                  )}
                  {descuentos[p.id] !== undefined && (
                    <button
                      onClick={() => quitarDescuento(p.id)}
                      className="mt-1 text-[11px] text-destructive underline self-start"
                    >
                      Remove discount
                    </button>
                  )}

                  {/* Casilla de cantidad */}
                  <div className="mt-2 pt-2 border-t border-border">
                    <label className="text-[10px] text-muted-foreground block mb-1">Quantity</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      placeholder="0"
                      value={qty || ''}
                      onChange={(e) => setQty(p.id, Number(e.target.value))}
                      className={`w-full px-2 py-2 rounded-lg border bg-background text-card-foreground text-base text-center font-bold ${
                        excede ? 'border-destructive text-destructive' : 'border-input'
                      }`}
                    />
                    {excede && (
                      <p className="text-[10px] text-destructive mt-1">Exceeds available stock ({disp})</p>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="col-span-2 text-center text-muted-foreground py-10 text-sm">
              No products found
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
                {seleccionados.length} products · {totalUnidades} units
              </p>
              <p className="text-xl font-bold text-primary truncate">{fmt(total)}</p>
            </div>
            <button
              onClick={() => setReviewing(true)}
              disabled={seleccionados.length === 0}
              className="shrink-0 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 shadow-md"
            >
              Review order
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
                <h3 className="text-lg font-bold text-card-foreground">Review Order</h3>
                <button onClick={() => setReviewing(false)} className="text-muted-foreground text-2xl leading-none">
                  ×
                </button>
              </div>

              <p className="text-sm text-muted-foreground mb-1">
                Client: <span className="font-medium text-card-foreground">{cliente?.nom}</span>
              </p>
              <p className="text-sm text-muted-foreground mb-4">Date: {fdate(fecha)}</p>

              <div className="space-y-2 mb-4">
                {seleccionados.map(({ p, qty }) => {
                  const esCastillo = (p.almacen || 'palmhills') === 'castillo'
                  const disp = disponible(p)
                  const excede = !esCastillo && qty > disp
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
                        <p className="text-sm font-medium text-card-foreground break-words uppercase">{p.nom}</p>
                        <p className="text-xs text-muted-foreground">
                          {qty} × {fmt(precioEfectivo(p))}
                          {descuentos[p.id] !== undefined && descuentos[p.id] !== precioBase(p) && (
                            <span className="ml-1 line-through text-muted-foreground/70">{fmt(precioBase(p))}</span>
                          )}
                        </p>
                        {excede && <p className="text-[10px] text-destructive">Exceeds available ({disp})</p>}
                      </div>
                      <p className="text-sm font-bold text-card-foreground">{fmt(precioEfectivo(p) * qty)}</p>
                    </div>
                  )
                })}
              </div>

              <div className="flex justify-between items-center mb-4 pt-3 border-t border-border">
                <span className="text-sm text-muted-foreground">Total ({totalUnidades} units)</span>
                <span className="text-xl font-bold text-primary">{fmt(total)}</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setReviewing(false)}
                  className="flex-1 px-4 py-3 rounded-xl bg-secondary text-secondary-foreground font-bold"
                >
                  Keep editing
                </button>
                <button
                  onClick={handleEnviar}
                  disabled={saving}
                  className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-60"
                >
                  {saving ? 'Submitting...' : 'Submit order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Draft resume modal */}
      {showDraftModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm p-5">
            <div className="text-2xl mb-2 text-center">📋</div>
            <h3 className="text-base font-bold text-card-foreground text-center mb-1">Draft order found</h3>
            <p className="text-sm text-muted-foreground text-center mb-5">
              You have a saved draft for {cliente?.nom}. Would you like to continue where you left off?
            </p>
            <div className="flex gap-2">
              <button
                onClick={discardDraft}
                className="flex-1 px-4 py-2.5 rounded-full text-sm font-medium bg-secondary text-secondary-foreground"
              >
                Start fresh
              </button>
              <button
                onClick={resumeDraft}
                className="flex-1 px-4 py-2.5 rounded-full text-sm font-bold bg-primary text-primary-foreground"
              >
                Resume draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
