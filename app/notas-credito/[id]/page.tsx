'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface LineaNC {
  prodNom: string
  sku?: string
  qty: number
  precio: number
}

interface NotaCredito {
  id: string
  num: number
  cli: string
  fecha: string
  monto: number
  motivo?: string
  tipo?: 'amount' | 'product'
  lineas?: LineaNC[]
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

const fdate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function NotaCreditoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [nota, setNota] = useState<NotaCredito | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('notas_credito').select('*').eq('id', id).single()
      if (data) setNota(data as NotaCredito)
      setLoading(false)
    }
    load()
  }, [id])

  const handlePrint = () => {
    window.print()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    )
  }

  if (!nota) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">Credit note not found.</p>
        <button onClick={() => router.back()} className="text-primary text-sm underline">← Go back</button>
      </div>
    )
  }

  const cnNum = `CN-${String(nota.num).padStart(3, '0')}`

  return (
    <div className="min-h-screen print:min-h-0 bg-[#5a6272] print:bg-transparent">
      <style jsx global>{`
        @media screen {
          .cn-page {
            min-height: 6in;
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
      <div className="no-print sticky top-0 z-10 bg-[#3a4252]/90 backdrop-blur-md border-b border-white/10 px-4 py-3 flex items-center gap-3"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <button
          onClick={() => router.back()}
          className="text-white/80 hover:text-white text-sm font-medium"
        >
          ← Back
        </button>
        <div className="flex-1" />
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 bg-[#4a6741] hover:bg-[#3d5636] text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          🖨️ Print / PDF
        </button>
      </div>

      {/* Page */}
      <div className="max-w-[8.5in] mx-auto py-6 px-4 print:p-0">
        <div className="cn-page bg-white overflow-hidden print:shadow-none print:rounded-none">

          {/* Header */}
          <div className="px-8 pt-6 pb-4 flex items-center justify-between border-b-2 border-[#4a6741]">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Palm Hills" className="w-14 h-14 object-contain shrink-0" />
              <div>
                <div className="text-base font-black text-[#1a1a18] leading-tight">Palm Hills</div>
                <div className="text-[10px] text-gray-500 mt-0.5">📞 (551) 248-3442 · ✉️ admin@palmhillsco.net</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-black tracking-wide text-[#4a6741]">CREDIT NOTE</div>
              <div className="text-sm font-mono text-gray-600 mt-0.5">{cnNum}</div>
              <div className="text-xs text-gray-400 mt-0.5">{fdate(nota.fecha)}</div>
            </div>
          </div>

          {/* Bill To */}
          <div className="px-8 py-5 bg-[#fafaf7]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Issued To</div>
            <div className="text-lg font-black text-[#1a1a18] uppercase">{nota.cli}</div>
          </div>

          {/* Body */}
          <div className="px-8 py-6">
            {nota.tipo === 'product' && nota.lineas?.length ? (
              <>
                {/* Product lines table */}
                <table className="w-full text-sm mb-5" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #4a6741' }}>
                      <th className="text-left py-2 text-[10px] font-black uppercase tracking-widest text-gray-500">Product</th>
                      <th className="text-center py-2 text-[10px] font-black uppercase tracking-widest text-gray-500 w-12">Qty</th>
                      <th className="text-right py-2 text-[10px] font-black uppercase tracking-widest text-gray-500 w-20">Price</th>
                      <th className="text-right py-2 text-[10px] font-black uppercase tracking-widest text-gray-500 w-20">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nota.lineas.map((l, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-gray-800 text-sm">{l.prodNom}</div>
                          {l.sku && <div className="text-[10px] text-gray-400 font-mono">SKU: {l.sku}</div>}
                        </td>
                        <td className="text-center py-2.5 text-gray-700">{l.qty}</td>
                        <td className="text-right py-2.5 text-gray-700">{fmt(l.precio)}</td>
                        <td className="text-right py-2.5 font-semibold text-gray-800">{fmt(l.precio * l.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #4a6741' }}>
                      <td colSpan={3} className="pt-3 text-right text-sm font-black text-gray-700 pr-3">Credit Total</td>
                      <td className="pt-3 text-right text-base font-black text-[#4a6741]">{fmt(nota.monto)}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            ) : (
              /* Amount box */
              <div className="flex items-center justify-between bg-[#f0f4ee] border border-[#4a6741]/20 rounded-2xl px-6 py-5 mb-6">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Credit Amount</div>
                  <div className="text-3xl font-black text-[#4a6741]">{fmt(nota.monto)}</div>
                </div>
                <div className="text-4xl opacity-20">$</div>
              </div>
            )}

            {/* Reason */}
            {nota.motivo && (
              <div className="mb-6">
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Reason</div>
                <p className="text-sm text-gray-700 leading-relaxed">{nota.motivo}</p>
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-dashed border-gray-200 my-6" />

            {/* Signature */}
            <div className="grid grid-cols-2 gap-12 pt-4">
              <div>
                <div className="border-b border-gray-300 mb-1 h-10" />
                <div className="text-[10px] text-gray-400 text-center">Authorized Signature</div>
              </div>
              <div>
                <div className="border-b border-gray-300 mb-1 h-10" />
                <div className="text-[10px] text-gray-400 text-center">Date</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 pb-6 text-center">
            <p className="text-[9px] text-gray-400">
              This credit note was issued by Palm Hills · {cnNum} · {fdate(nota.fecha)}
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
