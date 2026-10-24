import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import TopBar from '../components/TopBar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { formatNaira, formatDate, formatDateTime, formatPeriod } from '../lib/format.js'

// ---------------------------------------------------------------- CSV reading
// Reads the CSV downloaded from the PAYROLL_CURRENT tab. Rows may come in any
// order. It finds the header row by name, so the summary block above the table
// and any extra columns are ignored.
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  row.push(cell)
  rows.push(row)
  return rows
}

function cleanAmount(v) {
  return String(v ?? '').replace(/[₦,\s]/g, '').replace(/^NGN/i, '')
}

function readSchedule(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''))
  const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  const headerIdx = rows.findIndex((r) => {
    const h = r.map(norm)
    return h.includes('INTERNAL ID') && h.includes('TOTAL DEDUCTION')
  })
  if (headerIdx < 0) {
    throw new Error('Could not find the columns "INTERNAL ID" and "TOTAL DEDUCTION". Download the PAYROLL_CURRENT tab as CSV and try again.')
  }
  const h = rows[headerIdx].map(norm)
  const iId = h.indexOf('INTERNAL ID')
  const iAmt = h.indexOf('TOTAL DEDUCTION')
  const iName = h.indexOf('FULL NAME')
  const iMonth = h.indexOf('PAYROLL MONTH')
  const out = []
  let month = null
  for (const r of rows.slice(headerIdx + 1)) {
    const id = String(r[iId] ?? '').trim()
    if (!id) continue
    if (!month && iMonth >= 0) month = guessMonth(r[iMonth])
    out.push({ internal_id: id, full_name: iName >= 0 ? r[iName] : null, amount: cleanAmount(r[iAmt]) })
  }
  return { rows: out, month }
}

// Returns "YYYY-MM" from "2026-11-26", "26/11/2026", "11/26/2026" or "Nov2026", else null.
function guessMonth(v) {
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-\d{2}/)
  if (m) return `${m[1]}-${m[2]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const a = +m[1], b = +m[2]
    const month = a > 12 ? b : b > 12 ? a : null // ambiguous (both <= 12): let the user pick
    return month ? `${m[3]}-${String(month).padStart(2, '0')}` : null
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\s*(\d{4})$/)
  if (m) {
    const i = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(m[1].toLowerCase())
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`
  }
  return null
}

// ----------------------------------------------------------------- small UI
function Card({ title, children, right }) {
  return (
    <section className="bg-white rounded-md border border-navy-950/10 mb-6">
      <div className="flex items-center justify-between px-5 py-4 border-b border-navy-950/10">
        <h2 className="font-display font-bold text-navy-950">{title}</h2>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Button({ children, tone = 'navy', ...props }) {
  const tones = {
    navy: 'bg-navy-900 text-white hover:bg-navy-800',
    gold: 'bg-gold-500 text-white hover:bg-gold-600',
    plain: 'bg-white border border-navy-950/20 text-navy-950 hover:bg-surface',
    danger: 'bg-white border border-bad/40 text-bad hover:bg-bad/5',
  }
  return (
    <button
      {...props}
      className={`text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-md bg-surface px-4 py-3">
      <p className="text-xs text-navy-950/60">{label}</p>
      <p className="font-display font-bold text-lg text-navy-950">{value}</p>
      {sub && <p className="text-xs text-navy-950/50">{sub}</p>}
    </div>
  )
}

const sum = (rows) => rows.reduce((t, r) => t + Number(r.amount || 0), 0)

// --------------------------------------------------------------------- page
export default function MonthlySchedule() {
  const [settings, setSettings] = useState(null)
  const [batches, setBatches] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [rows, setRows] = useState([])
  const [schedules, setSchedules] = useState([])
  const [tab, setTab] = useState('will_debit')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [parsed, setParsed] = useState(null) // { fileName, rows }

  const [mIdent, setMIdent] = useState('')
  const [mAmount, setMAmount] = useState('')
  const [mNote, setMNote] = useState('')
  const [mRetry, setMRetry] = useState(false)

  const selected = batches.find((b) => b.id === selectedId) || null

  const loadBatches = useCallback(async () => {
    const [{ data: s }, { data: b, error }] = await Promise.all([
      supabase.from('debit_settings').select('*').maybeSingle(),
      supabase.from('schedule_batches').select('*').order('uploaded_at', { ascending: false }).limit(30),
    ])
    setSettings(s)
    if (error) setMsg({ ok: false, text: error.message })
    setBatches(b || [])
    return b || []
  }, [])

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setRows([])
      setSchedules([])
      return
    }
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from('batch_rows').select('*').eq('batch_id', id).order('internal_id').limit(2000),
      supabase
        .from('payment_schedules')
        .select('*, members(full_name, ogfza_member_id), payments(status, failure_category, response_code, attempted_at)')
        .eq('batch_id', id)
        .limit(2000),
    ])
    setRows(r || [])
    setSchedules(s || [])
  }, [])

  useEffect(() => {
    loadBatches().then((b) => {
      const first = b.find((x) => x.kind === 'bulk') || b[0]
      if (first) setSelectedId(first.id)
    })
  }, [loadBatches])

  useEffect(() => {
    loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const groups = useMemo(
    () => ({
      will_debit: rows.filter((r) => r.state === 'will_debit'),
      discarded: rows.filter((r) => r.state === 'discarded'),
      problem: rows.filter((r) => r.state === 'problem'),
    }),
    [rows],
  )

  async function run(label, fn) {
    setBusy(true)
    setMsg(null)
    try {
      const text = await fn()
      setMsg({ ok: true, text: text || label + ' done.' })
    } catch (e) {
      setMsg({ ok: false, text: e.message || String(e) })
    }
    setBusy(false)
  }

  async function onFile(e) {
    const f = e.target.files?.[0]
    setParsed(null)
    setMsg(null)
    if (!f) return
    try {
      const { rows: r, month: m } = readSchedule(await f.text())
      if (r.length === 0) throw new Error('No member rows found in that file.')
      if (m) setMonth(m)
      setParsed({ fileName: f.name, rows: r })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  const upload = () =>
    run('Upload', async () => {
      const { data, error } = await supabase.rpc('stage_schedule', {
        p_period: month + '-01',
        p_file_name: parsed.fileName,
        p_rows: parsed.rows,
      })
      if (error) throw error
      setParsed(null)
      await loadBatches()
      setSelectedId(data)
      setTab('will_debit')
      return 'Uploaded. Check the preview below, then approve.'
    })

  const approve = () => {
    const n = groups.will_debit.length
    const ok = window.confirm(
      `Approve ${n} debits totalling ${formatNaira(sum(groups.will_debit))}?\n\n` +
        `Debits run from ${formatDate(selected.window_start)} to ${formatDate(selected.window_end)}, ` +
        `only when the debit switch is ON.`,
    )
    if (!ok) return
    return run('Approval', async () => {
      const { data, error } = await supabase.rpc('approve_batch', { p_batch_id: selected.id })
      if (error) throw error
      await loadBatches()
      await loadDetail(selected.id)
      return `Approved ${data} debits.`
    })
  }

  const cancel = () => {
    if (!window.confirm('Cancel this schedule? No further debits will start from it.')) return
    return run('Cancel', async () => {
      const { error } = await supabase.rpc('cancel_batch', { p_batch_id: selected.id })
      if (error) throw error
      await loadBatches()
      return 'Schedule cancelled.'
    })
  }

  const toggleSwitch = () => {
    const turnOn = !settings.debits_enabled
    const ok = window.confirm(
      turnOn
        ? 'Turn debits ON? Approved schedules will start debiting members at the next debit hour.'
        : 'Turn debits OFF? Nothing new will be debited until you turn it back on.',
    )
    if (!ok) return
    return run('Switch', async () => {
      const { error } = await supabase.rpc('set_debits_enabled', { p_on: turnOn })
      if (error) throw error
      await loadBatches()
      return turnOn ? 'Debits are ON.' : 'Debits are OFF.'
    })
  }

  const manualDebit = () => {
    const amt = Number(String(mAmount).replace(/,/g, ''))
    const ok = window.confirm(
      `Debit ${formatNaira(amt)} from ${mIdent.trim().toUpperCase()} now?` +
        (mRetry ? '\n\nAuto-retry is ON: failures for insufficient funds retry at the daily slots until month end.' : ''),
    )
    if (!ok) return
    return run('Manual debit', async () => {
      const { data: id, error } = await supabase.rpc('create_manual_debit', {
        p_internal_id: mIdent,
        p_amount: amt,
        p_note: mNote || null,
        p_auto_retry: mRetry,
      })
      if (error) throw error
      const { data, error: fe } = await supabase.functions.invoke('mono-debit', { body: { schedule_id: id } })
      if (fe) {
        let detail = fe.message
        try {
          detail = (await fe.context.json()).message || detail
        } catch (_) { /* keep default */ }
        throw new Error('The debit was recorded but not started: ' + detail)
      }
      setMIdent('')
      setMAmount('')
      setMNote('')
      await loadBatches()
      return 'Result: ' + (data?.result || 'sent') + '. The final result arrives from Mono shortly.'
    })
  }

  const list = groups[tab] || []
  const isDraft = selected?.status === 'draft'

  return (
    <div>
      <TopBar
        title="Monthly schedule"
        description="Upload the month's deductions, preview who can be debited, approve, and track the results."
      />

      <div className="px-4 md:px-8 pb-10 max-w-6xl">
        {msg && (
          <div className={`rounded-md text-sm px-4 py-3 mb-6 ${msg.ok ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>
            {msg.text}
          </div>
        )}

        {settings && (
          <Card
            title="Debit switch"
            right={
              <Button tone={settings.debits_enabled ? 'danger' : 'gold'} disabled={busy} onClick={toggleSwitch}>
                {settings.debits_enabled ? 'Turn OFF' : 'Turn ON'}
              </Button>
            }
          >
            <p className="text-sm text-navy-950/80">
              Debits are{' '}
              <span className={`font-semibold ${settings.debits_enabled ? 'text-good' : 'text-bad'}`}>
                {settings.debits_enabled ? 'ON' : 'OFF'}
              </span>
              . Debit hours (Lagos time): {settings.retry_hours.slice(0, settings.attempts_per_day).map((h) => `${h}:00`).join(', ')}.
              Window starts on day {settings.start_day} of the month and ends on its last day.
              Only insufficient-funds failures are retried automatically.
            </p>
          </Card>
        )}

        <Card title="1. Upload the month's schedule">
          <p className="text-sm text-navy-950/70 mb-4">
            In the ledger, open <b>PAYROLL_CURRENT</b> for the month, then File, Download, <b>CSV</b>. Upload that file here.
            Row order does not matter. Only the internal ID, name and total deduction are used.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="block text-navy-950/60 mb-1">File</span>
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-navy-950/60 mb-1">Month</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border border-navy-950/20 rounded-md px-3 py-2 text-sm"
              />
            </label>
            <Button disabled={!parsed || busy} onClick={upload}>
              Upload and preview
            </Button>
          </div>
          {parsed && (
            <p className="text-sm text-navy-950/70 mt-3">
              {parsed.fileName}: {parsed.rows.length} rows, total {formatNaira(sum(parsed.rows.map((r) => ({ amount: r.amount }))))} for{' '}
              <b>{formatPeriod(month + '-01')}</b>. Check the month before uploading.
            </p>
          )}
        </Card>

        <Card
          title="2. Preview and approve"
          right={
            batches.length > 0 && (
              <select
                value={selectedId || ''}
                onChange={(e) => setSelectedId(e.target.value)}
                className="border border-navy-950/20 rounded-md px-2 py-1.5 text-sm"
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.kind === 'manual' ? 'Manual' : formatPeriod(b.period)} · {b.status} · {formatDateTime(b.uploaded_at)}
                  </option>
                ))}
              </select>
            )
          }
        >
          {!selected && <p className="text-sm text-navy-950/60">Nothing uploaded yet.</p>}
          {selected && (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <StatusBadge status={selected.status} />
                <span className="text-sm text-navy-950/70">
                  Debit window {formatDate(selected.window_start)} to {formatDate(selected.window_end)}
                  {selected.approved_by && ` · approved by ${selected.approved_by}`}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <Stat label="Will be debited" value={groups.will_debit.length} sub={formatNaira(sum(groups.will_debit))} />
                <Stat label="Discarded (no ready mandate etc.)" value={groups.discarded.length} sub={formatNaira(sum(groups.discarded))} />
                <Stat label="Problems (need a look)" value={groups.problem.length} sub={formatNaira(sum(groups.problem))} />
              </div>

              <div className="flex gap-2 mb-3 border-b border-navy-950/10">
                {[
                  ['will_debit', 'Will be debited'],
                  ['discarded', 'Discarded'],
                  ['problem', 'Problems'],
                ].map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                      tab === k ? 'border-gold-500 text-navy-950' : 'border-transparent text-navy-950/50'
                    }`}
                  >
                    {l} ({groups[k].length})
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                      <th className="py-2 pr-4 font-medium">Internal ID</th>
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 pr-4 font-medium text-right">Amount</th>
                      {tab !== 'will_debit' && <th className="py-2 font-medium">Reason</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-950/5">
                    {list.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-navy-950/50">Nothing here.</td>
                      </tr>
                    )}
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-4">{r.internal_id}</td>
                        <td className="py-2 pr-4">{r.full_name}</td>
                        <td className="py-2 pr-4 text-right">{r.amount == null ? '—' : formatNaira(r.amount)}</td>
                        {tab !== 'will_debit' && <td className="py-2 text-navy-950/70">{r.reason}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {isDraft && (
                <div className="flex gap-3 mt-5">
                  <Button tone="gold" disabled={busy || groups.will_debit.length === 0} onClick={approve}>
                    Approve {groups.will_debit.length} debits
                  </Button>
                  <Button tone="danger" disabled={busy} onClick={cancel}>
                    Discard this upload
                  </Button>
                </div>
              )}
              {selected.status === 'approved' && selected.kind === 'bulk' && (
                <div className="mt-5">
                  <Button tone="danger" disabled={busy} onClick={cancel}>
                    Cancel this schedule
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>

        {schedules.length > 0 && (
          <Card title="3. Progress">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-navy-950/50 border-b border-navy-950/10">
                    <th className="py-2 pr-4 font-medium">Member</th>
                    <th className="py-2 pr-4 font-medium text-right">Expected</th>
                    <th className="py-2 pr-4 font-medium text-right">Collected</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Attempts</th>
                    <th className="py-2 font-medium">Last result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-950/5">
                  {schedules.map((s) => {
                    const p = [...(s.payments || [])].sort((a, b) => String(b.attempted_at).localeCompare(String(a.attempted_at)))
                    const last = p[0]
                    const stale =
                      last?.status === 'processing' && Date.now() - new Date(last.attempted_at).getTime() > 3 * 3600_000
                    return (
                      <tr key={s.id}>
                        <td className="py-2 pr-4">
                          {s.members?.full_name} <span className="text-navy-950/40">{s.members?.ogfza_member_id}</span>
                        </td>
                        <td className="py-2 pr-4 text-right">{formatNaira(s.total_expected)}</td>
                        <td className="py-2 pr-4 text-right">{formatNaira(s.total_collected)}</td>
                        <td className="py-2 pr-4"><StatusBadge status={s.status} /></td>
                        <td className="py-2 pr-4">{p.length}</td>
                        <td className="py-2 text-navy-950/70">
                          {last
                            ? `${last.status}${last.failure_category ? ' · ' + last.failure_category.replace(/_/g, ' ') : ''}${
                                last.response_code ? ' (' + last.response_code + ')' : ''
                              }`
                            : 'not attempted'}
                          {stale && <span className="text-warn"> · no final result from Mono for 3h+, check Mono</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card title="One-off debit for a single member">
          <p className="text-sm text-navy-950/70 mb-4">
            Debits one member a chosen amount straight away. The member needs a ready mandate. This does not touch the monthly schedule.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <label className="text-sm">
              <span className="block text-navy-950/60 mb-1">Internal ID</span>
              <input value={mIdent} onChange={(e) => setMIdent(e.target.value)} placeholder="OGFZACOOP081"
                className="w-full border border-navy-950/20 rounded-md px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-navy-950/60 mb-1">Amount (₦)</span>
              <input value={mAmount} onChange={(e) => setMAmount(e.target.value)} inputMode="decimal" placeholder="5000"
                className="w-full border border-navy-950/20 rounded-md px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-navy-950/60 mb-1">Note (optional)</span>
              <input value={mNote} onChange={(e) => setMNote(e.target.value)}
                className="w-full border border-navy-950/20 rounded-md px-3 py-2" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm mb-4">
            <input type="checkbox" checked={mRetry} onChange={(e) => setMRetry(e.target.checked)} />
            Auto-retry on insufficient funds (same daily slots, until month end)
          </label>
          <Button tone="gold" disabled={busy || !mIdent.trim() || !(Number(String(mAmount).replace(/,/g, '')) > 0)} onClick={manualDebit}>
            Debit now
          </Button>
        </Card>
      </div>
    </div>
  )
}
