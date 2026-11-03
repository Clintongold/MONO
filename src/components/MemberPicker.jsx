import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

// Search-by-name picker for choosing one member. Loads the member list once and filters it as you type
// (name or internal ID, any order of words). Members who cannot be debited are shown greyed with the reason.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

function readiness(m) {
  if (m.status !== 'active') return { ok: false, label: m.status || 'not active' }
  const ready = (m.mandates || []).some((x) => x.ready_to_debit && ['approved', 'reinstated'].includes(x.status))
  return ready ? { ok: true, label: 'Ready to debit' } : { ok: false, label: 'No ready mandate' }
}

export default function MemberPicker({ value, onSelect, disabled }) {
  const [members, setMembers] = useState([])
  const [loadErr, setLoadErr] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef(null)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('members')
        .select('id, full_name, ogfza_member_id, status, mandates(status, ready_to_debit)')
        .order('full_name', { ascending: true })
        .limit(1000)
      if (error) setLoadErr(error.message)
      else setMembers(data || [])
    })()
  }, [])

  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close) }
  }, [])

  const results = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean)
    if (!words.length) return []
    return members
      .filter((m) => {
        const hay = norm(m.full_name) + ' ' + norm(m.ogfza_member_id)
        return words.every((w) => hay.includes(w))
      })
      .sort((a, b) => Number(readiness(b).ok) - Number(readiness(a).ok))
      .slice(0, 8)
  }, [members, q])

  const chosen = useMemo(
    () => (value ? members.find((m) => m.ogfza_member_id === String(value).toUpperCase()) : null),
    [members, value],
  )

  function pick(m) {
    if (!readiness(m).ok) return
    onSelect(m)
    setQ('')
    setOpen(false)
  }

  function onKey(e) {
    if (!open || !results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) pick(results[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  if (chosen) {
    const r = readiness(chosen)
    return (
      <div className="rounded-md border border-navy-950/20 px-3 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-navy-950 truncate">{chosen.full_name}</div>
          <div className="text-xs text-navy-950/60">{chosen.ogfza_member_id} · <span className={r.ok ? 'text-good' : 'text-bad'}>{r.label}</span></div>
        </div>
        <button type="button" disabled={disabled} onClick={() => onSelect(null)} className="text-xs text-navy-950/60 underline shrink-0">
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={box}>
      <input
        value={q}
        disabled={disabled}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Type a name or ID, e.g. Alabo"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="member-results"
        className="w-full border border-navy-950/20 rounded-md px-3 py-2"
      />
      {loadErr && <div className="text-xs text-bad mt-1">Could not load members: {loadErr}</div>}
      {open && q.trim() && (
        <ul id="member-results" role="listbox" className="absolute z-20 left-0 right-0 mt-1 bg-white border border-navy-950/20 rounded-md shadow-lg max-h-72 overflow-y-auto">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-navy-950/50">No member matches "{q}".</li>}
          {results.map((m, i) => {
            const r = readiness(m)
            return (
              <li
                key={m.id}
                role="option"
                aria-selected={i === active}
                aria-disabled={!r.ok}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(m)}
                className={`px-3 py-2 text-sm flex items-center justify-between gap-3 ${r.ok ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'} ${i === active && r.ok ? 'bg-surface' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block font-medium text-navy-950 truncate">{m.full_name}</span>
                  <span className="block text-xs text-navy-950/60">{m.ogfza_member_id}</span>
                </span>
                <span className={`text-xs shrink-0 ${r.ok ? 'text-good' : 'text-bad'}`}>{r.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
