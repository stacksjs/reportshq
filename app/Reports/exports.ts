/**
 * A report, as a spreadsheet.
 *
 * Long format, one row per data point, with the block name in a column:
 *
 *     Block            Point                 Series   Value
 *     Revenue per day  2026-08-01T00:00:00Z  total    4250
 *
 * That is the CSV, which has no tabs and where one flat table a pivot can read
 * beats several stacked in a file. The xlsx puts each block on its own sheet
 * instead, named after the block, which is what somebody opening a workbook
 * expects to find.
 *
 * A wide format, a column per block, is the shape neither of them uses: a
 * report is heterogeneous by design, since a big number, a funnel and a daily
 * line have nothing in common columnwise, so it would be mostly empty cells and
 * would change shape every time somebody added a block.
 *
 * The numbers come from the same engine call the viewer makes, so an export and
 * the screen it was taken from cannot disagree.
 */
import type { Content, Sheet } from 'ts-spreadsheets'
import { spreadsheet } from 'ts-spreadsheets'
import { runQuery } from './engine'
import { publishedBlocks } from './reports'

export interface ExportOptions {
  projectId: number
  reportId: number
  timezone: string
  range: string
}

export const EXPORT_HEADINGS = ['Block', 'Point', 'Series', 'Value']

/** What to call a block nobody named. The same words the builder's palette uses. */
const BLOCK_LABELS: Record<string, string> = {
  big_number: 'Big number',
  line: 'Line',
  area: 'Area',
  bar: 'Bar',
  donut: 'Donut',
  table: 'Table',
  funnel: 'Funnel',
  heatmap: 'Heatmap',
}

/** A `t` that reads the same in a spreadsheet as it does in the API. */
function pointLabel(value: unknown): string {
  const text = String(value ?? '')
  return text
}

/**
 * Flatten one block's result into rows.
 *
 * A block with no data contributes no rows rather than a row of zeroes: an
 * empty chart and a chart of zeroes are different claims, and only one of them
 * is true.
 */
function rowsFor(title: string, result: unknown): (string | number)[][] {
  const typed = result as {
    series?: Array<{ key?: string, points?: Array<{ t?: string, value?: number }>, total?: number }>
    total?: number
  } | null

  if (!typed)
    return []

  const rows: (string | number)[][] = []
  const series = Array.isArray(typed.series) ? typed.series : []

  for (const entry of series) {
    const key = String(entry.key ?? 'total')
    const points = Array.isArray(entry.points) ? entry.points : []

    if (points.length === 0) {
      // A series with a total but no buckets is a big number, a funnel step or
      // a donut slice. One row, labelled by the series rather than by a time.
      if (entry.total !== undefined && entry.total !== null)
        rows.push([title, key, key, Number(entry.total)])

      continue
    }

    for (const point of points)
      rows.push([title, pointLabel(point.t), key, Number(point.value ?? 0)])
  }

  return rows
}

/**
 * Build the spreadsheet content for a report's published snapshot.
 *
 * The published snapshot, not the draft, for the same reason the viewer reads
 * it: an export is something somebody sends to other people, and the draft is
 * by definition not what was meant to be seen.
 */
export async function exportContent(options: ExportOptions): Promise<Content> {
  const blocks = (await publishedBlocks(options.reportId)) ?? []
  const data: (string | number)[][] = []

  for (const block of blocks) {
    const kind = String(block.kind)

    // A note has no numbers in it. Including its prose in a column of values
    // would break every formula somebody wrote against the sheet.
    if (kind === 'text')
      continue

    // An untitled block still has to be called something, and in a workbook it
    // becomes the name on the tab. `big_number` and `bar` are what this said
    // before: the internal kind, in a place a person reads.
    const title = block.title ? String(block.title) : (BLOCK_LABELS[kind] ?? 'Block')

    try {
      const result = await runQuery({
        projectId: options.projectId,
        timezone: options.timezone,
        range: options.range,
        query: block.query as never,
      })

      data.push(...rowsFor(title, result))
    }
    catch {
      // One block that will not run must not cost the whole export. The row
      // says so rather than leaving a silent gap where numbers should be.
      data.push([title, 'error', 'error', 0])
    }
  }

  return { headings: EXPORT_HEADINGS, data }
}

/**
 * The same numbers, arranged one sheet per block.
 *
 * The long format above is the right shape for a pivot table and the wrong one
 * for reading: somebody who wants the revenue series has to filter a column
 * first. A workbook has tabs for exactly this, so the xlsx uses them, named
 * after the blocks the person was looking at. The `Block` column is dropped
 * inside each sheet, since the tab already says it.
 *
 * CSV keeps the long format. It has no tabs, and one flat table that a pivot
 * can read is more useful there than three tables stacked in one file.
 */
export async function exportSheets(options: ExportOptions): Promise<Sheet[]> {
  const content = await exportContent(options)
  const byBlock = new Map<string, (string | number)[][]>()

  for (const row of content.data) {
    const [title, ...rest] = row
    const key = String(title)

    if (!byBlock.has(key))
      byBlock.set(key, [])

    byBlock.get(key)!.push(rest)
  }

  // A report whose blocks all failed or hold nothing still produces a
  // workbook, with the headings and no rows, rather than a file that will not
  // open because it has no sheets in it.
  if (byBlock.size === 0)
    return [{ name: 'Report', headings: EXPORT_HEADINGS, data: [] }]

  return [...byBlock.entries()].map(([title, rows]) => ({
    name: title,
    headings: EXPORT_HEADINGS.slice(1),
    data: rows,
  }))
}

/** The report as CSV text. */
export async function exportCsv(options: ExportOptions): Promise<string> {
  const content = await exportContent(options)
  return String(spreadsheet.create(content, { type: 'csv' }).content)
}

/** The report as an xlsx workbook, a sheet per block. */
export async function exportXlsx(options: ExportOptions): Promise<Uint8Array> {
  const sheets = await exportSheets(options)
  return spreadsheet.create(sheets, { type: 'excel' }).content as Uint8Array
}

/** A filename somebody can find again in a downloads folder. */
export function exportFilename(reportName: string, format: 'csv' | 'xlsx', at: Date = new Date()): string {
  const slug = String(reportName)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .slice(0, 60) || 'report'

  return `${slug}-${at.toISOString().slice(0, 10)}.${format}`
}
