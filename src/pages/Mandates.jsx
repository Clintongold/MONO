import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { formatDate, formatNaira } from '../lib/format.js'
import CreateMandate from '../components/CreateMandate.jsx'

export default function Mandates() {
  const [mandates, setMandates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [reloadKey, setReloadKey] = useState(0)

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
  }, [reloadKey])

  return (
    <div>
      <TopBar
        title="Mandates"
        description="Direct debit authorizations linking each member to their bank account."
      />

      <CreateMandate onCreated={() => setReloadKey((k) => k + 1)} />

      {error && (
        <div className="mx-4 md:mx-8 mb-6 rounded-md bg-bad/10 text-bad text-sm px-4 py-3">
          Could not load mandates: {error}
        </div>
      )}

      <section className="px-4 md:px-8 pb-10">
        <div className="bg-white rounded-md border border-navy-950/10 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">OGFZA ID</th>
                <th className="px-4 py-3 font-medium">Bank</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Total limit</th>
                <th className="px-4 py-3 font-medium">Mandate date</th>
                <th className="px-4 py-3 font-medium">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-950/5">
              {!loading && mandates.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-navy-950/50">
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
                  <td className="px-4 py-3 text-navy-950/70">{m.amount ? formatNaira(m.amount) : '—'}</td>
                  <td className="px-4 py-3 text-navy-950/70">
                    {formatDate(m.start_date || m.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {m.authorisation_url && m.status === 'initiated' ? (
                      <button
                        className="text-gold-600 underline underline-offset-2"
                        onClick={() => navigator.clipboard?.writeText(m.authorisation_url).catch(() => window.prompt('Copy this link:', m.authorisation_url))}
                      >
                        Copy link
                      </button>
                    ) : (
                      '—'
                    )}
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
