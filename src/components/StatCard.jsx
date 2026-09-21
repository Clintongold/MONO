export default function StatCard({ label, value, hint, tone = 'default' }) {
  const toneClass =
    tone === 'good'
      ? 'text-good'
      : tone === 'bad'
      ? 'text-bad'
      : tone === 'warn'
      ? 'text-warn'
      : 'text-navy-950'

  return (
    <div className="border-t-2 border-navy-900 pt-3">
      <p className="text-sm text-navy-950/60">{label}</p>
      <p className={`font-display font-bold text-3xl tabular mt-1 ${toneClass}`}>
        {value}
      </p>
      {hint && <p className="text-xs text-navy-950/50 mt-1">{hint}</p>}
    </div>
  )
}
