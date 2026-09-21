import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import StatCard from '../components/StatCard.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { formatNaira, formatDateTime, formatPeriod } from '../lib/format.js'

export default function Overview() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [memberCount, setMemberCount] = useState(0)
  const [mandateCounts, setMandateCounts] = useState({})
  const [period, setPeriod] = useState(null)
  const [periodTotals, setPeriodTotals] = useState({ expected: 0, collected: 0 })
  const [recentPayments, setRecentPayments] = useState([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { count: activeMembers, error: memberErr } = await supabase
          .from('members')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active')
        if (memberErr) throw memberErr

        const { data: mandates, error: mandateErr } = await supabase
          .from('mandates')
          .select('status')
        if (mandateErr) throw mandateErr
        const counts = mandates.reduce((acc, m) => {
          acc[m.status] = (acc[m.status] || 0) + 1
          return acc
        }, {})

        const { data: latestSchedule, error: latestErr } = await supabase
          .from('payment_schedules')
          .select('period')
          .order('period', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (latestErr) throw latestErr

        let totals = { expected: 0, collected: 0 }
        if (latestSchedule?.period) {
          const { data: rows, error: rowsErr } = await supabase
            .from('payment_schedules')
            .select('total_expected, total_collected')
            .eq('period', latestSchedule.period)
          if (rowsErr) throw rowsErr
          totals = rows.reduce(
            (acc, r) => ({
              expected: acc.expected + Number(r.total_expected || 0),
              collected: acc.collected + Number(r.total_collected || 0),
            }),
            { expected: 0, collected: 0 }
          )
        }

        const { data: payments, error: paymentsErr } = await supabase
          .from('payments')
          .select('id, amount, status, attempted_at, members(full_name)')
          .order('attempted_at', { ascending: false })
          .limit(8)
        if (paymentsErr) throw paymentsErr

        if (!cancelled) {
          setMemberCount(activeMembers || 0)
          setMandateCounts(counts)
          setPeriod(latestSchedule?.period || null)
          setPeriodTotals(totals)
          setRecentPayments(payments || [])
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const collectionRate =
    periodTotals.expected > 0
      ? Math.round((periodTotals.collected / periodTotals.expected) * 100)
      : 0
  const outstanding = periodTotals.expected - periodTotals.collected

  return (
    <div>
      <TopBar
        title="Overview"
        description={
          period
            ? `Current collection period: ${formatPeriod(period)}`
            : 'Payment operations at a glance'
        }
      />

      {error && (
        <div className="mx-8 mb-6 rounded-md bg-bad/10 text-bad text-sm px-4 py-3">
          Could not load dashboard data: {error}
        </div>
      )}

      {loading ? (
        <p className="px-4 md:px-8 text-navy-950/50 text-sm">Loading…</p>
      ) : (
        <>
          <section className="px-4 md:px-8 grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatCard label="Active members" value={memberCount} />
            <StatCard
              label="Active mandates"
              value={mandateCounts.approved || mandateCounts.ready_to_debit || 0}
              tone="good"
            />
            <StatCard
              label="Pending mandates"
              value={mandateCounts.initiated || 0}
              tone="warn"
            />
            <StatCard
              label="Failed / cancelled"
              value={(mandateCounts.rejected || 0) + (mandateCounts.cancelled || 0)}
              tone="bad"
            />
          </section>

          <section className="px-4 md:px-8 grid grid-cols-2 md:grid-cols-4 gap-6 mt-10">
            <StatCard label="Expected this period" value={formatNaira(periodTotals.expected)} />
            <StatCard label="Collected" value={formatNaira(periodTotals.collected)} tone="good" />
            <StatCard label="Outstanding" value={formatNaira(outstanding)} tone={outstanding > 0 ? 'warn' : 'default'} />
            <StatCard label="Collection rate" value={`${collectionRate}%`} tone={collectionRate >= 90 ? 'good' : 'warn'} />
          </section>

          <section className="px-4 md:px-8 mt-10 pb-10">
            <h2 className="font-display font-semibold text-lg text-navy-950 mb-3">
              Recent activity
            </h2>
            <div className="bg-white rounded-md border border-navy-950/10 divide-y divide-navy-950/5">
              {recentPayments.length === 0 && (
                <p className="px-4 py-6 text-sm text-navy-950/50">
                  No payment attempts recorded yet.
                </p>
              )}
              {recentPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-navy-950">
                      {p.members?.full_name || 'Unknown member'}
                    </p>
                    <p className="text-xs text-navy-950/50">{formatDateTime(p.attempted_at)}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm tabular text-navy-950">{formatNaira(p.amount)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
