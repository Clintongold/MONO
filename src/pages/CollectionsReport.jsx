import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import { formatNaira, formatPeriod } from '../lib/format.js'
import { buildCsv, buildXlsx, download } from '../lib/exportCollections.js'

const TZ = 'Africa/Lagos'
const dayOf = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso)) : '')

export default function CollectionsReport() {
  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState('')
  const [pays, setPays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase.from('payment_schedules').select('period').order('period', { ascending: false })
      if (error) setError(error.message)
      const unique = [...new Set((data || []).map((r) => r.period))]
      setPeriods(unique)
      if (unique.length) setPeriod(unique[0])
      else setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (!period) return
    ;(async () => {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('payments')
        .select('amount, payment_date, attempted_at, mono_reference, member_id, members(full_name, ogfza_member_id), payment_schedules!inner(period)')
        .eq('status', 'successful')
        .eq('payment_schedules.period', period)
        .order('payment_date', { ascending: true })
        .limit(5000)
      if (error) setError(error.message)
      else setPays(data || [])
      setLoading(false)
    })()
  }, [period])

  // One line per member: all of their successful debits for the month added together.
  const rows = useMemo(() => {
    const by = new Map()
    for (const p of pays) {
      const k = p.member_id
      const cur = by.get(k) || {
        internal_id: p.members?.ogfza_member_id || '',
        full_name: p.members?.full_name || '',
        amount: 0, date: '', refs: [],
      }
      cur.amount = Math.round((cur.amount + Number(p.amount)) * 100) / 100
      const d = dayOf(p.payment_date || p.attempted_at)
      if (d > cur.date) cur.date = d
      if (p.mono_reference) cur.refs.push(p.mono_reference)
      by.set(k, cur)
    }
    return [...by.values()]
      .map((r) => ({ ...r, reference: r.refs.join('; ') }))
      .sort((a, b) => a.internal_id.localeCompare(b.internal_id, undefined, { numeric: true }))
  }, [pays])

  const total = rows.reduce((a, r) => a + r.amount, 0)
  const base = `OGFZA-collections-${String(period).slice(0, 7)}`

  async function exportXlsx() {
    setBusy(true)
    try {
      const buf = await buildXlsx(rows, formatPeriod(period))
      download(buf, base + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    } catch (e) {
      setError('Could not build the Excel file: ' + e.message)
    }
    setBusy(false)
  }

  return (
    <div>
      <TopBar
        title="Successful collections"
        description="Members whose debit succeeded for the month. Export it to reconcile in the core ledger."
      />
      <div className="px-4 md:px-8 mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-navy-950/60" htmlFor="rp">Month</label>
        <select id="rp" className="border border-navy-950/15 rounded-md text-sm px-3 py-1.5 bg-white" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => <option key={p} value={p}>{formatPeriod(p)}</option>)}
        </select>
        <button disabled={!rows.length || busy} onClick={exportXlsx} className="px-3 py-1.5 rounded-md text-sm bg-navy-950 text-white disabled:opacity-40">
          Export Excel
        </button>
        <button disabled={!rows.length} onClick={() => download(buildCsv(rows), base + '.csv', 'text/csv;charset=utf-8')} className="px-3 py-1.5 rounded-md text-sm border border-navy-950/20 disabled:opacity-40">
          Export CSV
        </button>
      </div>
      {error && <div className="mx-4 md:mx-8 mb-6 rounded-md bg-bad/10 text-bad text-sm px-4 py-3">{error}</div>}
      <section className="px-4 md:px-8 pb-10">
        <p className="text-sm text-navy-950/70 mb-3">
          {loading ? 'Loading…' : `${rows.length} member${rows.length === 1 ? '' : 's'} collected, ${formatNaira(total)} in total.`}
        </p>
        <div className="bg-white rounded-md border border-navy-950/10 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                <th className="px-4 py-3 font-medium">Internal ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Collected</th>
                <th className="px-4 py-3 font-medium">Debit date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-950/5">
              {!loading && rows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-navy-950/50">No successful collections for this month yet.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.internal_id + r.date}>
                  <td className="px-4 py-3 text-navy-950/70">{r.internal_id}</td>
                  <td className="px-4 py-3 font-medium text-navy-950">{r.full_name}</td>
                  <td className="px-4 py-3 tabular text-navy-950/80">{formatNaira(r.amount)}</td>
                  <td className="px-4 py-3 text-navy-950/70">{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-navy-950/50 mt-3">
          Only debits Mono has confirmed as successful are listed. "Month" is the month the deduction was for. A member debited more than once in it appears once, with the amounts added together.
        </p>
      </section>
    </div>
  )
}
