'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { flexibleSearch } from '@/lib/search'
import { BackButton } from '@/components/back-button'
import { MoneyInput } from '@/components/ui/money-input'
import { type Almacen, almacenInfo, almacenPrincipal } from '@/lib/almacenes'
import { idbOpen, idbGetAll, idbPut, type FotoCache } from '@/lib/foto-cache'

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
  cajas?: number
  reservado?: number
  icon?: string
  foto?: string | null
  foto_v?: number
  almacen?: string
  liquidacion?: boolean
  precio_liquidacion?: number | null
}

interface LineaHist {
  prodNom: string
  sku?: string
  qty: number
  precio: number
  almacen?: string
}

interface FacturaHist {
  cli: string
  fecha: string
  lineas: LineaHist[]
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

// Fecha ISO -> "3 wks ago" / "5 mo ago". Para el historial del cliente en la
// tarjeta: importa mas "hace cuanto" que la fecha exacta.
const haceTexto = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dias = Math.floor((Date.now() - new Date(y, (m || 1) - 1, d || 1).getTime()) / 86400000)
  if (dias <= 0) return 'today'
  if (dias === 1) return 'yesterday'
  if (dias < 14) return `${dias}d ago`
  if (dias < 60) return `${Math.round(dias / 7)} wks ago`
  return `${Math.round(dias / 30)} mo ago`
}

// Las lineas de factura no guardan prodId: se resuelve por SKU+almacen y, si no,
// por nombre (misma convencion que el COGS del P&L).
const claveSku = (sku?: string, almacen?: string) =>
  `${(sku || '').trim().toLowerCase()}|${almacen || 'palmhills'}`
const claveNom = (nom?: string) => (nom || '').trim().toLowerCase()

const DIAS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MESES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const PAGE_SIZE = 60
const FOTO_CHUNK = 10
// Cuantas sugerencias se muestran y cuantas de cada motivo como maximo.
const SUG_MAX = 8
const SUG_MAX_CLEARANCE = 2
const SUG_MAX_SLOW = 2

type MotivoSug = 'usual' | 'clearance' | 'slow'
interface Sugerencia {
  p: Producto
  motivo: MotivoSug
  detalle: string
  qtySugerida: number
}

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
    <div className="bg-card border border-border rounded-3xl p-3 shadow-sm">
      {/* Header mes */}
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-1 bg-muted rounded-full p-1 mx-auto">
          <button onClick={prevMes} className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground font-bold text-lg active:bg-card/70">‹</button>
          <div className="text-sm font-extrabold text-card-foreground tracking-tight px-1 min-w-[100px] text-center">{MESES[mes.month]} {mes.year}</div>
          <button onClick={nextMes} className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground font-bold text-lg active:bg-card/70">›</button>
        </div>
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
          const celdaBase = 'aspect-square flex items-center justify-center text-xs font-medium transition-all'
          const celdaClase = seleccionado
            ? `${celdaBase} rounded-2xl bg-primary text-primary-foreground font-bold shadow-sm`
            : esHoy
              ? `${celdaBase} rounded-full bg-primary text-primary-foreground font-extrabold ${esEntrega ? "cursor-pointer" : "cursor-default"}`
              : esEntrega
                ? `${celdaBase} rounded-2xl bg-[#22c55e]/30 text-[#15803d] hover:bg-[#22c55e]/40 font-bold cursor-pointer`
                : `${celdaBase} rounded-2xl text-muted-foreground/40 cursor-default`
          return (
            <button
              key={f}
              disabled={!esEntrega}
              onClick={() => onChange(f)}
              className={celdaClase}
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
  const [facturasHist, setFacturasHist] = useState<FacturaHist[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [fecha, setFecha] = useState('')
  // Fecha tocada en el calendario, pendiente de confirmar con "Accept"
  const [fechaTemp, setFechaTemp] = useState('')
  const [fechasEntrega, setFechasEntrega] = useState<string[]>([])
  // searchInput es lo que se ve mientras escribe; search es el valor con retardo
  // que dispara el filtrado (la busqueda fonetica recorre 2400+ productos).
  const [searchInput, setSearchInput] = useState('')
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
  const [vista, setVista] = useState<'2' | '3' | 'list'>(() => {
    if (typeof window === 'undefined') return '2'
    const v = localStorage.getItem('ph_columnas_orden')
    return v === '3' || v === 'list' ? v : '2'
  })
  const [almacen, setAlmacen] = useState<string>('all')
  const [almacenes, setAlmacenes] = useState<Almacen[]>([])
  const [sortMode, setSortMode] = useState<'sku' | 'nom'>('sku')
  const [readOnly, setReadOnly] = useState(false)
  const [page, setPage] = useState(1)
  // Sugerencias: abiertas al entrar, se pliegan solas al arrancar el pedido.
  const [sugAbierto, setSugAbierto] = useState(true)
  const autoColapsado = useRef(false)
  // Foto a pantalla completa: indice dentro de la lista visible.
  const [zoomIdx, setZoomIdx] = useState<number | null>(null)
  const touchX = useRef(0)

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

  // Retardo del buscador: filtrar en cada tecla sobre todo el catalogo trababa
  // la escritura en el telefono.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 150)
    return () => clearTimeout(t)
  }, [searchInput])

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

  const cambiarVista = (v: '2' | '3' | 'list') => {
    setVista(v)
    localStorage.setItem('ph_columnas_orden', v)
  }

  // ── Fotos: cache en el dispositivo (IndexedDB) ──────────────────────────
  // Las fotos son base64 dentro de la tabla (~160MB en total). Esta pantalla
  // las re-descargaba TODAS en cada apertura; ahora comparte el mismo cache que
  // el Home y solo baja las que no tiene o cuya version (foto_v) cambio.
  const idbRef = useRef<IDBDatabase | null>(null)
  const pendientesRef = useRef<Map<string, number>>(new Map())
  const drenandoRef = useRef(false)

  const traerFotos = useCallback(async (lote: [string, number][]) => {
    if (!lote.length) return
    try {
      const supabase = createClient()
      const { data, error } = await supabase.from('productos').select('id, foto').in('id', lote.map(([id]) => id))
      if (error || !data) return
      const versiones = new Map(lote)
      const fotoMap = new Map(data.map((r) => [r.id as string, (r.foto as string | null) ?? null]))
      setProductos((prev) => prev.map((p) => (fotoMap.has(p.id) ? { ...p, foto: fotoMap.get(p.id)! } : p)))
      if (idbRef.current) {
        fotoMap.forEach((foto, id) => {
          // Se cachea tambien foto=null: marca "este producto no tiene foto" y
          // evita volver a preguntarlo en cada apertura.
          idbPut(idbRef.current!, 'prod', id, { foto, v: versiones.get(id) ?? 1 })
        })
      }
    } catch (err) {
      console.error('[v0] Error cargando fotos:', err)
    }
  }, [])

  // Un solo consumidor de la cola: cada vuelta saca las primeras FOTO_CHUNK
  // pendientes (las que se ven en pantalla se mueven al frente con priorizar).
  const drenarFotos = useCallback(async () => {
    if (drenandoRef.current) return
    drenandoRef.current = true
    try {
      while (pendientesRef.current.size) {
        const lote = [...pendientesRef.current.entries()].slice(0, FOTO_CHUNK)
        lote.forEach(([id]) => pendientesRef.current.delete(id))
        await traerFotos(lote)
      }
    } finally {
      drenandoRef.current = false
    }
  }, [traerFotos])

  const priorizarFotos = useCallback((ids: string[]) => {
    const m = pendientesRef.current
    if (!m.size) return
    const frente = ids.filter((id) => m.has(id))
    if (!frente.length) return
    const nuevo = new Map<string, number>()
    frente.forEach((id) => nuevo.set(id, m.get(id)!))
    m.forEach((v, id) => { if (!nuevo.has(id)) nuevo.set(id, v) })
    pendientesRef.current = nuevo
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: userData } = await supabase.auth.getUser()
        if (userData.user?.app_metadata?.role === 'visitante') {
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
        // Se filtra "delivery" en el cliente (no via .contains()) porque el
        // operador jsonb-contains de PostgREST no siempre resuelve bien un
        // array de strings sobre esta columna — mas simple y confiable traer
        // los eventos futuros (la tabla es chica) y filtrar aqui.
        const { data: eventos, error: eventosErr } = await supabase
          .from('eventos_calendario')
          .select('fecha, tipos')
          .gte('fecha', today())
          .order('fecha')
        if (eventosErr) console.error('[v0] Error cargando fechas de entrega:', eventosErr.message)
        const fechas = Array.from(
          new Set(
            (eventos || [])
              .filter((e) => Array.isArray(e.tipos) && e.tipos.includes('delivery'))
              .map((e) => e.fecha as string)
          )
        )
        setFechasEntrega(fechas)
        const { data: alm } = await supabase.from('almacenes').select('*').order('orden')
        if (alm) setAlmacenes(alm as Almacen[])
        // Datos livianos primero (sin foto) para no esperar varios MB de imagenes.
        // Supabase/PostgREST limita cada respuesta (db-max-rows, normalmente 1000),
        // por lo que paginamos con .range() para traer TODOS los productos.
        const PAGE = 1000
        let desde = 0
        let todos: Producto[] = []
        for (;;) {
          const { data: lote, error: loteError } = await supabase
            .from('productos')
            .select('id, nom, sku, barcode, fabricante, etiquetas, precio, stock, min, cajas, reservado, almacen, foto_v, liquidacion, precio_liquidacion')
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

        // Historial de facturas (ultimo ano): alimenta las sugerencias y el
        // "lo compro antes" de cada tarjeta. Son pocas filas y solo se piden
        // las 3 columnas necesarias.
        const haceUnAno = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
        const { data: fact } = await supabase
          .from('facturas')
          .select('cli, fecha, lineas')
          .gte('fecha', haceUnAno)
        if (fact) {
          setFacturasHist(
            (fact as FacturaHist[]).map((f) => ({ ...f, lineas: Array.isArray(f.lineas) ? f.lineas : [] }))
          )
        }

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

        // Fotos: primero las cacheadas (instantaneo, sin red), despues solo las
        // que faltan o cambiaron de version.
        if (!idbRef.current) idbRef.current = await idbOpen()
        let cache = new Map<string, FotoCache>()
        if (idbRef.current) cache = await idbGetAll(idbRef.current, 'prod')
        if (cache.size) {
          setProductos((prev) => prev.map((pd) => {
            const c = cache.get(pd.id)
            return c && c.foto ? { ...pd, foto: c.foto } : pd
          }))
        }
        const pendientes = new Map<string, number>()
        p.forEach((r) => {
          const c = cache.get(r.id)
          if (!c || c.v !== (r.foto_v ?? 1)) pendientes.set(r.id, r.foto_v ?? 1)
        })
        pendientesRef.current = pendientes
        drenarFotos().catch(() => {})
      } catch (error) {
        console.log('[v0] Error loading nueva orden:', error)
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    productos.forEach((p) => (p.etiquetas || []).forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [productos])

  const prodPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])

  // Resolucion linea de factura -> producto del inventario
  const indiceProductos = useMemo(() => {
    const porSku = new Map<string, Producto>()
    const porNom = new Map<string, Producto>()
    productos.forEach((p) => {
      if (p.sku) porSku.set(claveSku(p.sku, p.almacen || 'palmhills'), p)
      porNom.set(claveNom(p.nom), p)
    })
    return { porSku, porNom }
  }, [productos])

  const resolverLinea = useCallback(
    (l: LineaHist): Producto | undefined =>
      (l.sku ? indiceProductos.porSku.get(claveSku(l.sku, l.almacen)) : undefined) ||
      indiceProductos.porNom.get(claveNom(l.prodNom)),
    [indiceProductos],
  )

  // Historial de ESTE cliente por producto: cuantas veces lo compro, cuanto
  // suele llevar y cuando fue la ultima vez.
  const historialCliente = useMemo(() => {
    const m = new Map<string, { veces: number; qty: number; ultima: string; ultimaQty: number; ultimoPrecio: number }>()
    if (!cliente) return m
    for (const f of facturasHist) {
      if (f.cli !== cliente.nom) continue
      for (const l of f.lineas) {
        const p = resolverLinea(l)
        if (!p) continue
        const prev = m.get(p.id)
        const qty = Number(l.qty) || 0
        if (!prev) {
          m.set(p.id, { veces: 1, qty, ultima: f.fecha, ultimaQty: qty, ultimoPrecio: Number(l.precio) || 0 })
        } else {
          prev.veces += 1
          prev.qty += qty
          if (f.fecha > prev.ultima) {
            prev.ultima = f.fecha
            prev.ultimaQty = qty
            prev.ultimoPrecio = Number(l.precio) || 0
          }
        }
      }
    }
    return m
  }, [facturasHist, cliente, resolverLinea])

  // Productos con alguna venta (a cualquier cliente) en los ultimos 90 dias:
  // lo que NO esta aqui y tiene inventario es venta lenta.
  const vendidos90 = useMemo(() => {
    const s = new Set<string>()
    const corte = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
    for (const f of facturasHist) {
      if (f.fecha < corte) continue
      for (const l of f.lineas) {
        const p = resolverLinea(l)
        if (p) s.add(p.id)
      }
    }
    return s
  }, [facturasHist, resolverLinea])

  const disponible = (p: Producto) => Number(p.stock || 0) - Number(p.reservado || 0)

  // Precio base para ESTE cliente: el de su lista de precios si el producto
  // esta en ella, si no el precio normal del inventario.
  const precioBase = useCallback((p: Producto) => listaPrecios[p.id] ?? p.precio, [listaPrecios])

  const precioEfectivo = (p: Producto) => descuentos[p.id] ?? precioBase(p)

  // Precio de liquidacion solo si mejora lo que ya le tocaba al cliente.
  const precioLiquidacion = useCallback(
    (p: Producto) => {
      const pl = Number(p.precio_liquidacion) || 0
      return p.liquidacion && pl > 0 && pl < precioBase(p) ? pl : null
    },
    [precioBase],
  )

  const puedeVender = useCallback(
    (p: Producto) => {
      const info = almacenInfo(almacenes, p.almacen || almacenPrincipal(almacenes))
      return !info.lleva_stock || disponible(p) > 0
    },
    [almacenes],
  )

  // ── Sugerencias ────────────────────────────────────────────────────────
  // Mezcla pedida: lo que este cliente compra seguido (lo que mas cuesta que
  // se escape), liquidacion, y venta lenta con inventario parado. El orden se
  // calcula sin mirar `cantidades` para que la fila no se reordene sola
  // mientras se toma el pedido; lo ya agregado se filtra al dibujar.
  const sugerencias = useMemo<Sugerencia[]>(() => {
    if (!productos.length) return []
    const usados = new Set<string>()

    const usual: Sugerencia[] = [...historialCliente.entries()]
      .map(([id, h]) => ({ id, h }))
      .filter(({ id }) => {
        const p = prodPorId.get(id)
        return !!p && puedeVender(p)
      })
      .sort((a, b) => b.h.veces - a.h.veces || (a.h.ultima < b.h.ultima ? 1 : -1))
      .map(({ id, h }) => {
        const p = prodPorId.get(id)!
        return {
          p,
          motivo: 'usual' as const,
          detalle: `Bought ${h.veces}× · ${haceTexto(h.ultima)}`,
          qtySugerida: Math.max(1, Math.round(h.qty / h.veces)),
        }
      })

    const clearance: Sugerencia[] = productos
      .filter((p) => p.liquidacion && puedeVender(p))
      .sort((a, b) => Number(b.stock || 0) * b.precio - Number(a.stock || 0) * a.precio)
      .map((p) => {
        const pl = precioLiquidacion(p)
        return {
          p,
          motivo: 'clearance' as const,
          detalle: pl ? `${fmt(precioBase(p))} → ${fmt(pl)}` : 'Clearance',
          qtySugerida: 1,
        }
      })

    const slow: Sugerencia[] = productos
      .filter((p) => {
        if (vendidos90.has(p.id) || p.liquidacion) return false
        const info = almacenInfo(almacenes, p.almacen || almacenPrincipal(almacenes))
        return info.lleva_stock && disponible(p) > 0
      })
      .sort((a, b) => Number(b.stock || 0) * b.precio - Number(a.stock || 0) * a.precio)
      .map((p) => ({
        p,
        motivo: 'slow' as const,
        detalle: `${disponible(p)} in stock · no sales 90d`,
        qtySugerida: 1,
      }))

    const salida: Sugerencia[] = []
    const empujar = (lista: Sugerencia[], max: number) => {
      for (const s of lista) {
        if (salida.length >= SUG_MAX || max <= 0) break
        if (usados.has(s.p.id)) continue
        usados.add(s.p.id)
        salida.push(s)
        max--
      }
    }
    // Primero lo que el cliente ya compra (deja sitio a los otros dos motivos),
    // despues liquidacion, despues venta lenta, y lo que sobre se rellena con
    // mas "usual".
    empujar(usual, SUG_MAX - SUG_MAX_CLEARANCE - SUG_MAX_SLOW)
    empujar(clearance, SUG_MAX_CLEARANCE)
    empujar(slow, SUG_MAX_SLOW)
    empujar(usual, SUG_MAX)
    return salida
  }, [productos, historialCliente, prodPorId, vendidos90, almacenes, puedeVender, precioLiquidacion, precioBase])

  const sugerenciasVisibles = useMemo(
    () => sugerencias.filter((s) => !cantidades[s.p.id]),
    [sugerencias, cantidades],
  )

  const conteoSug = useMemo(() => {
    const c = { usual: 0, clearance: 0, slow: 0 }
    sugerenciasVisibles.forEach((s) => { c[s.motivo] += 1 })
    return c
  }, [sugerenciasVisibles])

  const filtered = useMemo(() => {
    let list = productos.filter((p) => {
      const matchAlmacen = almacen === 'all' || (p.almacen || almacenPrincipal(almacenes)) === almacen
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
  }, [productos, search, tagFilter, almacen, sortMode, almacenes])

  // Dibujar 2400 tarjetas de una vez trababa el scroll: se muestra de a PAGE_SIZE.
  const visibles = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page])

  useEffect(() => { setPage(1) }, [search, tagFilter, almacen, sortMode])

  // Las fotos de lo que se esta viendo se piden antes que el resto del catalogo.
  useEffect(() => {
    if (!visibles.length) return
    priorizarFotos(visibles.map((p) => p.id))
    drenarFotos().catch(() => {})
  }, [visibles, priorizarFotos, drenarFotos])

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

  const colapsarSugerencias = () => {
    if (autoColapsado.current) return
    autoColapsado.current = true
    setSugAbierto(false)
  }

  const setQty = (prodId: string, qty: number) => {
    const entraAhora = qty > 0 && !cantidades[prodId]
    setCantidades((prev) => {
      const next = { ...prev }
      if (!qty || qty <= 0) delete next[prodId]
      else next[prodId] = qty
      return next
    })
    if (!entraAhora) return
    // Al entrar el producto a la orden: si esta en liquidacion, su precio
    // especial se aplica solo (sin pisar un ajuste manual ya hecho).
    const p = prodPorId.get(prodId)
    const pl = p ? precioLiquidacion(p) : null
    if (pl != null) setDescuentos((d) => (d[prodId] === undefined ? { ...d, [prodId]: pl } : d))
    colapsarSugerencias()
  }

  const agregarSugerencia = (s: Sugerencia) => {
    // Agregar DESDE las sugerencias no las cierra: si las esta usando, se queda
    // ahi. El auto-colapso se reserva para cuando se va al buscador/catalogo.
    autoColapsado.current = true
    setQty(s.p.id, (cantidades[s.p.id] || 0) + s.qtySugerida)
  }

  const seleccionados = useMemo(
    () =>
      Object.entries(cantidades)
        .map(([prodId, qty]) => {
          const p = prodPorId.get(prodId)
          return p ? { p, qty } : null
        })
        .filter(Boolean) as { p: Producto; qty: number }[],
    [cantidades, prodPorId],
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
        almacen: p.almacen || almacenPrincipal(almacenes),
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

      // Reservar inventario: reservado += qty para cada producto (solo en almacenes con lleva_stock=true)
      for (const { p, qty } of seleccionados) {
        if (!almacenInfo(almacenes, p.almacen || almacenPrincipal(almacenes)).lleva_stock) continue
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

  const MOTIVO_ESTILO: Record<MotivoSug, { label: string; clase: string }> = {
    usual: { label: 'Usual', clase: 'bg-[#e4efe0] text-[#3d6132]' },
    clearance: { label: 'Clearance', clase: 'bg-[#f5eee2] text-[#a3814e]' },
    slow: { label: 'Slow', clase: 'bg-[#fdf0dc] text-[#8a6420]' },
  }

  // Foto miniatura compartida por la grilla y la lista compacta: al tocarla se
  // abre a pantalla completa para enseñarsela al cliente. Es una funcion que
  // devuelve JSX, NO un componente declarado aqui adentro: un componente nuevo
  // en cada render remontaria todas las <img> base64 y las haria parpadear.
  const renderFoto = (p: Producto, idx: number, className: string) => (
    <div
      onClick={() => p.foto && setZoomIdx(idx)}
      className={`${className} bg-white flex items-center justify-center overflow-hidden ${p.foto ? 'cursor-pointer' : ''}`}
    >
      {p.foto ? (
        <img src={p.foto} alt={p.nom} loading="lazy" className="w-full h-full object-contain" />
      ) : (
        <span className="text-2xl">{p.icon || '📦'}</span>
      )}
    </div>
  )

  const zoomProd = zoomIdx != null ? visibles[zoomIdx] : null

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
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                // Al volver al buscador (despues de fijar una cantidad, por
                // ejemplo) todo el texto queda seleccionado: escribir la
                // siguiente busqueda lo reemplaza de inmediato.
                onFocus={(e) => { e.target.select(); colapsarSugerencias(); }}
                autoComplete="off"
                autoCorrect="off"
                className="w-full px-3 py-2 pr-8 rounded-lg border border-input bg-background text-card-foreground text-base"
              />
              {searchInput && (
                <button
                  onClick={() => { setSearchInput(''); setSearch('') }}
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

            {/* Barra de sugerencias: ultima linea del header y justo encima de
                su fila de tarjetas, para que se lean como una sola pieza. Es el
                unico control — abre y cierra la fila. */}
            {sugerenciasVisibles.length > 0 && (
              <button
                onClick={() => {
                  const abrir = !sugAbierto
                  setSugAbierto(abrir)
                  autoColapsado.current = true
                  if (abrir) window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className="flex items-center gap-2 w-full bg-card border border-border rounded-full px-3 py-1.5 text-left"
              >
                <span className="text-xs font-bold text-card-foreground shrink-0">
                  💡 {sugerenciasVisibles.length} suggestion{sugerenciasVisibles.length === 1 ? '' : 's'}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">
                  {[
                    conteoSug.usual && `${conteoSug.usual} usual`,
                    conteoSug.clearance && `${conteoSug.clearance} clearance`,
                    conteoSug.slow && `${conteoSug.slow} slow`,
                  ].filter(Boolean).join(' · ')}
                </span>
                <span className="ml-auto text-muted-foreground text-sm shrink-0">{sugAbierto ? '⌃' : '⌄'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Catálogo de productos */}
      <div className="max-w-2xl mx-auto p-4 pb-44" style={{ paddingBottom: "calc(11rem + env(safe-area-inset-bottom))" }}>
        {/* Sugerencias abiertas: viven al principio del contenido, asi se van
            con el scroll y no le quitan alto fijo al catalogo. */}
        {sugAbierto && sugerenciasVisibles.length > 0 && (
          <div className="mb-3">
            <div
              className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1"
              style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
            >
              {sugerenciasVisibles.map((s) => {
                const pl = precioLiquidacion(s.p)
                const estilo = MOTIVO_ESTILO[s.motivo]
                return (
                  <div
                    key={s.p.id}
                    style={{ scrollSnapAlign: 'start' }}
                    className="relative shrink-0 w-[132px] bg-card border border-border rounded-2xl p-2 flex flex-col gap-1"
                  >
                    <button
                      onClick={() => agregarSugerencia(s)}
                      aria-label={`Add ${s.p.nom}`}
                      className="absolute top-1.5 right-1.5 z-[1] min-w-[26px] h-[26px] px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-sm"
                    >
                      +{s.qtySugerida > 1 ? s.qtySugerida : ''}
                    </button>
                    <div className="w-full aspect-square rounded-xl overflow-hidden bg-white border border-border/60 flex items-center justify-center">
                      {s.p.foto ? (
                        <img src={s.p.foto} alt={s.p.nom} loading="lazy" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-2xl">📦</span>
                      )}
                    </div>
                    <span className={`self-start px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide ${estilo.clase}`}>
                      {estilo.label}
                    </span>
                    <p className="text-[10.5px] font-bold leading-snug uppercase break-words min-h-[2.5em]">{s.p.nom}</p>
                    <p className="text-[9.5px] text-muted-foreground leading-tight break-words">{s.detalle}</p>
                    <p className="mt-auto pt-0.5 text-[13px] font-bold text-card-foreground">
                      {fmt(pl ?? precioBase(s.p))}
                      {pl != null && (
                        <span className="ml-1 text-[10px] font-medium text-muted-foreground line-through">
                          {fmt(precioBase(s.p))}
                        </span>
                      )}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
                {almacenes.filter((a) => a.activo).map((a) => (
                  <button key={a.id} onClick={() => setAlmacen(a.id)} className={seg(almacen === a.id)}>{a.icono} {a.nombre}</button>
                ))}
              </div>
              <div className={grupo}>
                <button onClick={() => setSortMode('sku')} aria-label="Sort by SKU" className={seg(sortMode === 'sku')}>SKU</button>
                <button onClick={() => setSortMode('nom')} aria-label="Sort by name" className={seg(sortMode === 'nom')}>A–Z</button>
              </div>
              <div className={grupo}>
                <button onClick={() => cambiarVista('2')} aria-label="2 columns" className={seg(vista === '2')}>▥2</button>
                <button onClick={() => cambiarVista('3')} aria-label="3 columns" className={seg(vista === '3')}>▦3</button>
                <button onClick={() => cambiarVista('list')} aria-label="List" className={seg(vista === 'list')}>▤</button>
              </div>
            </div>
          )
        })()}

        {vista === 'list' ? (
          /* Lista compacta: una fila por producto, entran el doble en pantalla. */
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {visibles.length ? visibles.map((p, i) => {
              const almInfo = almacenInfo(almacenes, p.almacen || almacenPrincipal(almacenes))
              const disp = disponible(p)
              const qty = cantidades[p.id] || 0
              const excede = almInfo.lleva_stock && qty > disp
              const hist = historialCliente.get(p.id)
              const pl = precioLiquidacion(p)
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2.5 px-2.5 py-2 border-b border-border last:border-b-0 ${qty > 0 ? 'bg-secondary/40' : ''}`}
                >
                  {renderFoto(p, i, 'w-11 h-11 shrink-0 rounded-lg border border-border/60')}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11.5px] font-bold uppercase leading-snug break-words">{p.nom}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {p.sku || '—'}
                      {!almInfo.lleva_stock ? ` · ${almInfo.icono}` : ` · ${disp}u`}
                    </p>
                    {hist && (
                      <p className="text-[9.5px] text-primary/80">
                        Last: {hist.ultimaQty}u @ {fmt(hist.ultimoPrecio)} · {haceTexto(hist.ultima)}
                      </p>
                    )}
                  </div>
                  {editandoDescuento === p.id ? (
                    <MoneyInput
                      value={descuentos[p.id] ?? precioBase(p)}
                      onChange={(n) => setDescuento(p.id, n)}
                      autoFocus
                      onBlur={() => setEditandoDescuento(null)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setEditandoDescuento(null) }}
                      className="w-20 shrink-0 px-1.5 py-1 rounded-lg border border-input bg-background text-card-foreground text-xs text-center font-bold"
                    />
                  ) : (
                    <button
                      onClick={() => setEditandoDescuento(p.id)}
                      className="shrink-0 text-right"
                      aria-label="Adjust price"
                    >
                      <span className={`block text-[13px] font-bold ${descuentos[p.id] !== undefined || pl != null ? 'text-primary' : listaPrecios[p.id] !== undefined ? 'text-[#b09060]' : 'text-card-foreground'}`}>
                        {fmt(descuentos[p.id] ?? pl ?? precioBase(p))}
                      </span>
                      {(descuentos[p.id] !== undefined || pl != null) && (
                        <span className="block text-[9px] text-muted-foreground line-through">{fmt(precioBase(p))}</span>
                      )}
                    </button>
                  )}
                  <div className="flex items-center gap-1 shrink-0 border border-border rounded-full px-1 py-0.5">
                    <button
                      onClick={() => setQty(p.id, Math.max(0, qty - 1))}
                      aria-label="Less"
                      className="w-6 h-6 flex items-center justify-center text-primary font-bold text-base disabled:opacity-30"
                      disabled={qty === 0}
                    >
                      −
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={qty || ''}
                      placeholder="0"
                      onChange={(e) => setQty(p.id, Number(e.target.value))}
                      className={`w-8 text-center bg-transparent text-sm font-bold outline-none ${excede ? 'text-destructive' : 'text-card-foreground'}`}
                    />
                    <button
                      onClick={() => setQty(p.id, qty + 1)}
                      aria-label="More"
                      className="w-6 h-6 flex items-center justify-center text-primary font-bold text-base"
                    >
                      +
                    </button>
                  </div>
                </div>
              )
            }) : (
              <div className="text-center text-muted-foreground py-10 text-sm">No products found</div>
            )}
          </div>
        ) : (
          <div className={`grid gap-2.5 ${vista === '3' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {visibles.length ? (
              visibles.map((p, i) => {
                const almInfo = almacenInfo(almacenes, p.almacen || almacenPrincipal(almacenes))
                const esCastillo = !almInfo.lleva_stock
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
                const hist = historialCliente.get(p.id)
                const pl = precioLiquidacion(p)
                return (
                  <div
                    key={p.id}
                    className={`relative bg-card border rounded-2xl p-3 flex flex-col h-full ${
                      qty > 0 ? 'border-primary' : 'border-border'
                    }`}
                  >
                    {p.liquidacion && (
                      <span className="absolute top-2 left-2 z-[1] px-1.5 py-0.5 rounded-full text-[9px] font-extrabold bg-[#f5eee2] text-[#a3814e] border border-[#e6d9c2]">
                        🏷️ CLEARANCE
                      </span>
                    )}
                    {renderFoto(p, i, 'w-full aspect-square rounded-lg mb-2 shrink-0')}
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
                      {esCastillo ? `${almInfo.icono} ${almInfo.nombre.toUpperCase()}` : stockEstado}
                    </span>
                    <div className="flex items-center gap-1.5 mt-1">
                      {descuentos[p.id] !== undefined && descuentos[p.id] !== precioBase(p) ? (
                        <>
                          <span className="text-xs text-muted-foreground line-through">{fmt(precioBase(p))}</span>
                          <span className="text-sm font-bold text-primary">{fmt(descuentos[p.id])}</span>
                        </>
                      ) : pl != null ? (
                        <>
                          <span className="text-xs text-muted-foreground line-through">{fmt(precioBase(p))}</span>
                          <span className="text-sm font-bold text-[#a3814e]">{fmt(pl)}</span>
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
                    {/* Lo que este cliente pago y llevo la ultima vez */}
                    {hist && (
                      <div className="text-[10.5px] text-primary/80 mt-0.5 leading-tight">
                        Last: {hist.ultimaQty}u @ {fmt(hist.ultimoPrecio)} · {haceTexto(hist.ultima)}
                      </div>
                    )}

                    {/* Aplicar descuento */}
                    {editandoDescuento === p.id ? (
                      <div className="mt-2 pt-2 border-t border-border">
                        <label className="text-[10px] text-muted-foreground block mb-1">Price for this order</label>
                        <div className="flex gap-1">
                          <MoneyInput
                            value={descuentos[p.id] ?? precioBase(p)}
                            onChange={(n) => setDescuento(p.id, n)}
                            autoFocus
                            onBlur={() => setEditandoDescuento(null)}
                            onKeyDown={(e) => { if (e.key === 'Enter') setEditandoDescuento(null) }}
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
        )}

        {visibles.length < filtered.length && (
          <button
            onClick={() => setPage((n) => n + 1)}
            className="w-full mt-3 py-3 rounded-2xl bg-card border border-border text-sm font-bold text-primary active:scale-[0.99] transition-all"
          >
            Load more · {filtered.length - visibles.length} left
          </button>
        )}
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

      {/* Foto a pantalla completa para enseñarsela al cliente */}
      {zoomProd && (
        <div
          className="fixed inset-0 z-40 bg-black/95 flex flex-col"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          onClick={() => setZoomIdx(null)}
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - touchX.current
            if (Math.abs(dx) < 45 || zoomIdx == null) return
            const next = dx < 0 ? zoomIdx + 1 : zoomIdx - 1
            if (next >= 0 && next < visibles.length) setZoomIdx(next)
          }}
        >
          <div className="flex justify-end p-4">
            <button
              onClick={(e) => { e.stopPropagation(); setZoomIdx(null) }}
              aria-label="Close"
              className="w-9 h-9 rounded-full bg-white/15 text-white text-lg leading-none"
            >
              ✕
            </button>
          </div>
          <div
            className="flex-1 mx-4 rounded-3xl bg-white flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {zoomProd.foto ? (
              <img src={zoomProd.foto} alt={zoomProd.nom} className="w-full h-full object-contain p-4" />
            ) : (
              <span className="text-6xl">📦</span>
            )}
          </div>
          <div className="px-6 pt-4 pb-2 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-white text-base font-bold uppercase leading-snug break-words">{zoomProd.nom}</p>
            <div className="flex items-baseline justify-center gap-3 mt-2">
              <span className="text-white text-3xl font-bold tracking-tight">
                {fmt(descuentos[zoomProd.id] ?? precioLiquidacion(zoomProd) ?? precioBase(zoomProd))}
              </span>
              {almacenInfo(almacenes, zoomProd.almacen || almacenPrincipal(almacenes)).lleva_stock && (
                <span className="text-white/60 text-xs">Available: {disponible(zoomProd)} units</span>
              )}
            </div>
            {visibles.length > 1 && (
              <p className="text-white/40 text-[11px] mt-3">‹ swipe to see the next product ›</p>
            )}
          </div>
        </div>
      )}

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
                  const esCastillo = !almacenInfo(almacenes, p.almacen || almacenPrincipal(almacenes)).lleva_stock
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
