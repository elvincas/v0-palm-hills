"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { flexibleSearch } from "@/lib/search"

// Editor de UNA lista de precios, autonomo (carga sus propios datos via
// Supabase): se usa desde el perfil del cliente para crear/editar su lista
// sin pasar por Inventario. El modal de Inventario (page.tsx) gestiona ademas
// la asignacion de clientes; aqui solo nombre + precios por producto.

interface ProductoLite {
  id: string
  nom: string
  sku?: string
  barcode?: string
  precio: number
  almacen?: string
}

const fmt = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ListaPreciosEditorModal({
  listaId,
  onClose,
  readOnly = false,
}: {
  listaId: string
  onClose: (nombre?: string) => void
  readOnly?: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [nombre, setNombre] = useState("")
  const [precios, setPrecios] = useState<Record<string, number>>({})
  const [productos, setProductos] = useState<ProductoLite[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    const load = async () => {
      const { data: lp } = await supabase
        .from("listas_precios")
        .select("nombre, precios")
        .eq("id", listaId)
        .single()
      if (lp) {
        setNombre(lp.nombre as string)
        setPrecios((lp.precios as Record<string, number>) || {})
      }
      // Productos livianos, paginados (PostgREST corta en 1000 filas)
      const PAGE = 1000
      let desde = 0
      let todos: ProductoLite[] = []
      for (;;) {
        const { data: lote, error } = await supabase
          .from("productos")
          .select("id, nom, sku, barcode, precio, almacen")
          .order("nom")
          .order("id")
          .range(desde, desde + PAGE - 1)
        if (error || !lote || lote.length === 0) break
        todos = todos.concat(lote as ProductoLite[])
        if (lote.length < PAGE) break
        desde += PAGE
      }
      setProductos(todos)
      setLoading(false)
    }
    load()
  }, [listaId, supabase])

  const guardarNombre = async (v: string) => {
    const nuevo = v.trim()
    if (!nuevo || nuevo === nombre) return
    setNombre(nuevo)
    const { error } = await supabase.from("listas_precios").update({ nombre: nuevo }).eq("id", listaId)
    if (error) alert("Error renaming list: " + error.message)
  }

  // Precio especial de un producto (vacio o 0 = quitarlo de la lista)
  const guardarPrecio = async (prodId: string, valor: string) => {
    const num = Number(String(valor).replace(",", "."))
    const actual = precios[prodId]
    const nuevo = !valor.trim() || !num || num <= 0 ? undefined : Math.round(num * 100) / 100
    if (nuevo === actual) return
    const next = { ...precios }
    if (nuevo === undefined) delete next[prodId]
    else next[prodId] = nuevo
    setPrecios(next)
    const { error } = await supabase.from("listas_precios").update({ precios: next }).eq("id", listaId)
    if (error) alert("Error saving price: " + error.message)
  }

  // Con precio especial primero; busqueda flexible del inventario
  const resultados = useMemo(() => {
    const base = search.trim()
      ? flexibleSearch(productos, search, (p) => [p.nom, p.sku, p.barcode].filter(Boolean).join(" "), (p) => p.nom)
      : [...productos].sort((a, b) => {
          const aIn = precios[a.id] !== undefined ? 0 : 1
          const bIn = precios[b.id] !== undefined ? 0 : 1
          if (aIn !== bIn) return aIn - bIn
          return (a.sku || "").localeCompare(b.sku || "", "en", { numeric: true }) || a.nom.localeCompare(b.nom, "en")
        })
    return base.slice(0, 40)
  }, [productos, search, precios])

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 px-4 pb-8 pt-12">
      <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-sm p-5 border border-white/60 flex flex-col max-h-full">
        <div className="flex items-center justify-between mb-3 shrink-0">
          {readOnly ? (
            <h3 className="font-black text-gray-800 text-base truncate">{nombre || "Price List"}</h3>
          ) : (
            <input
              key={nombre}
              defaultValue={nombre}
              onBlur={(e) => guardarNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
              placeholder="List name…"
              className="flex-1 min-w-0 font-black text-gray-800 text-base bg-transparent outline-none border-b border-transparent focus:border-[#4a6741]/30"
            />
          )}
          <button
            onClick={() => onClose(nombre)}
            className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-lg leading-none shrink-0 ml-2"
          >
            ×
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product by name, SKU…"
          autoComplete="off"
          className="w-full px-3 py-2.5 rounded-xl border border-black/10 bg-white text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/25 mb-2 shrink-0"
        />

        <div className="border border-[#e3e7dd] rounded-3xl overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="px-3 py-4 text-xs text-gray-400 text-center">Loading products…</div>
          ) : (
            <>
              {resultados.map((p) => {
                const especial = precios[p.id]
                return (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2.5 border-b border-[#e3e7dd] last:border-b-0 bg-white">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-800 leading-tight break-words uppercase">{p.nom}</div>
                      <div className="text-[10px] font-mono text-gray-400">
                        {p.sku ? `${p.sku} · ` : ""}base {fmt(p.precio)}
                      </div>
                    </div>
                    <input
                      key={`${p.id}-${especial ?? ""}`}
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      autoComplete="off"
                      disabled={readOnly}
                      defaultValue={especial !== undefined ? String(especial) : ""}
                      placeholder={String(p.precio)}
                      onBlur={(e) => guardarPrecio(p.id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                      className={`w-20 shrink-0 px-2 py-1.5 rounded-lg border text-sm text-center font-bold outline-none focus:ring-2 focus:ring-[#4a6741]/25 ${
                        especial !== undefined ? "border-[#e9dcc4] bg-[#f5eee2] text-[#a3814e]" : "border-black/10 bg-white text-gray-800"
                      }`}
                    />
                  </div>
                )
              })}
              {resultados.length === 0 && (
                <div className="px-3 py-3 text-xs text-gray-400">No products found</div>
              )}
            </>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-2 shrink-0">
          Leave a price empty to use the base price. Prices in gold are on this list.
        </p>
      </div>
    </div>
  )
}
