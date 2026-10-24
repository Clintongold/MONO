// All dates in this app are shown and built in Lagos time (Africa/Lagos, UTC+1,
// no daylight saving), whatever the viewer's device clock says.
const TZ = 'Africa/Lagos'

export function formatNaira(amount) {
  const value = Number(amount || 0)
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(dateString) {
  if (!dateString) return '—'
  const d = new Date(dateString)
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: TZ,
  }).format(d)
}

export function formatDateTime(dateString) {
  if (!dateString) return '—'
  const d = new Date(dateString)
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(d)
}

export function formatPeriod(dateString) {
  if (!dateString) return '—'
  const d = new Date(dateString)
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  }).format(d)
}

// Today's date in Lagos as "YYYY-MM-DD" (the en-CA locale prints dates in that order).
export function lagosToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// The current month in Lagos as "YYYY-MM".
export function lagosMonth() {
  return lagosToday().slice(0, 7)
}

// Today in Lagos plus n calendar months, as "YYYY-MM-DD". A day that does not
// exist in the target month (for example 31 Jan + 1 month) falls back to the
// last day of that month.
export function lagosPlusMonths(n) {
  const [y, m, d] = lagosToday().split('-').map(Number)
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  const out = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), day))
  return out.toISOString().slice(0, 10)
}
