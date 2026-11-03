import { useState } from 'react'
import { invokeFn } from '../lib/invokeFn.js'

// Guarded cancel: reason (when starting a request), the word CANCEL typed, and the executive's own password.
// The server re-checks the password and the word; this form is only the front door.
export default function CancelMandateDialog({ mandate, memberName, confirming, twoPerson, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [word, setWord] = useState('')
  const [pw, setPw] = useState('')
  const [force, setForce] = useState(false)
  const [needsForce, setNeedsForce] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const needReason = !confirming
  const ready = word === 'CANCEL' && pw.length > 0 && (!needReason || reason.trim().length >= 3) && (!needsForce || force)

  async function submit(e) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setErr(null)
    const { data, error } = await invokeFn('mono-mandate', {
      action: 'cancel', mandate_id: mandate.id, reason: reason.trim(), confirm_text: word, password: pw, ...(force ? { force: true } : {}),
    })
    let out = data
    if (error) {
      try { out = await error.context.json() } catch (_) { out = { ok: false, message: error.message } }
    }
    setBusy(false)
    if (out?.ok) {
      setPw('')
      return onDone(out.message || 'Done.')
    }
    if (out?.needs_force) setNeedsForce(out.message)
    else setErr(out?.message || 'Something went wrong.')
    setPw('')
  }

  const verb = twoPerson && !confirming ? 'Request cancellation' : 'Cancel this mandate at Mono'
  return (
    <div className="fixed inset-0 z-50 bg-navy-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} autoComplete="off" className="bg-white rounded-md w-full max-w-md p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="font-display font-bold text-navy-950 mb-1">{verb}</h2>
        <p className="text-sm text-navy-950/70 mb-3">
          {memberName || 'This member'}'s mandate will stop working at Mono. This cannot be undone: the member would have to set up a new mandate.
        </p>
        {confirming && (
          <p className="text-sm bg-surface rounded-md px-3 py-2 mb-3">
            Requested by {mandate.cancel_requested_by}: {mandate.cancel_reason || 'no reason given'}
          </p>
        )}
        {needReason && (
          <label className="block text-sm mb-3">
            <span className="block text-navy-950/60 mb-1">Reason (required)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full border border-navy-950/20 rounded-md px-3 py-2" />
          </label>
        )}
        <label className="block text-sm mb-3">
          <span className="block text-navy-950/60 mb-1">Type <b>CANCEL</b> to confirm</span>
          <input value={word} onChange={(e) => setWord(e.target.value)} autoCapitalize="characters" className="w-full border border-navy-950/20 rounded-md px-3 py-2" />
        </label>
        <label className="block text-sm mb-3">
          <span className="block text-navy-950/60 mb-1">Your password</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" className="w-full border border-navy-950/20 rounded-md px-3 py-2" />
        </label>
        {needsForce && (
          <label className="flex items-start gap-2 text-sm mb-3 text-bad">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="mt-1" />
            <span>{needsForce}</span>
          </label>
        )}
        {err && <div className="rounded-md bg-bad/10 text-bad text-sm px-3 py-2 mb-3">{err}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="text-sm px-4 py-2 rounded-md border border-navy-950/20">Keep mandate</button>
          <button type="submit" disabled={!ready || busy} className="text-sm font-medium px-4 py-2 rounded-md bg-bad text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Checking…' : verb}
          </button>
        </div>
      </form>
    </div>
  )
}
