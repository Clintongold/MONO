import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { formatNaira } from '../lib/format.js'

// Splits "SURNAME, FIRST MIDDLE" or "FIRST LAST" into two editable guesses.
// The ledger often lists surname first, so the executive can swap them.
function guessNames(full) {
  const s = String(full || '').trim().replace(/\s+/g, ' ')
  if (s.includes(',')) {
    const [last, rest] = s.split(',').map((x) => x.trim())
    return { first: rest, last }
  }
  const parts = s.split(' ')
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(1).join(' '), last: parts[0] }
}

const today = () => new Date().toISOString().slice(0, 10)
const plusMonths = (n) => {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}

const field = 'w-full border border-navy-950/20 rounded-md px-3 py-2 text-sm'

export default function CreateMandate({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState([])
  const [query, setQuery] = useState('')
  const [member, setMember] = useState(null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || members.length) return
    supabase
      .from('members')
      .select('id, ogfza_member_id, full_name, email, phone, status, mono_customer_id, mandates(status, ready_to_debit)')
      .eq('status', 'active')
      .order('full_name')
      .limit(1000)
      .then(({ data }) => setMembers(data || []))
  }, [open, members.length])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return members
      .filter((m) => m.full_name.toLowerCase().includes(q) || m.ogfza_member_id.toLowerCase().includes(q))
      .slice(0, 8)
  }, [members, query])

  function pick(m) {
    const n = guessNames(m.full_name)
    setMember(m)
    setQuery('')
    setResult(null)
    setMsg(null)
    setForm({
      first_name: n.first,
      last_name: n.last,
      email: m.email || '',
      phone: m.phone || '',
      amount: '',
      start_date: today(),
      end_date: plusMonths(12),
      fee_bearer: 'business',
      existing_customer_id: '',
      new_customer: false,
    })
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(force = false) {
    setBusy(true)
    setMsg(null)
    const amount = Number(String(form.amount).replace(/,/g, ''))
    const { data, error } = await supabase.functions.invoke('mono-mandate', {
      body: { ...form, amount, member_id: member.id, force },
    })
    setBusy(false)
    let out = data
    if (error) {
      try {
        out = await error.context.json()
      } catch (_) {
        out = { ok: false, message: error.message }
      }
    }
    if (out?.needs_force && window.confirm(out.message)) return submit(true)
    if (!out?.ok) {
      setMsg(out?.message || 'Something went wrong.')
      return
    }
    setResult(out)
    onCreated?.()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.authorisation_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {
      window.prompt('Copy this link:', result.authorisation_url)
    }
  }

  if (!open) {
    return (
      <div className="px-4 md:px-8 pb-6">
        <button
          onClick={() => setOpen(true)}
          className="text-sm font-medium px-4 py-2 rounded-md bg-gold-500 text-white hover:bg-gold-600"
        >
          Create mandate
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 md:px-8 pb-6 max-w-3xl">
      <div className="bg-white rounded-md border border-navy-950/10 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-navy-950">Create a mandate</h2>
          <button onClick={() => setOpen(false)} className="text-sm text-navy-950/60 hover:text-navy-950">
            Close
          </button>
        </div>

        {!member && (
          <div>
            <label className="text-sm block mb-1 text-navy-950/60">Find the member (name or internal ID)</label>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className={field} placeholder="e.g. Prudent or OGFZACOOP081" />
            {matches.length > 0 && (
              <ul className="border border-navy-950/10 rounded-md mt-2 divide-y divide-navy-950/5">
                {matches.map((m) => {
                  const has = (m.mandates || []).some((x) => x.ready_to_debit)
                  return (
                    <li key={m.id}>
                      <button onClick={() => pick(m)} className="w-full text-left px-3 py-2 text-sm hover:bg-surface flex justify-between gap-3">
                        <span>{m.full_name} <span className="text-navy-950/40">{m.ogfza_member_id}</span></span>
                        {has && <span className="text-good text-xs">has a ready mandate</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {member && !result && (
          <div>
            <p className="text-sm mb-4">
              <b>{member.full_name}</b> <span className="text-navy-950/40">{member.ogfza_member_id}</span>{' '}
              <button onClick={() => setMember(null)} className="text-navy-950/60 underline ml-2">change</button>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="text-sm"><span className="block text-navy-950/60 mb-1">First name</span>
                <input className={field} value={form.first_name} onChange={set('first_name')} /></label>
              <label className="text-sm"><span className="block text-navy-950/60 mb-1">Last name (surname)</span>
                <input className={field} value={form.last_name} onChange={set('last_name')} /></label>
              <label className="text-sm"><span className="block text-navy-950/60 mb-1">Email</span>
                <input className={field} value={form.email} onChange={set('email')} /></label>
              <label className="text-sm"><span className="block text-navy-950/60 mb-1">Phone</span>
                <input className={field} value={form.phone} onChange={set('phone')} /></label>
              <label className="text-sm sm:col-span-2"><span className="block text-navy-950/60 mb-1">
                Total mandate amount (₦). This is the most that can be collected over the whole period, not per month.</span>
                <input className={field} inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="e.g. 3000000" /></label>
              <label className="text-sm"><span className="block text-navy-950/60 mb-1">Start date</span>
                <input type="date" className={field} value={form.start_date} onChange={set('start_date')} /></label>
              <label className="text-sm"><span className="block text-navy-950/60 mb-1">End date</span>
                <input type="date" className={field} value={form.end_date} onChange={set('end_date')} /></label>
              <label className="text-sm"><span className="block text-navy-950/60 mb-1">Who pays Mono's debit fees</span>
                <select className={field} value={form.fee_bearer} onChange={set('fee_bearer')}>
                  <option value="business">The cooperative (default)</option>
                  <option value="customer">The member (only if Mono has enabled it)</option>
                </select></label>
              <label className="text-sm"><span className="block text-navy-950/60 mb-1">Mono customer ID (only if already registered there)</span>
                <input className={field} value={form.existing_customer_id} onChange={set('existing_customer_id')} /></label>
            </div>
            {member.mono_customer_id && !form.existing_customer_id && (
              <label className="flex items-start gap-2 text-sm mt-4">
                <input type="checkbox" className="mt-1" checked={form.new_customer}
                  onChange={(e) => setForm((f) => ({ ...f, new_customer: e.target.checked }))} />
                <span>
                  Register as a new Mono customer using the names above. This member is already registered on Mono, and by default
                  that saved customer (with its original name) is reused. Tick this only if the name was wrong the first time.
                </span>
              </label>
            )}
            <p className="text-xs text-navy-950/60 mt-3">
              The member's name must match their bank account name exactly. Check the spelling and which name is the surname before creating.
            </p>
            {msg && <p className="rounded-md bg-bad/10 text-bad text-sm px-3 py-2 mt-4">{msg}</p>}
            <button
              disabled={busy || !form.amount}
              onClick={() => submit(false)}
              className="mt-4 text-sm font-medium px-4 py-2 rounded-md bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create mandate and get link'}
            </button>
          </div>
        )}

        {result && (
          <div>
            <p className="text-sm text-good font-medium mb-2">Mandate created for {member.full_name}.</p>
            {result.authorisation_url ? (
              <>
                <p className="text-sm text-navy-950/70 mb-2">Send this link to the member. They open it, enter their account, BVN and date of birth, and make the ₦50 transfer.</p>
                <input readOnly value={result.authorisation_url} className={field} onFocus={(e) => e.target.select()} />
                <div className="flex gap-3 mt-3">
                  <button onClick={copy} className="text-sm font-medium px-4 py-2 rounded-md bg-gold-500 text-white hover:bg-gold-600">
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button onClick={() => { setMember(null); setResult(null) }} className="text-sm px-4 py-2 rounded-md border border-navy-950/20">
                    Create another
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-warn">Mono did not return a link. Find this mandate on Mono's dashboard to copy it ({result.mono_mandate_id}).</p>
            )}
            <p className="text-xs text-navy-950/50 mt-3">Total {formatNaira(form.amount)} from {form.start_date} to {form.end_date}. It shows as ready to debit here once the member completes it.</p>
          </div>
        )}
      </div>
    </div>
  )
}
