import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { formatDate } from '../lib/format.js'

export default function Mandates() {
  const [mandates, setMandates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('mandates')
        .select('*, members(full_name, ogfza_member_id)')
        .order('created_at', { ascending: false })
      if (!cancelled) {
        if (error) setError(error.message)
        else setMandates(data || [])
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <TopBar
        title="Mandates"
        description="Direct debit authorizations linking each member to their bank account."
      />

      {error && (
        <div className="mx-8 mb-6 rounded-md bg-bad/10 text-bad text-sm px-4 py-3">
          Could not load mandates: {error}
        </div>
      )}

      <section className="px-4 md:px-8 pb-10">
        <div className="bg-white rounded-md border border-navy-950/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">OGFZA ID</th>
                <th className="px-4 py-3 font-medium">Bank</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Mandate date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-950/5">
              {!loading && mandates.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-navy-950/50">
                    No mandates recorded yet.
                  </td>
                </tr>
              )}
              {mandates.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-medium text-navy-950">
                    {m.members?.full_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-navy-950/70">{m.members?.ogfza_member_id}</td>
                  <td className="px-4 py-3 text-navy-950/70">{m.bank_name || '—'}</td>
                  <td className="px-4 py-3 text-navy-950/70 capitalize">{m.debit_type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3 text-navy-950/70">
                    {formatDate(m.start_date || m.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p className="text-sm text-navy-950/50 mt-4">Loading…</p>}
      </section>
    </div>
  )
}
