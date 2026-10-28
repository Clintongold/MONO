import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { readScheduleFile } from '../lib/readSchedule.js'
import TopBar from '../components/TopBar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { formatNaira, formatDate, formatDateTime, formatPeriod, lagosMonth, lagosToday } from '../lib/format.js'

// ----------------------------------------------------------------- small UI
function Card({ title, children, right }) {
  return (
    <section className="bg-white rounded-md border border-navy-950/10 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-navy-950/10">
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
  const { user } = useAuth()
  const [needsSecond, setNeedsSecond] = useState(false) // two-person rule in force?
  const [settings, setSettings] = useState(null)
  const [batches, setBatches] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [rows, setRows] = useState([])
  const [schedules, setSchedules] = useState([])
  const [tab, setTab] = useState('will_debit')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  const [month, setMonth] = useState(lagosMonth())
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
    const { data: ns } = await supabase.rpc('needs_second_approver')
    setNeedsSecond(ns === true)
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
      setMsg({ ok: true, text: 'Reading the file…' })
      const { rows: r, month: m, sheet } = await readScheduleFile(f)
      setMsg(null)
      if (m) setMonth(m)
      setParsed({ fileName: f.name, rows: r, sheet })
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

  // After a one-off is approved: find its schedule and start the debit.
  async function startApprovedBatch(batchId) {
    const { data: br, error } = await supabase.from('batch_rows').select('schedule_id').eq('batch_id', batchId).maybeSingle()
    if (error || !br?.schedule_id) throw new Error('could not find the approved debit')
    return startDebit(br.schedule_id)
  }

  const approve = () => {
    const isManual = selected.kind === 'manual'
    const n = groups.will_debit.length
    const total = Math.round(sum(groups.will_debit) * 100) / 100
    const first = groups.will_debit[0]
    const ok = window.confirm(
      isManual
        ? `Approve and debit ${formatNaira(total)} from ${first?.full_name} (${first?.internal_id}) now?`
        : `Approve ${n} debits totalling ${formatNaira(total)}?\n\n` +
            `Debits run from ${formatDate(selected.window_start)} to ${formatDate(selected.window_end)}, ` +
            `only when the debit switch is ON.`,
    )
    if (!ok) return
    return run('Approval', async () => {
      if (isManual && !settings?.debits_enabled) throw new Error('Debits are switched OFF. Turn the debit switch ON first, then approve.')
      // The count and total you were shown are sent too: the database refuses if the upload changed since.
      const { data, error } = await supabase.rpc('approve_batch', {
        p_batch_id: selected.id,
        p_expected_count: n,
        p_expected_total: total,
      })
      if (error) throw error
      await loadBatches()
      await loadDetail(selected.id)
      if (!isManual) return `Approved ${data} debits.`
      let r
      try {
        r = await startApprovedBatch(selected.id)
      } catch (e) {
        throw new Error(`Approved, but the debit was not started (${e.message}). Press "Start debit" under Progress when ready.`)
      }
      await loadDetail(selected.id)
      return `Approved. Result: ${r}. The final result arrives from Mono shortly.`
    })
  }

  const reject = () => {
    const reason = window.prompt('Why are you rejecting this? The person who prepared it will see your reason.')
    if (reason === null) return
    if (reason.trim().length < 3) {
      setMsg({ ok: false, text: 'A reason is required to reject (a few words at least).' })
      return
    }
    return run('Reject', async () => {
      const { error } = await supabase.rpc('reject_batch', { p_batch_id: selected.id, p_reason: reason })
      if (error) throw error
      await loadBatches()
      return 'Rejected and sent back to the person who prepared it.'
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

  // Starts one manual debit by calling the server with only the schedule id.
  // The server works out the amount from the schedule row; nothing numeric is sent.
  async function startDebit(scheduleId) {
    const { data, error } = await supabase.functions.invoke('mono-debit', { body: { schedule_id: scheduleId } })
    if (error) {
      let detail = error.message
      try {
        detail = (await error.context.json()).message || detail
      } catch (_) { /* keep default */ }
      throw new Error(detail)
    }
    return data?.result || 'sent'
  }

  const manualDebit = () =>
    run('Manual debit', async () => {
      // One cleaned-up ID, used for the lookup, the confirm box and the database call.
      const ident = mIdent.trim().toUpperCase()
      const amt = Number(String(mAmount).replace(/,/g, ''))
      if (!ident) throw new Error('Enter the member\'s internal ID.')
      if (!(amt > 0)) throw new Error('Enter an amount above zero.')

      // Look the member up first so nothing is created for a wrong ID or a member with no ready mandate.
      const { data: m, error: me } = await supabase
        .from('members')
        .select('full_name, ogfza_member_id, status, mandates(status, ready_to_debit)')
        .eq('ogfza_member_id', ident)
        .maybeSingle()
      if (me) throw me
      if (!m) throw new Error(`No member found with the internal ID ${ident}. Nothing was created.`)
      if (m.status !== 'active') throw new Error(`${m.full_name} (${ident}) is ${m.status}. Nothing was created.`)
      const ready = (m.mandates || []).some((x) => x.ready_to_debit && ['approved', 'reinstated'].includes(x.status))
      if (!ready) throw new Error(`${m.full_name} (${ident}) has no ready-to-debit mandate yet. Nothing was created.`)

      const ok = window.confirm(
        `${needsSecond ? 'Prepare a debit of' : 'Debit'} ${formatNaira(amt)} ${needsSecond ? 'for' : 'from'} ${m.full_name} (${ident})?` +
          (needsSecond ? '\n\nA different executive will have to approve it before it is debited.' : '') +
          (mRetry ? '\n\nAuto-retry is ON: failures for insufficient funds retry at the daily slots until month end.' : ''),
      )
      if (!ok) return 'Cancelled. Nothing was created.'

      const { data: batchId, error } = await supabase.rpc('create_manual_debit', {
        p_internal_id: ident,
        p_amount: amt,
        p_note: mNote || null,
        p_auto_retry: mRetry,
      })
      if (error) throw error

      await loadBatches()
      setSelectedId(batchId)
      setTab('will_debit')
      setMIdent('')
      setMAmount('')
      setMNote('')

      if (needsSecond) {
        return `Prepared. A different executive must now open "2. Preview and approve", check it and approve it before ${m.full_name} is debited.`
      }

      // Only one executive exists, so there is nobody else to approve: approve and start now.
      if (!settings?.debits_enabled) throw new Error('Prepared, but debits are switched OFF. Turn the debit switch ON, then approve it under "2. Preview and approve".')
      const { error: ae } = await supabase.rpc('approve_batch', { p_batch_id: batchId, p_expected_count: 1, p_expected_total: amt })
      if (ae) throw ae
      let result
      try {
        result = await startApprovedBatch(batchId)
      } catch (e) {
        throw new Error(
          `The debit was approved but not started (${e.message}). Find it under "3. Progress" and press "Start debit" when ready. It will not be created twice.`,
        )
      }
      await loadBatches()
      await loadDetail(batchId)
      return `Result: ${result}. The final result arrives from Mono shortly.`
    })

  const startFromRow = (scheduleId) =>
    run('Start debit', async () => {
      if (!window.confirm('Start this debit now?')) return 'Cancelled.'
      const r = await startDebit(scheduleId)
      await loadDetail(selected.id)
      return `Result: ${r}. The final result arrives from Mono shortly.`
    })

  // Errors in the file: show them first, so nobody has to hunt.
  useEffect(() => {
    if (rows.length === 0) return
    setTab(rows.some((r) => r.state === 'problem') ? 'problem' : 'will_debit')
  }, [selectedId, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = groups[tab] || []
  const isDraft = selected?.status === 'draft'
  const mine = Boolean(selected && user && selected.uploaded_by_id === user.id)
  const blocked = isDraft && needsSecond && mine // two-person rule: you cannot approve what you prepared
  const waiting = batches.filter((b) => b.status === 'draft')
  // The newest rejection of something I prepared, within the last 7 days.
  const rejectedMine = batches.find(
    (b) => b.status === 'rejected' && b.uploaded_by_id === user?.id && Date.now() - new Date(b.rejected_at).getTime() < 7 * 86400_000,
  )

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

        {rejectedMine && (
          <div className="rounded-md bg-bad/10 text-bad text-sm px-4 py-3 mb-6 flex flex-wrap items-center justify-between gap-3">
            <span>
              Your upload for {rejectedMine.kind === 'manual' ? 'a one-off debit' : formatPeriod(rejectedMine.period)} was rejected by{' '}
              {rejectedMine.rejected_by}: {rejectedMine.rejected_reason}. Fix it at the source and upload again.
            </span>
            <Button tone="plain" onClick={() => setSelectedId(rejectedMine.id)}>
              View
            </Button>
          </div>
        )}

        {waiting.length > 0 && (
          <div className="rounded-md bg-gold-100 text-gold-600 text-sm px-4 py-3 mb-6 flex flex-wrap items-center justify-between gap-3">
            <span>
              {waiting.length} item{waiting.length === 1 ? ' is' : 's are'} waiting for approval
              {needsSecond ? ' by a different executive from the one who prepared it.' : '.'}
            </span>
            <Button tone="plain" onClick={() => setSelectedId((waiting.find((b) => b.uploaded_by_id !== user?.id) || waiting[0]).id)}>
              Review
            </Button>
          </div>
        )}

        <Card title="1. Upload the month's schedule">
          <p className="text-sm text-navy-950/70 mb-4">
            Upload the <b>PAYROLL_CURRENT</b> tab for the month as an <b>Excel (.xlsx)</b> or <b>CSV</b> file. It needs the headers
            <b> INTERNAL ID</b> and <b>TOTAL DEDUCTION</b> (and FULL NAME). Row order does not matter and other columns are ignored.
            If an Excel workbook has several sheets, the one named PAYROLL_CURRENT is used.
            An optional <b>ON LOAN</b> column (YES or NO) says who pays Mono's fee: YES, the member; NO or blank, the cooperative.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="block text-navy-950/60 mb-1">File</span>
              <input
                type="file"
                accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={onFile}
                className="text-sm"
              />
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
              {parsed.fileName}{parsed.sheet ? ` (sheet ${parsed.sheet})` : ''}: {parsed.rows.length} rows, total {formatNaira(sum(parsed.rows.map((r) => ({ amount: r.amount }))))} for{' '}
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
                    {b.kind === 'manual' ? 'One-off' : formatPeriod(b.period)} · {b.status === 'draft' ? 'waiting for approval' : b.status} · {formatDateTime(b.uploaded_at)}
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
                {isDraft && <span className="text-sm font-medium text-warn">waiting for approval</span>}
                <span className="text-sm text-navy-950/70">
                  {selected.uploaded_by && `Prepared by ${selected.uploaded_by} · `}Debit window {formatDate(selected.window_start)} to {formatDate(selected.window_end)}
                  {selected.approved_by && ` · approved by ${selected.approved_by}`}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <Stat label="Will be debited" value={groups.will_debit.length} sub={formatNaira(sum(groups.will_debit))} />
                <Stat label="Not debited this month" value={groups.discarded.length} sub={formatNaira(sum(groups.discarded))} />
                <Stat label="Errors in the file" value={groups.problem.length} sub={formatNaira(sum(groups.problem))} />
              </div>

              {groups.will_debit.length > 0 && (() => {
                const memberPays = groups.will_debit.filter((r) => r.fee_bearer === 'customer')
                const coopPays = groups.will_debit.length - memberPays.length
                return (
                  <div className="rounded-md bg-navy-950/5 text-navy-950 text-sm px-4 py-3 mb-4">
                    <b>Mono fee:</b> {memberPays.length} member{memberPays.length === 1 ? '' : 's'} pay it (ON LOAN is YES in the file), the cooperative
                    pays it for {coopPays}. The "Fee paid by" column shows each row.
                    {memberPays.length > 0 && !settings?.allow_customer_fee && (
                      <div className="text-bad mt-1">
                        Member-paid fees are not switched on yet, so those {memberPays.length} debits will NOT be sent until they are.
                      </div>
                    )}
                  </div>
                )
              })()}

              {isDraft && groups.problem.length > 0 && (
                <div className="rounded-md bg-bad/10 text-bad text-sm px-4 py-3 mb-4">
                  <b>{groups.problem.length} error{groups.problem.length === 1 ? '' : 's'} in the file.</b> Approval is blocked until
                  they are fixed in the ledger and the file is uploaded again. The Errors tab shows the row and what is wrong with it.
                </div>
              )}
              {isDraft && groups.discarded.length > 0 && groups.problem.length === 0 && (
                <p className="text-sm text-navy-950/60 mb-4">
                  {groups.discarded.length} member{groups.discarded.length === 1 ? ' is' : 's are'} not being debited this month
                  ({formatNaira(sum(groups.discarded))}). That does not hold anything up. The "Not debited" tab says why for each.
                </p>
              )}
              {selected.status === 'rejected' && (
                <div className="rounded-md bg-bad/10 text-bad text-sm px-4 py-3 mb-4">
                  Rejected by {selected.rejected_by}: {selected.rejected_reason}
                </div>
              )}

              <div className="flex gap-2 mb-3 border-b border-navy-950/10">
                {[
                  ['will_debit', 'Will be debited'],
                  ['discarded', 'Not debited'],
                  ['problem', 'Errors'],
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
                      <th className="py-2 pr-4 font-medium">Row</th>
                      <th className="py-2 pr-4 font-medium">Internal ID</th>
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 pr-4 font-medium text-right">Amount</th>
                      {tab === 'will_debit' && <th className="py-2 font-medium">Fee paid by</th>}
                      {tab !== 'will_debit' && <th className="py-2 font-medium">Reason</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-950/5">
                    {list.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-navy-950/50">Nothing here.</td>
                      </tr>
                    )}
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-4 text-navy-950/50">{r.row_no ?? '—'}</td>
                        <td className="py-2 pr-4">{r.internal_id || '—'}</td>
                        <td className="py-2 pr-4">{r.full_name}</td>
                        <td className="py-2 pr-4 text-right">{r.amount == null ? '—' : formatNaira(r.amount)}</td>
                        {tab === 'will_debit' && (
                          <td className="py-2 text-navy-950/70">{r.fee_bearer === 'customer' ? 'Member' : 'Cooperative'}</td>
                        )}
                        {tab !== 'will_debit' && <td className="py-2 text-navy-950/70">{r.reason}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {blocked && (
                <p className="rounded-md bg-gold-100 text-gold-600 text-sm px-3 py-2 mt-5">
                  You prepared this, so a different executive must check and approve it. Ask one of them to open this page.
                </p>
              )}
              {isDraft && (
                <div className="flex flex-wrap gap-3 mt-5">
                  <Button tone="gold" disabled={busy || blocked || groups.problem.length > 0 || groups.will_debit.length === 0} onClick={approve}>
                    {selected.kind === 'manual' ? 'Approve and debit now' : `Approve ${groups.will_debit.length} debits`}
                  </Button>
                  {!mine && (
                    <Button tone="danger" disabled={busy} onClick={reject}>
                      Reject
                    </Button>
                  )}
                  <Button tone="plain" disabled={busy} onClick={cancel}>
                    {selected.kind === 'manual' ? 'Discard this one-off' : 'Discard this upload'}
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
                    <th className="py-2 pr-4 font-medium">Last result</th>
                    <th className="py-2 font-medium">Action</th>
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
                        <td className="py-2 pr-4 text-navy-950/70">
                          {last
                            ? `${last.status}${last.failure_category ? ' · ' + last.failure_category.replace(/_/g, ' ') : ''}${
                                last.response_code ? ' (' + last.response_code + ')' : ''
                              }`
                            : 'not attempted'}
                          {stale && <span className="text-warn"> · no final result from Mono for 3h+, check Mono</span>}
                        </td>
                        <td className="py-2">
                          {s.kind === 'manual' && s.status === 'pending' && p.length === 0 && selected?.status === 'approved' &&
                            selected.window_end >= lagosToday() && (
                              <Button tone="gold" disabled={busy} onClick={() => startFromRow(s.id)}>
                                Start debit
                              </Button>
                            )}
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
