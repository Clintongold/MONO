const STYLES = {
  // schedule / payment statuses
  paid: 'bg-good/10 text-good',
  successful: 'bg-good/10 text-good',
  partial: 'bg-gold-500/10 text-gold-600',
  pending: 'bg-navy-700/10 text-navy-700',
  processing: 'bg-navy-700/10 text-navy-700',
  failed: 'bg-bad/10 text-bad',
  // mandate statuses
  approved: 'bg-good/10 text-good',
  ready_to_debit: 'bg-good/10 text-good',
  initiated: 'bg-navy-700/10 text-navy-700',
  paused: 'bg-gold-500/10 text-gold-600',
  cancelled: 'bg-bad/10 text-bad',
  rejected: 'bg-bad/10 text-bad',
  reinstated: 'bg-good/10 text-good',
  // reconciliation statuses
  draft: 'bg-navy-700/10 text-navy-700',
  exported: 'bg-good/10 text-good',
}

function label(status) {
  return String(status || '').replace(/_/g, ' ')
}

export default function StatusBadge({ status }) {
  const style = STYLES[status] || 'bg-navy-700/10 text-navy-700'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${style}`}
    >
      {label(status)}
    </span>
  )
}
