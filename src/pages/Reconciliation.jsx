import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import StatCard from '../components/StatCard.jsx'
import { formatNaira, formatPeriod, formatDate } from '../lib/format.js'

export default function Reconciliation() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('reconciliation')
        .select('*')
        .order('period', { ascending: false })
      if (!cancelled) {
        if (error) setError(error.message)
        else setRecords(data || [])
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const latest = records[0]

  return (
    <div>
      <TopBar
        title="Reconciliation"
        description="Monthly expected-vs-collected summary, reviewed before export to the cooperative ledger."
      />

      {error && (
        <div className="mx-8 mb-6 rounded-md bg-bad/10 text-bad text-sm px-4 py-3">{error}</div>
      )}

      {latest && (
        <section className="px-4 md:px-8 grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
          <StatCard label={`Expected — ${formatPeriod(latest.period)}`} value={formatNaira(latest.total_expected)} />
          <StatCard label="Collected" value={formatNaira(latest.total_collected)} tone="good" />
          <StatCard label="Outstanding" value={formatNaira(latest.total_outstanding)} tone={latest.total_outstanding > 0 ? 'warn' : 'default'} />
          <StatCard label="Collection rate" value={`${latest.collection_rate ?? 0}%`} tone={Number(latest.collection_rate) >= 90 ? 'good' : 'warn'} />
        </section>
      )}

      <section className="px-4 md:px-8 pb-10">
        <h2 className="font-display font-semibold text-lg text-navy-950 mb-3">
          Monthly history
        </h2>
        <div className="bg-white rounded-md border border-navy-950/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Expected</th>
                <th className="px-4 py-3 font-medium">Collected</th>
                <th className="px-4 py-3 font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium">Rate</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Exported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-950/5">
              {!loading && records.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-navy-950/50">
                    No reconciliation records yet.
                  </td>
                </tr>
              )}
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium text-navy-950">{formatPeriod(r.period)}</td>
                  <td className="px-4 py-3 tabular text-navy-950/80">{formatNaira(r.total_expected)}</td>
                  <td className="px-4 py-3 tabular text-navy-950/80">{formatNaira(r.total_collected)}</td>
                  <td className="px-4 py-3 tabular text-navy-950/80">{formatNaira(r.total_outstanding)}</td>
                  <td className="px-4 py-3 tabular text-navy-950/80">{r.collection_rate ?? 0}%</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-navy-950/70">
                    {r.exported_at ? formatDate(r.exported_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p className="text-sm text-navy-950/50 mt-4">Loading…</p>}
        <p className="text-xs text-navy-950/40 mt-4">
          Export generates a CSV for manual upload into the cooperative's existing ledger. That
          step is intentionally manual until the reconciliation process has been validated over a
          few live cycles.
        </p>
      </section>
    </div>
  )
}
