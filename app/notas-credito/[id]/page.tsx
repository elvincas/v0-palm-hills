'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BackButton } from '@/components/back-button'
import { MoneyInput } from '@/components/ui/money-input'
import { type Empresa, EMPRESA_DEFAULT } from '@/lib/empresa'

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

// Toolbar de documento: botones identicos que llenan el ancho (icono arriba,
// etiqueta abajo), mismo patron que factura y recibo. Aqui van sobre la barra
// oscura de la nota de credito, asi que el tinte es translucido.
const TAB_BTN =
  'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl border active:scale-[0.97] transition-all'
const TAB_LBL = 'text-[9px] font-bold leading-none truncate max-w-full px-0.5'

const Icon = ({ d }: { d: string }) => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
)
const IC = {
  back: 'M15 18l-6-6 6-6',
  edit: 'M12 20h9|M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  check: 'M20 6L9 17l-5-5',
  revert: 'M9 14l-5-5 5-5|M4 9h10a6 6 0 0 1 0 12h-3',
  print: 'M6 9V4h12v5|M6 13h12v8H6z|M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2',
  trash: 'M3 6h18|M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
}

export default function NotaCreditoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [nota, setNota] = useState<NotaCredito | null>(null)
  const [loading, setLoading] = useState(true)
  const [readOnly, setReadOnly] = useState(false)
  const [savingAplicada, setSavingAplicada] = useState(false)
  const [empresa, setEmpresa] = useState<Empresa>(EMPRESA_DEFAULT)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      supabase.auth.getUser().then(({ data }) => {
        setReadOnly(data.user?.app_metadata?.role === 'visitante')
      })
      supabase.from('empresa').select('*').eq('id', 1).maybeSingle().then(({ data }) => { if (data) setEmpresa(data as Empresa) })
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

  // ── Editar / borrar ──
  // Una NC aplicada ya dejo un pago "Credit" dentro de su factura. Editarla
  // desincronizaria ese pago, asi que primero hay que desaplicarla (el boton
  // esta en esta misma barra y ya sabe quitar el pago). Borrar SI se permite
  // estando aplicada: limpia el pago de la factura antes de borrar, porque
  // dejarlo huerfano seria peor.
  const [showEdit, setShowEdit] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [clientesLista, setClientesLista] = useState<{ id: string; nom: string; codigo_cliente?: string }[]>([])
  const [editCli, setEditCli] = useState('')
  const [editFecha, setEditFecha] = useState('')
  const [editMotivo, setEditMotivo] = useState('')
  const [editMonto, setEditMonto] = useState(0)
  const [editLineas, setEditLineas] = useState<LineaNC[]>([])
  const [prodSearch, setProdSearch] = useState('')
  const [prodResultados, setProdResultados] = useState<{ id: string; nom: string; sku?: string; precio: number }[]>([])

  const abrirEdit = async () => {
    if (!nota) return
    if (nota.aplicada) {
      alert(
        `This credit is already applied${nota.aplicada_en ? ` to ${nota.aplicada_en}` : ''}. Tap "Unmark" first to edit it — that removes the credit payment from the invoice, so the numbers stay in sync.`
      )
      return
    }
    setEditCli(nota.cli)
    setEditFecha(nota.fecha)
    setEditMotivo(nota.motivo || '')
    setEditMonto(nota.monto)
    setEditLineas(nota.lineas ? nota.lineas.map((l) => ({ ...l })) : [])
    setProdSearch('')
    setProdResultados([])
    setShowEdit(true)
    if (!clientesLista.length) {
      const supabase = createClient()
      const { data } = await supabase.from('clientes').select('id, nom, codigo_cliente').order('nom')
      setClientesLista((data as { id: string; nom: string; codigo_cliente?: string }[]) || [])
    }
  }

  // Busqueda contra la base (esta pantalla no vive dentro del DataContext, no
  // tiene el catalogo en memoria).
  const buscarProductos = async (texto: string) => {
    setProdSearch(texto)
    const q = texto.trim()
    if (q.length < 2) { setProdResultados([]); return }
    const supabase = createClient()
    const { data } = await supabase
      .from('productos')
      .select('id, nom, sku, precio')
      .or(`nom.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(8)
    setProdResultados((data as { id: string; nom: string; sku?: string; precio: number }[]) || [])
  }

  const esProducto = nota?.tipo === 'product'
  const totalEdit = esProducto ? editLineas.reduce((s, l) => s + l.precio * l.qty, 0) : editMonto

  const guardarEdit = async () => {
    if (!nota || savingEdit) return
    if (!editCli) { alert('Select a client'); return }
    const monto = +Number(totalEdit).toFixed(2)
    if (!monto || monto <= 0) { alert('Enter a valid amount'); return }
    setSavingEdit(true)
    try {
      const supabase = createClient()
      const cambios = {
        cli: editCli,
        fecha: editFecha,
        motivo: editMotivo,
        monto,
        ...(esProducto ? { lineas: editLineas } : {}),
      }
      const { error } = await supabase.from('notas_credito').update(cambios).eq('id', nota.id)
      if (error) throw new Error(error.message)
      setNota({ ...nota, ...cambios })
      setShowEdit(false)
      await supabase.from('actividad').insert({ msg: `Credit note #${nota.num} edited — ${fmt(monto)}` })
    } catch (err) {
      alert('Could not save: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!nota || deleting) return
    const ligada = nota.aplicada && nota.aplicada_factura_id
    const aviso = ligada
      ? `Delete credit note #${nota.num}? The ${fmt(nota.monto)} credit payment will also be removed from ${nota.aplicada_en || 'its invoice'}, and that invoice will go back to owing it.`
      : `Delete credit note #${nota.num}? This cannot be undone.`
    if (!confirm(aviso)) return
    setDeleting(true)
    try {
      const supabase = createClient()
      // Primero soltar el pago-credito de la factura, si lo habia: un pago
      // huerfano en una factura es peor que no borrar nada.
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
      const { error } = await supabase.from('notas_credito').delete().eq('id', nota.id)
      if (error) throw new Error(error.message)
      await supabase.from('actividad').insert({ msg: `Credit note #${nota.num} deleted` })
      router.push('/?tab=fact')
    } catch (err) {
      alert('Could not delete: ' + (err instanceof Error ? err.message : String(err)))
      setDeleting(false)
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
        <BackButton fallback="/?tab=fact" />
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

      {/* Toolbar: botones iguales que llenan el ancho (a 390px cinco acciones
          no caben como pildoras con texto). */}
      <div className="no-print sticky top-0 z-10 bg-[#3a4252]/90 backdrop-blur-md border-b border-white/10 px-4 py-2.5"
        style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top))' }}>
        <div className="max-w-3xl mx-auto flex items-stretch gap-1.5">
          <button
            onClick={() => (window.history.length > 1 ? router.back() : router.push('/?tab=fact'))}
            className={`${TAB_BTN} bg-white/10 border-white/15 text-white/80`}
          >
            <Icon d={IC.back} />
            <span className={TAB_LBL}>Back</span>
          </button>
          {!readOnly && (
            <button
              onClick={abrirEdit}
              className={`${TAB_BTN} border-white/15 ${nota.aplicada ? 'bg-white/5 text-white/40' : 'bg-white/10 text-white/80'}`}
            >
              <Icon d={IC.edit} />
              <span className={TAB_LBL}>Edit</span>
            </button>
          )}
          {!readOnly && (
            <button
              onClick={nota.aplicada ? handleDesaplicar : abrirAplicar}
              disabled={savingAplicada}
              className={`${TAB_BTN} disabled:opacity-50 ${
                nota.aplicada ? 'bg-white/10 border-white/15 text-white/80' : 'bg-green-600 border-green-600 text-white'
              }`}
            >
              <Icon d={nota.aplicada ? IC.revert : IC.check} />
              <span className={TAB_LBL}>{savingAplicada ? '...' : nota.aplicada ? 'Unmark' : 'Apply'}</span>
            </button>
          )}
          <button onClick={handlePrint} className={`${TAB_BTN} bg-[#4a6741] border-[#4a6741] text-white`}>
            <Icon d={IC.print} />
            <span className={TAB_LBL}>Print</span>
          </button>
          {!readOnly && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`${TAB_BTN} bg-red-500/20 border-red-400/30 text-red-200 disabled:opacity-50`}
            >
              <Icon d={IC.trash} />
              <span className={TAB_LBL}>{deleting ? '...' : 'Delete'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Editar */}
      {showEdit && !readOnly && (
        <div className="no-print fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-4 pb-6">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[#1a1a18]">Edit Credit Note #{nota.num}</h2>
              <button onClick={() => setShowEdit(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Client</label>
                <select
                  value={editCli}
                  onChange={(e) => setEditCli(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-base outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                >
                  <option value="">Select a client...</option>
                  {clientesLista.map((c) => (
                    <option key={c.id} value={c.nom}>
                      {c.codigo_cliente ? `${c.codigo_cliente} — ${c.nom}` : c.nom}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Date</label>
                <input
                  type="date"
                  value={editFecha}
                  onChange={(e) => setEditFecha(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                />
              </div>

              {esProducto ? (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Products</label>
                  <div className="space-y-2">
                    {editLineas.map((l, i) => (
                      <div key={i} className="border border-gray-200 rounded-xl p-2.5">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-gray-800 uppercase break-words">{l.prodNom}</div>
                            {l.sku && <div className="text-[10px] font-mono text-gray-400">{l.sku}</div>}
                          </div>
                          <button
                            onClick={() => setEditLineas((prev) => prev.filter((_, x) => x !== i))}
                            className="text-gray-300 hover:text-red-500 text-lg leading-none px-1 shrink-0"
                          >
                            ×
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Qty</label>
                            <input
                              type="number"
                              min="1"
                              value={l.qty}
                              onChange={(e) =>
                                setEditLineas((prev) => prev.map((x, ix) => (ix === i ? { ...x, qty: parseInt(e.target.value) || 1 } : x)))
                              }
                              className="w-full mt-0.5 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Unit Price ($)</label>
                            <MoneyInput
                              value={l.precio}
                              onChange={(n) => setEditLineas((prev) => prev.map((x, ix) => (ix === i ? { ...x, precio: n } : x)))}
                              className="w-full mt-0.5 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                            />
                          </div>
                        </div>
                        <div className="text-right text-xs font-bold text-[#4a6741] mt-1.5">{fmt(l.precio * l.qty)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="relative mt-2">
                    <input
                      type="text"
                      value={prodSearch}
                      onChange={(e) => buscarProductos(e.target.value)}
                      placeholder="+ Add product (name or SKU)..."
                      autoComplete="off"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                    />
                    {prodResultados.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto w-full">
                        {prodResultados.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setEditLineas((prev) => [...prev, { prodNom: p.nom, sku: p.sku, qty: 1, precio: Number(p.precio) }])
                              setProdSearch('')
                              setProdResultados([])
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          >
                            <span className="block text-xs font-bold text-gray-800 uppercase break-words">{p.nom}</span>
                            <span className="text-[10px] font-mono text-gray-400">{p.sku || '—'} · {fmt(Number(p.precio))}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between bg-[#eaf0e6] rounded-xl px-4 py-2.5 mt-3">
                    <span className="text-sm font-bold text-gray-700">Credit Total</span>
                    <span className="text-base font-black text-[#4a6741]">{fmt(totalEdit)}</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Amount ($)</label>
                  <MoneyInput
                    value={editMonto}
                    onChange={setEditMonto}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1 block">Reason / Notes</label>
                <input
                  type="text"
                  value={editMotivo}
                  onChange={(e) => setEditMotivo(e.target.value)}
                  placeholder="Reason for credit..."
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-base outline-none focus:ring-2 focus:ring-[#4a6741]/40"
                />
              </div>
            </div>

            <div className="flex gap-2.5 mt-5">
              <button onClick={() => setShowEdit(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100">Cancel</button>
              <button
                onClick={guardarEdit}
                disabled={savingEdit || !editCli || totalEdit <= 0}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-[#4a6741] disabled:opacity-50"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: aplicar credito a una factura */}
      {showAplicar && !readOnly && (
        <div className="no-print fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-4 pb-6">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-5 max-h-[80vh] overflow-y-auto">
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
              <img src={empresa.logo || "/logo.png"} alt={empresa.nombre} className="w-14 h-14 object-contain shrink-0" />
              <div>
                <div className="text-base font-black text-[#1a1a18] leading-tight">{empresa.nombre}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{[empresa.telefono ? `📞 ${empresa.telefono}` : "", empresa.email ? `✉️ ${empresa.email}` : ""].filter(Boolean).join(" · ")}</div>
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
                          <div className="font-semibold text-gray-800 text-sm uppercase">{l.prodNom}</div>
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
              <div className="flex items-center justify-between bg-[#f0f4ee] border border-[#4a6741]/20 rounded-3xl px-6 py-5 mb-6">
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
            {empresa.mensaje_nota_credito && (
              <p className="mb-2 mx-auto max-w-md text-xs italic text-gray-500 bg-[#f2f4ee] rounded-lg px-3 py-2">{empresa.mensaje_nota_credito}</p>
            )}
            <p className="text-[9px] text-gray-400">
              This credit note was issued by {empresa.nombre} · {cnNum} · {fdate(nota.fecha)}
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
