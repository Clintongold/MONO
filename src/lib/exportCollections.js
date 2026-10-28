// Builds the month's "successful collections" file as CSV or Excel (.xlsx).
// Columns are chosen so the file can be pasted straight into the core ledger.
export const HEADERS = ['INTERNAL ID', 'FULL NAME', 'AMOUNT COLLECTED', 'MONO FEE', 'FEE PAID BY', 'DEBIT DATE', 'MONO REFERENCE']

// A cell starting with = + - @ can run as a formula when opened in Excel; neutralise it.
function safeText(v) {
  const s = v == null ? '' : String(v)
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s
}

function toGrid(rows) {
  return rows.map((r) => [safeText(r.internal_id), safeText(r.full_name), Number(r.amount), r.fee == null ? '' : Number(r.fee), r.fee_paid_by === 'customer' ? 'Member' : 'Cooperative', r.date || '', safeText(r.reference)])
}

export function buildCsv(rows) {
  const q = (v) => {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [HEADERS, ...toGrid(rows)].map((l) => l.map(q).join(','))
  // BOM so Excel opens the file as UTF-8 (names with accents stay correct).
  return '﻿' + lines.join('\r\n') + '\r\n'
}

export async function buildXlsx(rows, sheetName) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(String(sheetName || 'Collections').slice(0, 31))
  ws.addRow(HEADERS).font = { bold: true }
  for (const l of toGrid(rows)) ws.addRow(l)
  ws.columns = [{ width: 16 }, { width: 34 }, { width: 18, style: { numFmt: '#,##0.00' } }, { width: 12, style: { numFmt: '#,##0.00' } }, { width: 14 }, { width: 14 }, { width: 24 }]
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const total = ws.addRow(['', 'TOTAL', rows.reduce((a, r) => a + Number(r.amount), 0), rows.reduce((a, r) => a + Number(r.fee || 0), 0)])
  total.font = { bold: true }
  return await wb.xlsx.writeBuffer()
}

export function download(data, fileName, type) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
