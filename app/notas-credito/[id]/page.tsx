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
  aplicada?: boolean
  aplicada_en?: string
  aplicada_fecha?: string
  aplicada_factura_id?: string | null
}

interface FacturaMin {
  id: string
  num: number
  fecha: string
  total: number
  pagos?: { monto: number; fecha: string; nota?: string; metodo?: string }[]
  estado: string
  saldo: number
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

const fdate = (s: string) => {
  const [y, m, d] = s.split('-')
  return `${m}/${d}/${y}`
}

export default function NotaCreditoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [nota, setNota] = useState<NotaCredito | null>(null)
  const [loading, setLoading] = useState(true)
  const [readOnly, setReadOnly] = useState(false)
  const [savingAplicada, setSavingAplicada] = useState(false)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      supabase.auth.getUser().then(({ data }) => {
        setReadOnly(data.user?.user_metadata?.role === 'visitante')
      })
      const { data } = await supabase.from('notas_credito').select('*').eq('id', id).single()
      if (data) setNota(data as NotaCredito)
      setLoading(false)
    }
    load()
  }, [id])

  const handlePrint = () => {
    window.print()
  }

  const today = () => new Date().toISOString().split('T')[0]

  // ── Aplicar credito a una factura ──
  // El credito se registra como PAGO en la factura elegida (metodo "Credit"),
  // asi la rebaja queda marcada en la factura y el balance del cliente no
  // cambia: antes restaba como credito pendiente, ahora vive dentro de la
  // factura como pago.
  const [showAplicar, setShowAplicar] = useState(false)
  const [facturasCli, setFacturasCli] = useState<FacturaMin[]>([])
  const [selFacturaId, setSelFacturaId] = useState<string>('')
  const [notaLibre, setNotaLibre] = useState('')

  const saldoDe = (f: { total: number; pagos?: { monto: number }[] }) =>
    +(f.total - (f.pagos || []).reduce((a, p) => a + p.monto, 0)).toFixed(2)

  const abrirAplicar = async () => {
    if (!nota) return
    const supabase = createClient()
    const { data } = await supabase
      .from('facturas')
      .select('id, num, fecha, total, pagos, estado')
      .eq('cli', nota.cli)
      .order('num', { ascending: false })
    const pendientes = ((data || []) as Omit<FacturaMin, 'saldo'>[])
      .map((f) => ({ ...f, saldo: saldoDe(f) }))
      .filter((f) => f.saldo > 0.009)
    setFacturasCli(pendientes)
    setSelFacturaId('')
    setNotaLibre('')
    setShowAplicar(true)
  }

  const confirmarAplicar = async () => {
    if (!nota || savingAplicada) return
    const supabase = createClient()
    setSavingAplicada(true)
    try {
      let aplicadaEn = notaLibre.trim() || 'No specific invoice'
      let facturaId: string | null = null

      if (selFacturaId) {
        const f = facturasCli.find((x) => x.id === selFacturaId)
        if (!f) throw new Error('Invoice not found')
        if (nota.monto > f.saldo + 0.009) {
          alert(`This credit (${fmt(nota.monto)}) is larger than the invoice balance (${fmt(f.saldo)}). Pick an invoice with a bigger balance.`)
          setSavingAplicada(false)
          return
        }
        // Registrar el credito como pago en la factura
        const nuevoPago = { monto: nota.monto, fecha: today(), metodo: 'Credit', nota: `Credit Note #${nota.num}` }
        const newPagos = [...(f.pagos || []), nuevoPago]
        const totalPagado = newPagos.reduce((a, p) => a + p.monto, 0)
        const newEstado = totalPagado >= f.total - 0.009 ? 'Paid' : 'Partially Paid'
        const { error: fErr } = await supabase.from('facturas').update({ pagos: newPagos, estado: newEstado }).eq('id', f.id)
        if (fErr) throw new Error(fErr.message)
        aplicadaEn = `Invoice #${String(f.num).padStart(4, '0')}`
        facturaId = f.id
      }

      const cambios = { aplicada: true, aplicada_en: aplicadaEn, aplicada_fecha: today(), aplicada_factura_id: facturaId }
      const { error } = await supabase.from('notas_credito').update(cambios).eq('id', nota.id)
      if (error) throw new Error(error.message)
      setNota({ ...nota, ...cambios })
      setShowAplicar(false)
      await supabase.from('actividad').insert({ msg: `Credit note #${nota.num} applied (${aplicadaEn})` })
    } catch (err) {
      alert('Could not apply: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSavingAplicada(false)
    }
  }

  // Desaplicar: quita el pago-credito de la factura ligada (si existe) y
  // devuelve la NC al balance pendiente del cliente.
  const handleDesaplicar = async () => {
    if (!nota || savingAplicada) return
    if (!confirm(`Unmark credit note #${nota.num} as applied? ${nota.aplicada_factura_id ? 'The credit payment will be removed from its invoice and ' : ''}it will count towards the client's balance again.`)) return
    const supabase = createClient()
    setSavingAplicada(true)
    try {
      if (nota.aplicada_factura_id) {
        const { data: f } = await supabase
          .from('facturas')
          .select('id, total, pagos')
          .eq('id', nota.aplicada_factura_id)
          .maybeSingle()
        if (f) {
          const marca = `Credit Note #${nota.num}`
          const newPagos = ((f.pagos || []) as { monto: number; nota?: string }[]).filter((p) => p.nota !== marca)
          const totalPagado = newPagos.reduce((a, p) => a + p.monto, 0)
          const newEstado = totalPagado >= Number(f.total) - 0.009 ? 'Paid' : totalPagado > 0 ? 'Partially Paid' : 'Pending'
          const { error: fErr } = await supabase.from('facturas').update({ pagos: newPagos, estado: newEstado }).eq('id', f.id)
          if (fErr) throw new Error(fErr.message)
        }
      }
      const cambios = { aplicada: false, aplicada_en: null, aplicada_fecha: null, aplicada_factura_id: null }
      const { error } = await supabase.from('notas_credito').update(cambios).eq('id', nota.id)
      if (error) throw new Error(error.message)
      setNota({ ...nota, aplicada: false, aplicada_en: undefined, aplicada_fecha: undefined, aplicada_factura_id: null })
      await supabase.from('actividad').insert({ msg: `Credit note #${nota.num} unmarked as applied` })
    } catch (err) {
      alert('Could not unmark: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSavingAplicada(false)
    }
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
        {!readOnly && (
          <button
            onClick={nota.aplicada ? handleDesaplicar : abrirAplicar}
            disabled={savingAplicada}
            className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl transition-colors disabled:opacity-50 ${
              nota.aplicada
                ? 'bg-white/10 hover:bg-white/20 text-white/80'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {savingAplicada ? 'Saving...' : nota.aplicada ? '↺ Unmark Applied' : '✓ Mark Applied'}
          </button>
        )}
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 bg-[#4a6741] hover:bg-[#3d5636] text-white text-sm font-semibold px-3 py-2 rounded-xl transition-colors"
        >
          🖨️ Print / PDF
        </button>
      </div>

      {/* Modal: aplicar credito a una factura */}
      {showAplicar && !readOnly && (
        <div className="no-print fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-4 pb-6">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-base font-bold text-[#1a1a18]">Apply Credit — {fmt(nota.monto)}</h2>
              <button onClick={() => setShowAplicar(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Pick an invoice: the credit will be recorded as a payment on it, so the discount shows on that invoice.
            </p>
            {facturasCli.length > 0 ? (
              <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
                {facturasCli.map((f) => {
                  const cabe = nota.monto <= f.saldo + 0.009
                  const sel = selFacturaId === f.id
                  return (
                    <button
                      key={f.id}
                      onClick={() => cabe && setSelFacturaId(sel ? '' : f.id)}
                      disabled={!cabe}
                      className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-gray-100 last:border-0 text-left transition-colors ${
                        sel ? 'bg-[#eaf0e6]' : cabe ? 'hover:bg-gray-50' : 'opacity-45'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-mono font-semibold text-[#a3814e]">#{String(f.num).padStart(4, '0')}</div>
                        <div className="text-[11px] text-gray-400">{fdate(f.fecha)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-gray-800">{fmt(f.saldo)}</div>
                        <div className="text-[10px] text-gray-400">{cabe ? 'balance due' : 'balance too small'}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${sel ? 'bg-[#4a6741] border-[#4a6741] text-white text-xs' : 'border-gray-300'}`}>
                        {sel ? '✓' : ''}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-gray-400 text-center py-3 mb-2">No pending invoices for this client.</div>
            )}
            {!selFacturaId && (
              <div className="mb-3">
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Or just mark it (note, optional)</label>
                <input
                  type="text"
                  value={notaLibre}
                  onChange={(e) => setNotaLibre(e.target.value)}
                  placeholder="e.g. settled in person"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                />
              </div>
            )}
            <div className="flex gap-2.5">
              <button onClick={() => setShowAplicar(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100">Cancel</button>
              <button
                onClick={confirmarAplicar}
                disabled={savingAplicada}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-[#4a6741] disabled:opacity-50"
              >
                {savingAplicada ? 'Applying...' : selFacturaId ? 'Apply to Invoice' : 'Mark Applied'}
              </button>
            </div>
          </div>
        </div>
      )}

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

          {/* Applied stamp */}
          {nota.aplicada && (
            <div className="mx-8 mt-5 flex items-center gap-3 border-2 border-green-600/40 bg-green-50 rounded-xl px-4 py-3">
              <span className="text-xl">✅</span>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-green-700">Applied</div>
                <div className="text-xs text-green-800">
                  {nota.aplicada_en || 'This credit has been used'}
                  {nota.aplicada_fecha ? ` · ${fdate(nota.aplicada_fecha)}` : ''}
                </div>
              </div>
            </div>
          )}

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
