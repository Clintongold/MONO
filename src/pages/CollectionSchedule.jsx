import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { formatNaira, formatPeriod } from '../lib/format.js'

export default function CollectionSchedule() {
  const [periods, setPeriods] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actioningId, setActioningId] = useState(null)

  const loadPeriods = useCallback(async () => {
    const { data, error } = await supabase
      .from('payment_schedules')
      .select('period')
      .order('period', { ascending: false })
    if (error) {
      setError(error.message)
      return
    }
    const unique = [...new Set((data || []).map((r) => r.period))]
    setPeriods(unique)
    if (unique.length > 0 && !selectedPeriod) setSelectedPeriod(unique[0])
  }, [selectedPeriod])

  const loadRows = useCallback(async (period) => {
    if (!period) return
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('payment_schedules')
      .select('*, members(full_name, ogfza_member_id), mandates(bank_name)')
      .eq('period', period)
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadPeriods()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedPeriod) loadRows(selectedPeriod)
  }, [selectedPeriod, loadRows])

  // SANDBOX ACTION: simulates an "Initiate Direct Debit" button.
  // In production this should call a backend Edge Function that holds the
  // Mono secret key and calls POST /v3/payments/mandates/{id}/debit -
  // the browser must never call Mono directly with a secret key.
  async function handleInitiateDebit(row) {
    const outstanding = Number(row.total_expected) - Number(row.total_collected)
    if (outstanding <= 0) return
    setActioningId(row.id)

    const { data: payment, error: insertErr } = await supabase
      .from('payments')
      .insert({
        member_id: row.member_id,
        schedule_id: row.id,
        mandate_id: row.mandate_id,
        amount: outstanding,
        status: 'processing',
      })
      .select()
      .single()

    if (insertErr) {
      setError(insertErr.message)
      setActioningId(null)
      return
    }

    // Simulate the webhook callback that would normally arrive from Mono.
    setTimeout(async () => {
      const succeeds = Math.random() > 0.35
      await supabase
        .from('payments')
        .update({
          status: succeeds ? 'successful' : 'failed',
          response_code: succeeds ? null : '51',
          failure_category: succeeds ? null : 'insufficient_funds',
          payment_date: succeeds ? new Date().toISOString() : null,
        })
        .eq('id', payment.id)

      if (succeeds) {
        const newCollected = Number(row.total_collected) + outstanding
        await supabase
          .from('payment_schedules')
          .update({
            total_collected: newCollected,
            status: newCollected >= Number(row.total_expected) ? 'paid' : 'partial',
          })
          .eq('id', row.id)
      }

      await loadRows(selectedPeriod)
      setActioningId(null)
    }, 1400)
  }

  return (
    <div>
      <TopBar
        title="Collection schedule"
        description="Expected deductions for the period, with collection status per member."
      />

      <div className="px-4 md:px-8 mb-4 flex items-center gap-3">
        <label className="text-sm text-navy-950/60" htmlFor="period">
          Period
        </label>
        <select
          id="period"
          className="border border-navy-950/15 rounded-md text-sm px-3 py-1.5 bg-white"
          value={selectedPeriod || ''}
          onChange={(e) => setSelectedPeriod(e.target.value)}
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {formatPeriod(p)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mx-8 mb-6 rounded-md bg-bad/10 text-bad text-sm px-4 py-3">{error}</div>
      )}

      <section className="px-4 md:px-8 pb-10">
        <div className="bg-white rounded-md border border-navy-950/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Bank</th>
                <th className="px-4 py-3 font-medium">Expected</th>
                <th className="px-4 py-3 font-medium">Collected</th>
                <th className="px-4 py-3 font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-950/5">
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-navy-950/50">
                    No schedule rows for this period.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const outstanding = Number(row.total_expected) - Number(row.total_collected)
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium text-navy-950">
                      {row.members?.full_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-navy-950/70">{row.mandates?.bank_name || '—'}</td>
                    <td className="px-4 py-3 tabular text-navy-950/80">
                      {formatNaira(row.total_expected)}
                    </td>
                    <td className="px-4 py-3 tabular text-navy-950/80">
                      {formatNaira(row.total_collected)}
                    </td>
                    <td className="px-4 py-3 tabular text-navy-950/80">
                      {formatNaira(outstanding)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status !== 'paid' && (
                        <button
                          onClick={() => handleInitiateDebit(row)}
                          disabled={actioningId === row.id}
                          className="text-xs font-medium px-3 py-1.5 rounded-md bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
                        >
                          {actioningId === row.id ? 'Initiating…' : 'Initiate direct debit'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {loading && <p className="text-sm text-navy-950/50 mt-4">Loading…</p>}
        <p className="text-xs text-navy-950/40 mt-4">
          Sandbox: this button simulates a debit attempt and its outcome. Wire it to a backend
          Edge Function calling Mono's debit endpoint to go live — the Mono secret key must never
          be called from this browser code.
        </p>
      </section>
    </div>
  )
}
