'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface PickItem {
  prodId: string
  prodNom: string
  sku: string
  barcode: string
  qty: number
  recogido: boolean
}

interface PickSheet {
  generado: string
  cliente: string
  items: PickItem[]
}

interface Orden {
  id: string
  num: number
  cli: string
  fecha: string
  estado: string
  total: number
  pick_sheet?: PickSheet | null
}

export default function PickSheetPage() {
  const params = useParams()
  const router = useRouter()
  const ordenId = params.id as string

  const [orden, setOrden] = useState<Orden | null>(null)
  const [clienteNom, setClienteNom] = useState('')
  const [items, setItems] = useState<PickItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: o } = await supabase.from('ordenes').select('*').eq('id', ordenId).single()
        if (o) {
          setOrden(o as Orden)
          const ps = (o as Orden).pick_sheet
          if (ps?.items) setItems(ps.items)
          if (o.cli) {
            const { data: c } = await supabase.from('clientes').select('nom').eq('id', o.cli).single()
            if (c) setClienteNom(c.nom)
          }
        }
      } catch (error) {
        console.log('[v0] Error loading pick sheet:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [ordenId])

  const toggleItem = (prodId: string) => {
    setItems((prev) =>
      prev.map((it) => (it.prodId === prodId ? { ...it, recogido: !it.recogido } : it)),
    )
  }

  const guardarProgreso = async () => {
    if (!orden) return
    setSaving(true)
    try {
      const supabase = createClient()
      const updatedPickSheet = {
        ...(orden.pick_sheet as PickSheet),
        items,
      }
      await supabase.from('ordenes').update({ pick_sheet: updatedPickSheet }).eq('id', orden.id)
      setOrden({ ...orden, pick_sheet: updatedPickSheet })
    } catch (error) {
      console.log('[v0] Error guardando pick sheet:', error)
      alert('Error al guardar el progreso')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando pick sheet...</p>
      </div>
    )
  }

  if (!orden || !orden.pick_sheet) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-destructive">Pick sheet no encontrado</p>
      </div>
    )
  }

  const totalUnidades = items.reduce((acc, it) => acc + it.qty, 0)
  const recogidos = items.filter((it) => it.recogido).length

  return (
    <div className="min-h-screen bg-background">
      {/* Controles - ocultos al imprimir */}
      <div className="print:hidden sticky top-0 z-10 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto p-4 flex items-center justify-between gap-2">
          <button
            onClick={() => router.push(`/clientes/${orden.cli}`)}
            className="text-primary text-sm font-medium cursor-pointer"
          >
            ← Volver
          </button>
          <div className="flex gap-2">
            <button
              onClick={guardarProgreso}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-bold disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              onClick={() => window.print()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
            >
              Imprimir
            </button>
          </div>
        </div>
      </div>

      {/* Documento del pick sheet */}
      <div className="max-w-2xl mx-auto p-6 print:p-0">
        <div className="bg-card border border-border rounded-2xl p-6 print:border-0 print:rounded-none print:p-2">
          {/* Encabezado */}
          <div className="border-b border-border pb-4 mb-4">
            <h1 className="text-2xl font-bold text-card-foreground">PICK SHEET</h1>
            <p className="text-sm text-muted-foreground mt-1">Hoja de recolección de orden</p>
            <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
              <div>
                <span className="text-muted-foreground">Orden #</span>
                <p className="font-bold text-card-foreground">{orden.num}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Fecha</span>
                <p className="font-bold text-card-foreground">{orden.fecha}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Cliente</span>
                <p className="font-bold text-card-foreground">{clienteNom || orden.pick_sheet.cliente}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Estado</span>
                <p className="font-bold text-card-foreground">{orden.estado}</p>
              </div>
            </div>
          </div>

          {/* Tabla de productos */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 w-8 print:w-6">✓</th>
                <th className="py-2">Producto</th>
                <th className="py-2 text-right w-16">Cant.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.prodId} className="border-b border-border align-top">
                  <td className="py-3">
                    <input
                      type="checkbox"
                      checked={it.recogido}
                      onChange={() => toggleItem(it.prodId)}
                      className="w-5 h-5 print:w-4 print:h-4 accent-primary cursor-pointer"
                      aria-label={`Marcar ${it.prodNom} como recogido`}
                    />
                  </td>
                  <td className="py-3">
                    <p className={`font-medium text-card-foreground ${it.recogido ? 'line-through opacity-60' : ''}`}>
                      {it.prodNom}
                    </p>
                    {it.sku && <p className="text-xs text-muted-foreground font-mono">SKU: {it.sku}</p>}
                    {it.barcode && <p className="text-xs text-muted-foreground font-mono">CB: {it.barcode}</p>}
                  </td>
                  <td className="py-3 text-right font-bold text-card-foreground text-lg">{it.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Resumen */}
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
            <span className="text-sm text-muted-foreground">
              {items.length} productos · {totalUnidades} unidades
            </span>
            <span className="text-sm font-bold text-card-foreground print:hidden">
              Recogidos: {recogidos}/{items.length}
            </span>
          </div>

          {/* Firmas - solo al imprimir */}
          <div className="hidden print:grid grid-cols-2 gap-8 mt-12">
            <div className="border-t border-foreground pt-1 text-center text-xs">Preparado por</div>
            <div className="border-t border-foreground pt-1 text-center text-xs">Verificado por</div>
          </div>
        </div>
      </div>
    </div>
  )
}
