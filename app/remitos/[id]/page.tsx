'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BackButton } from '@/components/back-button'

interface LineaOrden {
  prodId: string
  prodNom: string
  sku: string
  barcode?: string
  qty: number
  qtyEnviada?: number
  almacen?: string
}

interface Remito {
  id: string
  num: number
  orden_id: string
  orden_num: number
  cli: string
  fecha: string
  lineas?: LineaOrden[]
  enviado: boolean
  fecha_envio?: string
  total?: number
}

const fdate = (s: string) => {
  const [y, m, d] = s.split('-')
  return `${m}/${d}/${y}`
}

export default function RemitoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [remito, setRemito] = useState<Remito | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('remitos').select('*').eq('id', id).single()
      if (data) setRemito(data as Remito)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    )
  }

  if (!remito) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">Remito not found.</p>
        <BackButton fallback="/?tab=fact" />
      </div>
    )
  }

  const lineas = [...(remito.lineas || [])]
    .sort((a, b) => (a.sku || '').localeCompare(b.sku || '', 'en', { numeric: true }) || a.prodNom.localeCompare(b.prodNom, 'en'))

  const totalUnidades = lineas.reduce((s, l) => s + (l.qtyEnviada ?? l.qty), 0)

  return (
    <div className="min-h-screen print:min-h-0 bg-[#5a6272] print:bg-transparent">
      <style jsx global>{`
        @media screen {
          .remito-page {
            min-height: 5in;
            box-shadow: 0 8px 40px rgba(0,0,0,0.28);
            border-radius: 2px;
          }
        }
        @media print {
          @page { size: letter portrait; margin: 0.5in; }
          html, body { height: auto !important; min-height: 0 !important; background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Toolbar */}
      <div
        className="no-print sticky top-0 z-10 bg-[#3a4252]/90 backdrop-blur-md border-b border-white/10 px-4 py-3 flex items-center gap-3"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <BackButton fallback="/?tab=fact" />
        <div className="flex-1" />
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 bg-[#4a6741] hover:bg-[#3d5636] text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          🖨️ Print / PDF
        </button>
      </div>

      {/* Page */}
      <div className="max-w-[8.5in] mx-auto py-6 px-4 print:p-0">
        <div className="remito-page bg-white overflow-hidden print:shadow-none print:rounded-none">

          {/* Header */}
          <div className="px-8 pt-6 pb-4 flex items-center justify-between border-b-2 border-[#4a6741]">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Palm Hills" className="w-12 h-12 object-contain shrink-0" />
              <div>
                <div className="text-base font-black text-[#1a1a18] leading-tight">Palm Hills</div>
                <div className="text-[10px] text-gray-400 mt-0.5">Pickup Confirmation — Castillo</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-black tracking-wide text-[#4a6741]">REMITO #{remito.num}</div>
              <div className="text-xs text-gray-500 mt-0.5">Order #{remito.orden_num}</div>
              <div className="text-xs text-gray-400 mt-0.5">{fdate(remito.fecha)}</div>
            </div>
          </div>

          {/* Client */}
          <div className="px-8 py-4 bg-[#fafaf7] border-b border-gray-100">
            <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Prepared for</div>
            <div className="text-base font-black text-[#1a1a18] uppercase">{remito.cli}</div>
          </div>

          {/* Product table — SKU + Qty only */}
          <div className="px-8 py-5">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #4a6741' }}>
                  <th className="text-left pb-2 text-[10px] font-black uppercase tracking-widest text-gray-500 w-28">SKU</th>
                  <th className="text-left pb-2 text-[10px] font-black uppercase tracking-widest text-gray-500">Product</th>
                  <th className="text-center pb-2 text-[10px] font-black uppercase tracking-widest text-gray-500 w-16">Qty</th>
                  <th className="text-center pb-2 text-[10px] font-black uppercase tracking-widest text-gray-500 w-16">✓</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-sm font-bold text-[#4a6741]">{l.sku || '—'}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-sm text-gray-700 uppercase">{l.prodNom}</span>
                    </td>
                    <td className="py-2.5 text-center">
                      <span className="text-sm font-bold text-gray-800">{l.qtyEnviada ?? l.qty}</span>
                    </td>
                    <td className="py-2.5 text-center">
                      <div className="w-5 h-5 border border-gray-300 rounded mx-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #4a6741' }}>
                  <td colSpan={2} className="pt-3 text-right text-xs font-black text-gray-500 pr-4">Total units</td>
                  <td className="pt-3 text-center text-sm font-black text-[#4a6741]">{totalUnidades}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Signature */}
          <div className="px-8 pb-6">
            <div className="grid grid-cols-2 gap-12 mt-4">
              <div>
                <div className="border-b border-gray-300 mb-1 h-10" />
                <div className="text-[9px] text-gray-400 text-center">Received by</div>
              </div>
              <div>
                <div className="border-b border-gray-300 mb-1 h-10" />
                <div className="text-[9px] text-gray-400 text-center">Date</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 pb-5 text-center">
            <p className="text-[9px] text-gray-300">
              Remito #{remito.num} · Order #{remito.orden_num} · {fdate(remito.fecha)} · Palm Hills
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
