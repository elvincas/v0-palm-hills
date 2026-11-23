'use client'

// Selector de "que producto estamos esperando" de un back order. Lo usan el
// Review Order de New Order y la modal de back order del tab Orders.
//
// Dos formas de elegir: tocar una linea de la propia orden, o buscar cualquier
// producto del catalogo — incluso sin stock, que es justo el caso: el que
// falta normalmente no se pudo agregar a la orden.

import { useMemo, useState } from 'react'
import { type Almacen, almacenInfo, almacenPrincipal } from '@/lib/almacenes'
import { type BackOrderItem, estadoEspera } from '@/lib/back-order'
import { buscarEnCatalogo, prepararCatalogo } from '@/lib/nota-orden'

export interface ProductoBO {
  id: string
  nom: string
  sku?: string
  barcode?: string
  fabricante?: string
  almacen?: string
  stock?: number
  reservado?: number
  foto?: string | null
  icon?: string
}

interface Props {
  productos: ProductoBO[]
  almacenes: Almacen[]
  /** Lineas de la orden: se ofrecen como acceso rapido. */
  lineas: { prodId: string; qty: number }[]
  value: BackOrderItem[]
  onChange: (items: BackOrderItem[]) => void
}

const CHIP_OK = 'bg-[#e4efe0] text-[#3d6132]'
const CHIP_ESPERA = 'bg-[#fdf0dc] text-[#8a6420]'

export function BackOrderPicker({ productos, almacenes, lineas, value, onChange }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const almDefault = almacenPrincipal(almacenes)

  // Las fotos llegan en lotes y cambian `productos`: el indice solo usa
  // nombre/codigo, se rearma solo si cambia el catalogo.
  const catKey = `${productos.length}|${almDefault}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cat = useMemo(() => prepararCatalogo(productos, almDefault), [catKey])
  const prodPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const qtyEnOrden = useMemo(() => new Map(lineas.map((l) => [l.prodId, l.qty])), [lineas])
  const elegidos = new Set(value.map((v) => v.prodId))

  const agregar = (p: ProductoBO) => {
    if (elegidos.has(p.id)) return
    onChange([...value, { prodId: p.id, prodNom: p.nom, sku: p.sku || '', qty: qtyEnOrden.get(p.id) || 1 }])
    setBusqueda('')
  }
  const quitar = (id: string) => onChange(value.filter((v) => v.prodId !== id))
  const setQty = (id: string, qty: number) =>
    onChange(value.map((v) => (v.prodId === id ? { ...v, qty: Math.max(1, qty) } : v)))

  const deLaOrden = lineas.map((l) => prodPorId.get(l.prodId)).filter((p): p is ProductoBO => !!p && !elegidos.has(p.id))
  const resultados = busqueda.trim()
    ? buscarEnCatalogo(cat, busqueda, { limite: 8 }).map((c) => prodPorId.get(c.id)).filter((p): p is ProductoBO => !!p)
    : []

  const foto = (p: ProductoBO | undefined) => (
    <div className="w-10 h-10 rounded-lg bg-white border border-border flex items-center justify-center overflow-hidden shrink-0">
      {p?.foto ? <img src={p.foto} alt="" className="w-full h-full object-contain" /> : <span className="text-lg">{p?.icon || '📦'}</span>}
    </div>
  )

  return (
    <div>
      {/* Elegidos */}
      {value.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {value.map((v) => {
            const p = prodPorId.get(v.prodId)
            const enOrden = qtyEnOrden.get(v.prodId) || 0
            const est = estadoEspera(v, p, almacenes, enOrden)
            return (
              <div key={v.prodId} className="flex items-center gap-2 bg-background border border-border rounded-xl p-2">
                {foto(p)}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-card-foreground uppercase leading-snug break-words">{p?.nom || v.prodNom}</p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-mono">{v.sku || '—'}</span>
                    {enOrden > 0 && <span className="ml-1.5">· in this order × {enOrden}</span>}
                  </p>
                  {est && (
                    <span className={`inline-block mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${est.listo ? CHIP_OK : CHIP_ESPERA}`}>{est.label}</span>
                  )}
                </div>
                {/* Si es una linea de la orden, la cantidad es la de la linea. */}
                {enOrden === 0 && (
                  <div className="shrink-0 flex items-center bg-secondary rounded-full">
                    <button type="button" onClick={() => setQty(v.prodId, v.qty - 1)} className="w-8 h-8 text-lg font-bold text-secondary-foreground">−</button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={v.qty}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setQty(v.prodId, parseInt(e.target.value.replace(/\D/g, ''), 10) || 1)}
                      aria-label="Quantity wanted"
                      className="w-9 text-center bg-transparent text-base font-bold text-card-foreground"
                    />
                    <button type="button" onClick={() => setQty(v.prodId, v.qty + 1)} className="w-8 h-8 text-lg font-bold text-secondary-foreground">+</button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => quitar(v.prodId)}
                  aria-label="Remove"
                  className="shrink-0 w-8 h-8 rounded-full text-destructive font-bold"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Buscar en todo el catalogo */}
      <input
        type="text"
        inputMode="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="🔍 Search the product you are waiting for"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-card-foreground text-base"
      />
      {busqueda.trim() && (
        <div className="mt-1.5 space-y-1">
          {resultados.map((p) => {
            const ya = elegidos.has(p.id)
            const ca = almacenInfo(almacenes, p.almacen || almDefault)
            const est = estadoEspera({ prodId: p.id, prodNom: p.nom, qty: 1 }, p, almacenes, 0)
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => agregar(p)}
                disabled={ya}
                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-xl border border-border bg-background disabled:opacity-50"
              >
                {foto(p)}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-card-foreground uppercase leading-snug break-words">{p.nom}</p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-mono">{p.sku || '—'}</span> · {ca.icono} {ca.nombre}
                    {est && <span className={est.listo ? '' : ' text-[#8a6420] font-semibold'}> · {est.listo ? `${Number(p.stock || 0) - Number(p.reservado || 0)} in stock` : est.label}</span>}
                  </p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${ya ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'}`}>
                  {ya ? 'Added' : '＋ Add'}
                </span>
              </button>
            )
          })}
          {resultados.length === 0 && <p className="text-xs text-muted-foreground px-2 py-3">No products match.</p>}
        </div>
      )}

      {/* Acceso rapido: lineas de la orden */}
      {!busqueda.trim() && deLaOrden.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Or tap a product from this order</p>
          <div className="space-y-1">
            {deLaOrden.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => agregar(p)}
                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-xl border border-border bg-background"
              >
                {foto(p)}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-card-foreground uppercase leading-snug break-words">{p.nom}</p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-mono">{p.sku || '—'}</span> · × {qtyEnOrden.get(p.id)}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">＋ Add</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
