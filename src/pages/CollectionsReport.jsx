import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import { formatNaira, formatPeriod } from '../lib/format.js'
import { buildCsv, buildXlsx, download } from '../lib/exportCollections.js'

const TZ = 'Africa/Lagos'
// Fees have kobo, so show them to two decimals.
const formatFee = (n) => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dayOf = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso)) : '')

export default function CollectionsReport() {
  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState('')
  const [pays, setPays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [costs, setCosts] = useState(null)
  const [costErr, setCostErr] = useState(null)

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
    ;(async () => {
      const { data, error } = await supabase.rpc('mono_cost_summary')
      if (error) setCostErr(/mono_cost_summary/.test(error.message) ? 'The monthly cost table needs SQL 014 to be run first.' : error.message)
      else setCosts(data || [])
    })()
  }, [])

  useEffect(() => {
    if (!period) return
    ;(async () => {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('payments')
        .select('amount, fee_amount, payment_date, attempted_at, mono_reference, member_id, schedule_id, members(full_name, ogfza_member_id), payment_schedules!inner(period, fee_share)')
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
  // The member's fee share sits inside the amount debited, so it is counted once per schedule.
  const rows = useMemo(() => {
    const by = new Map()
    const seen = new Set()
    for (const p of pays) {
      const cur = by.get(p.member_id) || {
        internal_id: p.members?.ogfza_member_id || '',
        full_name: p.members?.full_name || '',
        amount: 0, fee: null, fee_share: 0, date: '', refs: [],
      }
      cur.amount = Math.round((cur.amount + Number(p.amount)) * 100) / 100
      if (p.fee_amount != null) cur.fee = Math.round(((cur.fee || 0) + Number(p.fee_amount)) * 100) / 100
      if (p.schedule_id && !seen.has(p.schedule_id)) {
        seen.add(p.schedule_id)
        cur.fee_share = Math.round((cur.fee_share + Number(p.payment_schedules?.fee_share || 0)) * 100) / 100
      }
      const d = dayOf(p.payment_date || p.attempted_at)
      if (d > cur.date) cur.date = d
      if (p.mono_reference) cur.refs.push(p.mono_reference)
      by.set(p.member_id, cur)
    }
    return [...by.values()]
      .map((r) => ({ ...r, reference: r.refs.join('; ') }))
      .sort((a, b) => a.internal_id.localeCompare(b.internal_id, undefined, { numeric: true }))
  }, [pays])

  const total = rows.reduce((a, r) => a + r.amount, 0)
  // Fee report for the month: what Mono charged, what members repaid, what the cooperative bore.
  const r2 = (n) => Math.round(n * 100) / 100
  const monoFees = r2(rows.reduce((a, r) => a + Number(r.fee || 0), 0))
  const shares = r2(rows.reduce((a, r) => a + Number(r.fee_share || 0), 0))
  const netCost = r2(monoFees - shares)
  const sharers = rows.filter((r) => r.fee_share > 0).length
  const missingFee = rows.filter((r) => r.fee == null).length
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
          {loading ? 'Loading…' : `${rows.length} line${rows.length === 1 ? '' : 's'} collected, ${formatNaira(total)} in total.`}
        </p>
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-md border border-navy-950/10 px-4 py-3">
              <div className="text-xs text-navy-950/50">Mono fees charged</div>
              <div className="text-lg font-semibold text-navy-950">{formatFee(monoFees)}</div>
              <div className="text-xs text-navy-950/50">What Mono took on these debits</div>
            </div>
            <div className="bg-white rounded-md border border-navy-950/10 px-4 py-3">
              <div className="text-xs text-navy-950/50">Fee shares recovered</div>
              <div className="text-lg font-semibold text-navy-950">{formatFee(shares)}</div>
              <div className="text-xs text-navy-950/50">{sharers} member{sharers === 1 ? '' : 's'} repaid part of the fee</div>
            </div>
            <div className="bg-white rounded-md border border-navy-950/10 px-4 py-3">
              <div className="text-xs text-navy-950/50">Net cost to the cooperative</div>
              <div className="text-lg font-semibold text-navy-950">{formatFee(netCost)}</div>
              <div className="text-xs text-navy-950/50">Mono fees minus shares recovered</div>
            </div>
          </div>
        )}
        {!loading && missingFee > 0 && (
          <p className="text-xs text-bad mb-3">Mono has not reported a fee for {missingFee} line{missingFee === 1 ? '' : 's'}, so the fee totals may be incomplete.</p>
        )}
        <div className="bg-white rounded-md border border-navy-950/10 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                <th className="px-4 py-3 font-medium">Internal ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Collected</th>
                <th className="px-4 py-3 font-medium">Mono fee</th>
                <th className="px-4 py-3 font-medium">Fee share in amount</th>
                <th className="px-4 py-3 font-medium">Debit date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-950/5">
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-navy-950/50">No successful collections for this month yet.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.internal_id}>
                  <td className="px-4 py-3 text-navy-950/70">{r.internal_id}</td>
                  <td className="px-4 py-3 font-medium text-navy-950">{r.full_name}</td>
                  <td className="px-4 py-3 tabular text-navy-950/80">{formatNaira(r.amount)}</td>
                  <td className="px-4 py-3 tabular text-navy-950/80">{r.fee == null ? '—' : formatFee(r.fee)}</td>
                  <td className="px-4 py-3 tabular text-navy-950/80">{r.fee_share > 0 ? formatFee(r.fee_share) : '—'}</td>
                  <td className="px-4 py-3 text-navy-950/70">{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2 className="text-base font-semibold text-navy-950 mt-8 mb-1">Cost of running Mono, month by month</h2>
        <p className="text-xs text-navy-950/50 mb-3">
          Fees are as Mono reported them on successful debits, for every member. Net cost is what the cooperative actually bears after members' fee shares.
        </p>
        {costErr && <div className="rounded-md bg-bad/10 text-bad text-sm px-4 py-3 mb-3">{costErr}</div>}
        {costs && (
          <div className="bg-white rounded-md border border-navy-950/10 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium">Members debited</th>
                  <th className="px-4 py-3 font-medium">Mono fees</th>
                  <th className="px-4 py-3 font-medium">On loan members</th>
                  <th className="px-4 py-3 font-medium">Other members</th>
                  <th className="px-4 py-3 font-medium">Shares recovered</th>
                  <th className="px-4 py-3 font-medium">Net cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-950/5">
                {costs.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-navy-950/50">No successful debits yet.</td></tr>}
                {costs.map((c) => (
                  <tr key={c.m_period}>
                    <td className="px-4 py-3 font-medium text-navy-950">{formatPeriod(c.m_period)}</td>
                    <td className="px-4 py-3 tabular">{c.m_members}</td>
                    <td className="px-4 py-3 tabular">{formatFee(c.m_mono_fees)}{c.m_missing_fee > 0 ? ' *' : ''}</td>
                    <td className="px-4 py-3 tabular text-navy-950/70">{formatFee(c.m_fees_loan_members)}</td>
                    <td className="px-4 py-3 tabular text-navy-950/70">{formatFee(c.m_fees_other_members)}</td>
                    <td className="px-4 py-3 tabular text-navy-950/70">{formatFee(c.m_shares_recovered)}</td>
                    <td className="px-4 py-3 tabular font-semibold text-navy-950">{formatFee(Number(c.m_mono_fees) - Number(c.m_shares_recovered))}</td>
                  </tr>
                ))}
                {costs.length > 1 && (() => {
                  const t = (k) => costs.reduce((a, c) => a + Number(c[k] || 0), 0)
                  return (
                    <tr className="font-semibold bg-navy-950/5">
                      <td className="px-4 py-3">All months</td>
                      <td className="px-4 py-3 tabular">{t('m_members')}</td>
                      <td className="px-4 py-3 tabular">{formatFee(t('m_mono_fees'))}</td>
                      <td className="px-4 py-3 tabular">{formatFee(t('m_fees_loan_members'))}</td>
                      <td className="px-4 py-3 tabular">{formatFee(t('m_fees_other_members'))}</td>
                      <td className="px-4 py-3 tabular">{formatFee(t('m_shares_recovered'))}</td>
                      <td className="px-4 py-3 tabular">{formatFee(t('m_mono_fees') - t('m_shares_recovered'))}</td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>
        )}
        {costs && costs.some((c) => c.m_missing_fee > 0) && (
          <p className="text-xs text-bad mt-2">* Mono has not yet reported a fee on some debits that month, so the figure may be incomplete.</p>
        )}
        <p className="text-xs text-navy-950/50 mt-3">
          Only debits Mono has confirmed as successful are listed. "Month" is the month the deduction was for. A member debited more than once in it appears once, with the amounts added together.
        </p>
      </section>
    </div>
  )
}
