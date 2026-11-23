'use client'

// Pantalla "From a note" de New Order: pegar la nota de pedido -> revisar linea
// por linea lo que la app entendio -> agregar a la orden. El parser vive en
// lib/nota-orden.ts; aqui solo esta la UI de pegado y revision.

import { Fragment, useMemo, useState } from 'react'
import { BackButton } from '@/components/back-button'
import { type Almacen, almacenInfo } from '@/lib/almacenes'
import {
  type Candidato,
  type Confianza,
  type LineaNota,
  type ProductoNota,
  buscarEnCatalogo,
  parsearNota,
  prepararCatalogo,
} from '@/lib/nota-orden'

export type ProductoNotaUI = ProductoNota & { foto?: string | null; icon?: string }

interface Fila extends LineaNota {
  quitada: boolean
  /** El usuario eligio el producto a mano: ya no hay que revisarla. */
  confirmada: boolean
  /** No viene de la nota: se sumo con el buscador de la revision. */
  agregada?: boolean
}

interface Props {
  productos: ProductoNotaUI[]
  almacenes: Almacen[]
  almacenDefault: string
  /** prodId -> veces que este cliente lo compro (desempata a su favor). */
  favoritos: Map<string, number>
  clienteNom?: string
  fechaLabel: string
  texto: string
  onTextoChange: (t: string) => void
  precioDe: (p: ProductoNotaUI) => number
  /** null = el almacen no lleva stock (no hay limite). */
  disponibleDe: (p: ProductoNotaUI) => number | null
  onBack: () => void
  onConfirm: (items: { prodId: string; qty: number }[]) => void
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

const ESTADO: Record<Confianza | 'confirmada' | 'adivinada' | 'agregada', { label: string; clase: string }> = {
  agregada: { label: '＋ Added', clase: 'bg-[#e4efe0] text-[#3d6132]' },
  adivinada: { label: 'Best guess', clase: 'bg-[#fdf0dc] text-[#8a6420]' },
  confirmada: { label: '✓ Chosen', clase: 'bg-[#e4efe0] text-[#3d6132]' },
  codigo: { label: '✓ Code', clase: 'bg-[#e4efe0] text-[#3d6132]' },
  alta: { label: '✓ Match', clase: 'bg-[#e4efe0] text-[#3d6132]' },
  media: { label: 'Check', clase: 'bg-[#fdf0dc] text-[#8a6420]' },
  baja: { label: 'Unsure', clase: 'bg-[#fdf0dc] text-[#8a6420]' },
  ninguna: { label: 'Not found', clase: 'bg-destructive/10 text-destructive' },
}

// "Best guess": ninguna palabra coincidio y se propuso lo mas parecido por
// letras (score < 0.4) — nunca se deja una linea vacia, pero hay que mirarla.
const estadoDe = (f: Fila): Confianza | 'confirmada' | 'adivinada' | 'agregada' =>
  f.agregada ? 'agregada' : f.confirmada ? 'confirmada' : f.elegido && (f.candidatos[0]?.score ?? 1) < 0.4 ? 'adivinada' : f.confianza
const porRevisar = (f: Fila) =>
  f.tipo === 'producto' && !f.quitada && !f.confirmada && (f.confianza === 'media' || f.confianza === 'baja' || f.confianza === 'ninguna')

const EJEMPLO = `PALM HILLS
12 hair plus ampolla banana
hapl18 x6
CASTILLO
bt-56 3
silicon mix ampollas coco - 2`

export function NotaOrden(props: Props) {
  const { productos, almacenes, almacenDefault, favoritos, texto, onTextoChange, precioDe, disponibleDe } = props
  const [fase, setFase] = useState<'pegar' | 'revisar'>('pegar')
  const [filas, setFilas] = useState<Fila[]>([])
  const [editando, setEditando] = useState<number | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [soloRevisar, setSoloRevisar] = useState(false)
  const [agregar, setAgregar] = useState('')
  const [resaltada, setResaltada] = useState<number | null>(null)

  // Las fotos llegan en lotes y cambian `productos` cada vez: el indice solo
  // usa nombre/codigo/almacen, asi que se rearma solo si cambia el catalogo
  // (la UI dibuja siempre desde prodPorId, que si trae las fotos al dia).
  const catKey = `${productos.length}|${almacenDefault}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cat = useMemo(() => prepararCatalogo(productos, almacenDefault), [catKey])
  const prodPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])

  const procesar = () => {
    const res = parsearNota(texto, cat, almacenes, favoritos)
    // Lo que se sumo con el buscador no esta en la nota: sobrevive a releerla.
    setFilas((prev) => {
      const base: Fila[] = res.map((l) => ({ ...l, quitada: false, confirmada: false }))
      const tope = base.reduce((m, f) => Math.max(m, f.num), 0)
      const extras = prev.filter((f) => f.agregada).map((f, i) => ({ ...f, num: tope + 1 + i }))
      return [...base, ...extras]
    })
    setAgregar('')
    setEditando(null)
    setSoloRevisar(false)
    setFase('revisar')
    window.scrollTo({ top: 0 })
  }

  const pegarPortapapeles = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) onTextoChange(texto.trim() ? `${texto.replace(/\s+$/, '')}\n${t}` : t)
    } catch {
      alert('Could not read the clipboard. Long-press inside the box and choose Paste.')
    }
  }

  const cambiar = (num: number, cambio: Partial<Fila>) =>
    setFilas((prev) => prev.map((f) => (f.num === num ? { ...f, ...cambio } : f)))

  const abrirEditor = (f: Fila) => {
    if (editando === f.num) return setEditando(null)
    setEditando(f.num)
    setBusqueda(f.consulta)
  }

  // Lleva la vista a una fila y la marca un momento.
  const irA = (num: number) => {
    setResaltada(num)
    setTimeout(() => document.getElementById(`nota-fila-${num}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    setTimeout(() => setResaltada((r) => (r === num ? null : r)), 2000)
  }

  // Buscador de la revision: suma un producto que no estaba en la nota. Si ya
  // esta en la lista no se duplica — se lleva al usuario a esa fila.
  const agregarProducto = (p: ProductoNotaUI) => {
    setAgregar('')
    setSoloRevisar(false)
    setEditando(null)
    const ya = filas.find((f) => f.tipo === 'producto' && !f.quitada && f.elegido === p.id)
    if (ya) return irA(ya.num)
    const num = filas.reduce((m, f) => Math.max(m, f.num), 0) + 1
    setFilas((prev) => [
      ...prev,
      {
        num,
        texto: 'Added by search',
        tipo: 'producto',
        almacen: null,
        consulta: p.nom,
        qty: 1,
        qtyDetectada: true,
        candidatos: [],
        elegido: p.id,
        confianza: 'alta',
        quitada: false,
        confirmada: true,
        agregada: true,
      },
    ])
    irA(num)
  }

  // ── Resumen ──
  const productosFilas = filas.filter((f) => f.tipo === 'producto')
  const activas = productosFilas.filter((f) => !f.quitada)
  const reconocidas = activas.filter((f) => f.elegido)
  const nRevisar = filas.filter(porRevisar).length
  const nSinProducto = activas.filter((f) => !f.elegido).length

  // Un mismo producto en dos lineas: se suma al confirmar, y se avisa en la fila.
  const primeraLinea = new Map<string, number>()
  for (const f of activas) if (f.elegido && !primeraLinea.has(f.elegido)) primeraLinea.set(f.elegido, f.num)

  const total = reconocidas.reduce((acc, f) => {
    const p = prodPorId.get(f.elegido!)
    return acc + (p ? precioDe(p) * f.qty : 0)
  }, 0)
  const unidades = reconocidas.reduce((acc, f) => acc + f.qty, 0)

  const confirmar = () => {
    if (nRevisar > 0 && !confirm(`${nRevisar} line${nRevisar === 1 ? '' : 's'} still marked to check. Add the order anyway?`)) return
    props.onConfirm(reconocidas.map((f) => ({ prodId: f.elegido!, qty: f.qty })))
  }

  // ───────────────────────── Fase 1: pegar ─────────────────────────
  if (fase === 'pegar') {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto p-4 pb-32" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
          <BackButton onClick={props.onBack} className="mb-2" />
          <h1 className="text-xl font-bold text-card-foreground leading-tight">Order from a note</h1>
          <p className="text-sm text-muted-foreground mb-4">
            {props.clienteNom} · 🚚 {props.fechaLabel}
          </p>

          <div className="bg-card border border-border rounded-3xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-card-foreground">Paste your order list</p>
              <button
                onClick={pegarPortapapeles}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground border border-primary/20"
              >
                📋 Paste
              </button>
            </div>
            <textarea
              value={texto}
              onChange={(e) => onTextoChange(e.target.value)}
              placeholder={EJEMPLO}
              rows={14}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-card-foreground text-[15px] font-mono leading-relaxed placeholder:text-muted-foreground/50"
            />
            <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              <li>• One product per line — name, part of the name, or just the code (SKU).</li>
              <li>• Quantity anywhere on the line: <span className="font-mono">12 shampoo</span>, <span className="font-mono">shampoo x12</span>, <span className="font-mono">shampoo - 12</span>, <span className="font-mono">2 dz</span>.</li>
              <li>
                • A line with just the warehouse name (
                {almacenes.filter((a) => a.activo).map((a) => a.nombre.toUpperCase()).join(', ')}
                ) tells the app where the next products are.
              </li>
            </ul>
          </div>
        </div>

        <div
          className="fixed bottom-0 inset-x-0 z-30 backdrop-blur-xl bg-card/85 border-t border-white/40 shadow-[0_-12px_32px_-4px_rgba(0,0,0,0.15)]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="max-w-2xl mx-auto px-4 py-3.5">
            <button
              onClick={procesar}
              disabled={!texto.trim()}
              className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-md disabled:opacity-40 active:scale-[0.98] transition-all"
            >
              Read the note
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ───────────────────────── Fase 2: revisar ─────────────────────────
  const visibles = soloRevisar ? filas.filter((f) => f.tipo === 'header' || porRevisar(f)) : filas

  const resultadosAgregar = agregar.trim() ? buscarEnCatalogo(cat, agregar, { favoritos, limite: 8 }) : []
  const primeraAgregada = filas.find((f) => f.agregada)?.num

  const resultadosEditor = (f: Fila): Candidato[] =>
    busqueda.trim() === f.consulta.trim() && f.candidatos.length
      ? f.candidatos
      : buscarEnCatalogo(cat, busqueda, { almacen: f.almacen, favoritos, limite: 8 })

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto p-4" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
          <BackButton onClick={() => setFase('pegar')} label="Note" className="mb-2" />
          <h1 className="text-xl font-bold text-card-foreground leading-tight">Check what the app read</h1>
          <p className="text-sm text-muted-foreground">
            {activas.length} lines · <span className="text-[#3d6132] font-semibold">{reconocidas.length - filas.filter((f) => porRevisar(f) && f.elegido).length} OK</span>
            {nRevisar > 0 && <> · <span className="text-[#8a6420] font-semibold">{nRevisar} to check</span></>}
          </p>
          {nRevisar > 0 && (
            <div className="mt-2 flex bg-muted rounded-full p-0.5 text-xs font-semibold">
              <button
                onClick={() => setSoloRevisar(false)}
                className={`flex-1 py-1.5 rounded-full ${!soloRevisar ? 'bg-card text-card-foreground shadow-sm' : 'text-muted-foreground'}`}
              >
                All lines
              </button>
              <button
                onClick={() => setSoloRevisar(true)}
                className={`flex-1 py-1.5 rounded-full ${soloRevisar ? 'bg-card text-card-foreground shadow-sm' : 'text-muted-foreground'}`}
              >
                Only to check ({nRevisar})
              </button>
            </div>
          )}

          {/* Sumar un producto que no estaba en la nota */}
          <div className="relative mt-2">
            <input
              type="text"
              inputMode="search"
              value={agregar}
              onChange={(e) => setAgregar(e.target.value)}
              placeholder="🔍 Add a product — name or code"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-input bg-card text-card-foreground text-base"
            />
            {agregar && (
              <button
                onClick={() => setAgregar('')}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-muted-foreground font-bold"
              >
                ✕
              </button>
            )}
            {agregar.trim() && (
              <div className="absolute inset-x-0 top-full mt-1 z-20 max-h-[50vh] overflow-y-auto bg-card border border-border rounded-2xl shadow-xl p-1.5 space-y-1">
                {resultadosAgregar.map((c) => {
                  const cp = prodPorId.get(c.id)
                  if (!cp) return null
                  const ca = almacenInfo(almacenes, cp.almacen || almacenDefault)
                  const enLista = primeraLinea.has(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => agregarProducto(cp)}
                      className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-xl border border-border bg-background"
                    >
                      <div className="w-10 h-10 rounded-lg bg-white border border-border flex items-center justify-center overflow-hidden shrink-0">
                        {cp.foto ? <img src={cp.foto} alt="" className="w-full h-full object-contain" /> : <span className="text-lg">{cp.icon || '📦'}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-card-foreground uppercase leading-snug break-words">{cp.nom}</p>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-mono">{cp.sku || '—'}</span> · {ca.icono} {ca.nombre} · {fmt(precioDe(cp))}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${enLista ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'}`}>
                        {enLista ? 'In list →' : '＋ Add'}
                      </span>
                    </button>
                  )
                })}
                {resultadosAgregar.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-3">No products match.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 pb-40 space-y-2">
        {visibles.map((f) => {
          if (f.tipo === 'header') {
            const info = almacenInfo(almacenes, f.almacen || almacenDefault)
            return (
              <div key={f.num} className="flex items-center gap-2 pt-3 pb-1">
                <span className="text-[11px] font-mono text-muted-foreground w-6 text-right">{f.num}</span>
                <span className="text-sm font-bold text-card-foreground">{info.icono} {info.nombre}</span>
                <span className="flex-1 border-t border-border" />
              </div>
            )
          }

          const p = f.elegido ? prodPorId.get(f.elegido) : undefined
          const est = ESTADO[estadoDe(f)]
          const disp = p ? disponibleDe(p) : null
          const excede = disp != null && f.qty > disp
          const repetida = f.elegido && primeraLinea.get(f.elegido) !== f.num ? primeraLinea.get(f.elegido) : null
          const fuera = p && f.almacen && (p.almacen || almacenDefault) !== f.almacen
          const almP = p ? almacenInfo(almacenes, p.almacen || almacenDefault) : null

          return (
            <Fragment key={f.num}>
            {f.num === primeraAgregada && (
              <div className="flex items-center gap-2 pt-3 pb-1">
                <span className="text-[11px] font-mono text-muted-foreground w-6 text-right">＋</span>
                <span className="text-sm font-bold text-card-foreground">Added by search</span>
                <span className="flex-1 border-t border-border" />
              </div>
            )}
            <div
              id={`nota-fila-${f.num}`}
              className={`bg-card border rounded-2xl p-3 transition-shadow ${resaltada === f.num ? 'ring-2 ring-primary ' : ''}${f.quitada ? 'opacity-45 border-border' : porRevisar(f) ? 'border-[#e6c98f]' : 'border-border'}`}
            >
              {/* Lo que dice la nota */}
              <div className="flex items-start gap-2">
                <span className="text-[11px] font-mono text-muted-foreground w-6 text-right pt-0.5 shrink-0">{f.agregada ? '＋' : f.num}</span>
                <p className={`flex-1 min-w-0 text-xs font-mono text-muted-foreground break-words ${f.quitada ? 'line-through' : ''}`}>{f.texto}</p>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${f.quitada ? 'bg-muted text-muted-foreground' : est.clase}`}>
                  {f.quitada ? 'Removed' : est.label}
                </span>
              </div>

              {!f.quitada && (
                <div className="mt-2 flex items-center gap-2 pl-8">
                  {/* Lo que entendio la app */}
                  <button onClick={() => abrirEditor(f)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                    <div className="w-10 h-10 rounded-lg bg-white border border-border flex items-center justify-center overflow-hidden shrink-0">
                      {p?.foto ? <img src={p.foto} alt="" className="w-full h-full object-contain" /> : <span className="text-lg">{p ? p.icon || '📦' : '❓'}</span>}
                    </div>
                    <div className="min-w-0">
                      {p ? (
                        <>
                          <p className="text-[13px] font-semibold text-card-foreground uppercase leading-snug break-words">{p.nom}</p>
                          <p className="text-[11px] text-muted-foreground">
                            <span className="font-mono">{p.sku || '—'}</span>
                            {almP && <span className="ml-1.5">{almP.icono} {almP.nombre}</span>}
                            <span className="ml-1.5">· {fmt(precioDe(p))}</span>
                          </p>
                        </>
                      ) : (
                        <p className="text-[13px] font-semibold text-destructive">Tap to choose a product</p>
                      )}
                      <p className="text-[11px] text-primary font-semibold">{editando === f.num ? 'Close ⌃' : 'Change ⌄'}</p>
                    </div>
                  </button>

                  {/* Cantidad */}
                  <div className="shrink-0 flex flex-col items-center">
                    <div className="flex items-center bg-secondary rounded-full">
                      <button onClick={() => cambiar(f.num, { qty: Math.max(1, f.qty - 1), qtyDetectada: true })} className="w-8 h-8 text-lg font-bold text-secondary-foreground">−</button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={f.qty}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
                          cambiar(f.num, { qty: Number.isFinite(n) ? n : 0, qtyDetectada: true })
                        }}
                        onBlur={() => f.qty < 1 && cambiar(f.num, { qty: 1 })}
                        className={`w-10 text-center bg-transparent text-base font-bold ${f.qtyDetectada ? 'text-card-foreground' : 'text-[#8a6420]'}`}
                      />
                      <button onClick={() => cambiar(f.num, { qty: f.qty + 1, qtyDetectada: true })} className="w-8 h-8 text-lg font-bold text-secondary-foreground">+</button>
                    </div>
                    {!f.qtyDetectada && <span className="text-[10px] text-[#8a6420] mt-0.5">no qty in note</span>}
                  </div>
                </div>
              )}

              {!f.quitada && (excede || repetida || fuera) && (
                <div className="pl-8 mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                  {excede && <span className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">Only {disp} available</span>}
                  {repetida && <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Also on line {repetida} — will be added together</span>}
                  {fuera && <span className="px-2 py-0.5 rounded-full bg-[#fdf0dc] text-[#8a6420]">Not under its warehouse header</span>}
                </div>
              )}

              {/* Editor: elegir otro producto */}
              {!f.quitada && editando === f.num && (
                <div className="mt-3 pl-8">
                  <input
                    type="text"
                    inputMode="search"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Search name or code"
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-card-foreground text-base"
                  />
                  <div className="mt-2 space-y-1">
                    {resultadosEditor(f).map((c) => {
                      const cp = prodPorId.get(c.id)
                      if (!cp) return null
                      const ca = almacenInfo(almacenes, cp.almacen || almacenDefault)
                      const actual = c.id === f.elegido
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            cambiar(f.num, { elegido: c.id, confirmada: true })
                            setEditando(null)
                          }}
                          className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-xl border ${actual ? 'border-primary bg-secondary' : 'border-border bg-background'}`}
                        >
                          <div className="w-8 h-8 rounded-md bg-white flex items-center justify-center overflow-hidden shrink-0">
                            {cp.foto ? <img src={cp.foto} alt="" className="w-full h-full object-contain" /> : <span>{cp.icon || '📦'}</span>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-card-foreground uppercase break-words">{cp.nom}</p>
                            <p className="text-[10px] text-muted-foreground">
                              <span className="font-mono">{cp.sku || '—'}</span> · {ca.icono} {ca.nombre} · {fmt(precioDe(cp))}
                            </p>
                          </div>
                          {actual && <span className="text-primary text-sm font-bold shrink-0">✓</span>}
                        </button>
                      )
                    })}
                    {busqueda.trim() && resultadosEditor(f).length === 0 && (
                      <p className="text-xs text-muted-foreground px-1 py-2">No products match.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="pl-8 mt-2 flex justify-end gap-3">
                {!f.quitada && porRevisar(f) && f.elegido && (
                  <button onClick={() => cambiar(f.num, { confirmada: true })} className="text-[11px] font-semibold text-primary">
                    ✓ It's correct
                  </button>
                )}
                <button
                  onClick={() => { cambiar(f.num, { quitada: !f.quitada }); if (editando === f.num) setEditando(null) }}
                  className={`text-[11px] font-semibold ${f.quitada ? 'text-primary' : 'text-destructive'}`}
                >
                  {f.quitada ? '↺ Restore line' : '✕ Remove line'}
                </button>
              </div>
            </div>
            </Fragment>
          )
        })}

        {soloRevisar && nRevisar === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">Nothing left to check 🎉</p>
        )}
      </div>

      <div
        className="fixed bottom-0 inset-x-0 z-30 backdrop-blur-xl bg-card/85 border-t border-white/40 shadow-[0_-12px_32px_-4px_rgba(0,0,0,0.15)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3.5">
          {nSinProducto > 0 && (
            <p className="text-[11px] text-destructive mb-1.5">
              {nSinProducto} line{nSinProducto === 1 ? '' : 's'} without a product will be skipped.
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{reconocidas.length} lines · {unidades} units</p>
              <p className="text-xl font-bold text-primary truncate">{fmt(total)}</p>
            </div>
            <button
              onClick={confirmar}
              disabled={reconocidas.length === 0}
              className="shrink-0 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 shadow-md"
            >
              Add to order
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
