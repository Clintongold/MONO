import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { formatDate, formatNaira } from '../lib/format.js'
import CreateMandate from '../components/CreateMandate.jsx'
import { invokeFn } from '../lib/invokeFn.js'

export default function Mandates() {
  const [mandates, setMandates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [myId, setMyId] = useState(null)
  const [twoPerson, setTwoPerson] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data?.user?.id ?? null))
    supabase.rpc('needs_second_approver').then(({ data }) => setTwoPerson(data === true))
  }, [])

  const DAY = 24 * 3600 * 1000
  // Stale = cancelled/expired/rejected, or never authorised after 24 hours. The database re-checks all of this.
  const isStale = (m) =>
    ['cancelled', 'expired', 'rejected'].includes(m.status) || (m.status === 'initiated' && Date.now() - new Date(m.created_at).getTime() > DAY)
  const stale = mandates.filter(isStale)

  async function deleteIds(ids, what) {
    if (!ids.length) return
    const ok = window.confirm(
      `Delete ${what} from this dashboard?\n\nThis does not touch Mono. Make sure ${ids.length === 1 ? 'it is' : 'they are'} cancelled or expired on Mono: ` +
        `if a member still finishes an old link, Mono will report it again and it will reappear here without a member name.`,
    )
    if (!ok) return
    setBusy(true)
    setNote(null)
    const { data, error } = await supabase.rpc('delete_mandates', { p_ids: ids })
    setBusy(false)
    if (error) setNote({ ok: false, text: error.message })
    else {
      setNote({ ok: true, text: `Deleted ${data.deleted}.` + (data.skipped ? ` ${data.skipped} not deleted (they have debits or schedules, or are still active).` : '') })
      setReloadKey((k) => k + 1)
    }
  }

  async function cancelMandate(m, extra = {}) {
    let reason = ''
    if (!m.cancel_requested_by_id && !extra.withdraw) {
      reason = window.prompt('Why is this mandate being cancelled? (required)\nThis cancels it at Mono, and it cannot be undone.')
      if (reason === null) return
      if (reason.trim().length < 3) return setNote({ ok: false, text: 'Give a reason of a few words.' })
    } else if (!extra.withdraw && !window.confirm(`Confirm cancelling this mandate at Mono?\nRequested by ${m.cancel_requested_by}: ${m.cancel_reason || ''}`)) return
    setBusy(true)
    setNote(null)
    const { data, error } = await invokeFn('mono-mandate', { action: 'cancel', mandate_id: m.id, reason, ...extra })
    let out = data
    if (error) {
      try { out = await error.context.json() } catch (_) { out = { ok: false, message: error.message } }
    }
    if (out?.needs_force && window.confirm(out.message)) {
      setBusy(false)
      return cancelMandate(m, { ...extra, force: true })
    }
    setBusy(false)
    setNote({ ok: !!out?.ok, text: out?.message || (out?.ok ? 'Done.' : 'Something went wrong.') })
    if (out?.ok) setReloadKey((k) => k + 1)
  }

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

      <div className="px-4 md:px-8 mb-3 flex flex-wrap items-center gap-4">
        <button onClick={() => setReloadKey((k) => k + 1)} className="text-sm underline text-navy-950/70">
          Refresh the list
        </button>
        <button
          disabled={busy || stale.length === 0}
          onClick={() => deleteIds(stale.map((m) => m.id), `${stale.length} stale mandate${stale.length === 1 ? '' : 's'}`)}
          className="text-sm px-3 py-1.5 rounded-md border border-navy-950/20 disabled:opacity-40"
        >
          Clear stale mandates ({stale.length})
        </button>
        <span className="text-xs text-navy-950/50">Stale: cancelled, expired, or never authorised after 24 hours.</span>
      </div>
      {note && (
        <div className={`mx-4 md:mx-8 mb-3 rounded-md text-sm px-4 py-3 ${note.ok ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>{note.text}</div>
      )}

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
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-950/5">
              {!loading && mandates.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-navy-950/50">
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
                    {['approved', 'reinstated'].includes(m.status) && !m.ready_to_debit && (
                      <div className="text-xs text-bad mt-1">Not ready to debit yet. Check this mandate on Mono.</div>
                    )}
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
                  <td className="px-4 py-3 whitespace-nowrap">
                    {isStale(m) && (
                      <button disabled={busy} className="text-bad underline underline-offset-2" onClick={() => deleteIds([m.id], 'this mandate')}>
                        Delete
                      </button>
                    )}
                    {['approved', 'reinstated', 'paused'].includes(m.status) && (
                      m.cancel_requested_by_id ? (
                        <div className="text-xs">
                          <div className="text-navy-950/70">Cancel requested by {m.cancel_requested_by}</div>
                          {m.cancel_requested_by_id !== myId && (
                            <button disabled={busy} className="text-bad underline underline-offset-2 mr-3" onClick={() => cancelMandate(m)}>Confirm cancel</button>
                          )}
                          <button disabled={busy} className="underline underline-offset-2 text-navy-950/70" onClick={() => cancelMandate(m, { withdraw: true })}>Withdraw</button>
                        </div>
                      ) : (
                        <button disabled={busy} className="text-bad underline underline-offset-2" onClick={() => cancelMandate(m)}>
                          {twoPerson ? 'Request cancel' : 'Cancel mandate'}
                        </button>
                      )
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
