// Reads the month's schedule from a CSV or an Excel file (.xlsx / .xlsm).
// Rows may come in any order and extra columns are ignored: the header row is
// found by name (INTERNAL ID and TOTAL DEDUCTION, plus FULL NAME and PAYROLL MONTH
// when present), so the summary block above the table is skipped too.
//
// Every returned row carries "row": its line number in the file, which matches
// the sheet row number, so an error can be traced straight to the ledger.

const MAX_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 20000
const PREFERRED_SHEET = 'PAYROLL_CURRENT'

// ------------------------------------------------------------------- CSV
export function parseCsv(text) {
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

// Turns a cell into the plain text of an amount: "₦15,000" -> "15000".
// A real number from Excel is rounded to kobo to remove floating-point dust.
function cleanAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : ''
  return String(v ?? '').replace(/[₦,\s]/g, '').replace(/^NGN/i, '')
}

const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ')

// Finds the header row in a grid of cells (array of rows) and returns the schedule rows.
// Returns null if this grid has no header with the two required columns.
function extractFromGrid(grid) {
  const headerIdx = grid.findIndex((r) => {
    const h = r.map(norm)
    return h.includes('INTERNAL ID') && h.includes('TOTAL DEDUCTION')
  })
  if (headerIdx < 0) return null
  const h = grid[headerIdx].map(norm)
  const iId = h.indexOf('INTERNAL ID')
  const iAmt = h.indexOf('TOTAL DEDUCTION')
  const iName = h.indexOf('FULL NAME')
  const iMonth = h.indexOf('PAYROLL MONTH')
  const out = []
  let month = null
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i]
    const id = String(r[iId] ?? '').trim()
    const name = iName >= 0 ? String(r[iName] ?? '').trim() : ''
    const amt = cleanAmount(r[iAmt])
    // Skip only completely empty lines. A row with a name or amount but no ID is
    // kept so the system can report it as an error instead of silently dropping it.
    if (!id && !name && !amt) continue
    if (!month && iMonth >= 0) month = guessMonth(r[iMonth])
    out.push({ row: i + 1, internal_id: id, full_name: name || null, amount: amt })
  }
  return { rows: out, month }
}

// Returns "YYYY-MM" from a Date, "2026-11-26", "26/11/2026", "11/26/2026" or "Nov2026", else null.
function guessMonth(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`
  }
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

export function readCsvText(text) {
  const res = extractFromGrid(parseCsv(text.replace(/^﻿/, '')))
  if (!res) {
    throw new Error('Could not find the columns "INTERNAL ID" and "TOTAL DEDUCTION" in that file. Check the header row and try again.')
  }
  return { ...res, sheet: null }
}

// ----------------------------------------------------------------- Excel
// One cell of an Excel sheet as plain text or a number: formulas give their
// calculated result, rich text and links give their text.
function cellValue(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return cellValue(v.result) // formula
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('text' in v) return cellValue(v.text) // hyperlink
    if ('error' in v) return ''
    return ''
  }
  return v
}

export async function readExcelBuffer(buffer) {
  const { default: ExcelJS } = await import('exceljs') // loaded only when an Excel file is chosen
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch (_) {
    throw new Error(
      'That file could not be opened as an Excel (.xlsx) workbook. Older .xls files are not supported: open it and Save As .xlsx, or download it as CSV.',
    )
  }
  const grids = []
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return
    const rowCount = Math.min(ws.rowCount, MAX_ROWS)
    const colCount = Math.min(ws.columnCount, 60)
    const grid = []
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r)
      const cells = []
      for (let c = 1; c <= colCount; c++) cells.push(cellValue(row.getCell(c).value))
      grid.push(cells) // index r-1, so "row" = r matches the sheet row
    }
    grids.push({ name: ws.name, grid })
  })
  // Prefer the PAYROLL_CURRENT sheet, otherwise the first sheet that has the right headers.
  const ordered = [...grids.filter((g) => g.name === PREFERRED_SHEET), ...grids.filter((g) => g.name !== PREFERRED_SHEET)]
  for (const g of ordered) {
    const res = extractFromGrid(g.grid)
    if (res) return { ...res, sheet: g.name }
  }
  throw new Error(
    'No sheet in that workbook has the columns "INTERNAL ID" and "TOTAL DEDUCTION". Check the header row of the sheet you want to upload.',
  )
}

// ------------------------------------------------------------ entry point
export async function readScheduleFile(file) {
  if (file.size > MAX_BYTES) throw new Error('That file is larger than 10 MB. Upload only the schedule.')
  const name = file.name.toLowerCase()
  let res
  if (/\.(xlsx|xlsm)$/.test(name)) {
    res = await readExcelBuffer(await file.arrayBuffer())
  } else if (/\.(xls|xlsb|ods)$/.test(name)) {
    throw new Error('That Excel format is not supported. Open the file and Save As .xlsx (or download as CSV), then upload it.')
  } else {
    res = readCsvText(await file.text())
  }
  if (res.rows.length === 0) throw new Error('No member rows found in that file.')
  if (res.rows.length > MAX_ROWS) throw new Error('Too many rows in that file.')
  return res
}
