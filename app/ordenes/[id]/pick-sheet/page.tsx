'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface PickSheetItem {
  cod: string
  nom: string
  cantidad: number
  foto?: string
  fab?: string
  ubicacion?: string
}

interface PickSheet {
  items: PickSheetItem[]
  fecha_creacion: string
}

interface Orden {
  id: string
  num: number
  cli: string
  fecha: string
  estado: string
  total: number
  pick_sheet: PickSheet
}

interface Cliente {
  nom: string
}

export default function PickSheetPage() {
  const params = useParams()
  const router = useRouter()
  const ordenId = params.id as string
  const supabase = createClient()

  const [orden, setOrden] = useState<Orden | null>(null)
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({})

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: o } = await supabase.from('ordenes').select('*').eq('id', ordenId).single()
        if (o) {
          setOrden(o as Orden)
          
          const { data: c } = await supabase.from('clientes').select('nom').eq('id', o.cli).single()
          if (c) setCliente(c as Cliente)
        }
      } catch (error) {
        console.log("[v0] Error loading pick sheet:", error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [ordenId, supabase])

  if (loading) {
    return <div className="flex items-center justify-center h-screen text-muted-foreground">Loading...</div>
  }

  if (!orden || !orden.pick_sheet) {
    return <div className="flex items-center justify-center h-screen text-destructive">Pick sheet no encontrado</div>
  }

  const pickSheetData = orden.pick_sheet as PickSheet
  const items = [...(pickSheetData?.items || [])].sort((a, b) =>
    (a.cod || "").localeCompare(b.cod || "", "en", { numeric: true, sensitivity: "base" })
  )
  const totalUnidades = items.reduce((sum, item) => sum + item.cantidad, 0)
  const checkedCount = Object.values(checkedItems).filter(Boolean).length

  const toggleItem = (idx: number) => {
    setCheckedItems(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }))
  }

  return (
    <div className="bg-white min-h-screen">
      {/* Controles - ocultos al imprimir */}
      <div className="print:hidden sticky top-0 bg-white border-b border-gray-300 shadow-sm">
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="text-blue-600 text-sm font-medium hover:text-blue-800"
          >
            ← Back
          </button>
          <div className="flex gap-3">
            <button
              onClick={() => window.print()}
              className="px-6 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700"
            >
              🖨 Imprimir
            </button>
          </div>
        </div>
      </div>

      {/* Documento Pick Sheet */}
      <div className="max-w-5xl mx-auto p-8 print:p-4">
        {/* Encabezado */}
        <div className="mb-8 text-center border-b-4 border-black pb-6">
          <h1 className="text-4xl font-black tracking-wide">PICK SHEET</h1>
          <h2 className="text-2xl font-bold mt-2">PICK SHEET</h2>
          <p className="text-gray-600 mt-2">Order #{orden.num}</p>
        </div>

        {/* Información de la Orden */}
        <div className="mb-8 grid grid-cols-4 gap-6 bg-gray-50 border-2 border-black p-6">
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Order</p>
            <p className="text-2xl font-black">#{orden.num}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Date</p>
            <p className="text-2xl font-black">{new Date(orden.fecha).toLocaleDateString('en-US')}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Client</p>
            <p className="text-lg font-bold">{cliente?.nom || 'N/A'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Total</p>
            <p className="text-2xl font-black">${orden.total?.toFixed(2)}</p>
          </div>
        </div>

        {/* Tabla de Productos */}
        <table className="w-full mb-8 border-collapse">
          <thead>
            <tr className="bg-black text-white">
              <th className="border-2 border-black p-4 text-left font-black text-sm">✓</th>
              <th className="border-2 border-black p-4 text-left font-black text-sm">COD</th>
              <th className="border-2 border-black p-4 text-left font-black text-sm">PRODUCT</th>
              <th className="border-2 border-black p-4 text-center font-black text-sm w-20">QUANTITY</th>
              <th className="border-2 border-black p-4 text-left font-black text-sm">OBSERVACIONES</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="border-2 border-black hover:bg-gray-50">
                <td className="border-2 border-black p-4 text-center cursor-pointer print:cursor-default" onClick={() => toggleItem(idx)}>
                  <input
                    type="checkbox"
                    checked={checkedItems[idx] || false}
                    onChange={() => toggleItem(idx)}
                    className="w-5 h-5 cursor-pointer accent-blue-600 print:cursor-default"
                  />
                </td>
                <td className="border-2 border-black p-4 font-black text-sm">{item.cod}</td>
                <td className="border-2 border-black p-4">
                  <p className="font-bold text-sm">{item.nom}</p>
                  {item.fab && <p className="text-xs text-gray-600">Fabricante: {item.fab}</p>}
                </td>
                <td className="border-2 border-black p-4 text-center">
                  <p className="text-2xl font-black">{item.cantidad}</p>
                </td>
                <td className="border-2 border-black p-4 text-sm min-h-16"></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Resumen */}
        <div className="mb-8 bg-gray-50 border-2 border-black p-6 flex justify-between items-center">
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase">Total products</p>
            <p className="text-3xl font-black">{items.length}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase">Total units</p>
            <p className="text-3xl font-black">{totalUnidades}</p>
          </div>
          <div className="print:hidden">
            <p className="text-xs font-bold text-gray-700 uppercase">Verificados</p>
            <p className="text-3xl font-black text-blue-600">{checkedCount}/{items.length}</p>
          </div>
        </div>

        {/* Firmas - Solo para impresión */}
        <div className="hidden print:grid grid-cols-3 gap-12 mt-16">
          <div className="text-center">
            <div className="border-t-4 border-black pt-4 h-24"></div>
            <p className="font-bold text-sm mt-2">Prepared by</p>
            <p className="text-xs text-gray-600">Name and signature</p>
          </div>
          <div className="text-center">
            <div className="border-t-4 border-black pt-4 h-24"></div>
            <p className="font-bold text-sm mt-2">Verified by</p>
            <p className="text-xs text-gray-600">Name and signature</p>
          </div>
          <div className="text-center">
            <div className="border-t-4 border-black pt-4 h-24"></div>
            <p className="font-bold text-sm mt-2">Received by</p>
            <p className="text-xs text-gray-600">Name and signature</p>
          </div>
        </div>

        {/* Nota al pie */}
        <div className="hidden print:block mt-8 text-center text-xs text-gray-600 border-t border-gray-300 pt-4">
          <p>Impreso: {new Date().toLocaleString('en-US')}</p>
        </div>
      </div>
    </div>
  )
}
