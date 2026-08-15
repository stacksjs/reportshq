/**
 * A report, as a spreadsheet.
 *
 * Long format, one row per data point, with the block name in a column:
 *
 *     Block            Point                 Series   Value
 *     Revenue per day  2026-08-01T00:00:00Z  total    4250
 *
 * Rather than a sheet per block with its own columns. Two reasons, and the
 * second is the one that decided it. `ts-spreadsheets` models a spreadsheet as
 * one `headings` array and one `data` array, so a sheet per block is not
 * something the library can express. And a report is heterogeneous by design -
 * a big number, a funnel and a daily line have nothing in common columnwise -
 * so a wide format would be mostly empty cells and would change shape every
 * time somebody added a block. Long format survives that, and it is what a
 * pivot table wants anyway.
 *
 * The numbers come from the same engine call the viewer makes, so an export and
 * the screen it was taken from cannot disagree.
 */
import type { Content } from 'ts-spreadsheets'
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

    const title = block.title ? String(block.title) : kind

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

/** The report as CSV text. */
export async function exportCsv(options: ExportOptions): Promise<string> {
  const content = await exportContent(options)
  return String(spreadsheet.create(content, { type: 'csv' }).content)
}

/** The report as an xlsx workbook. */
export async function exportXlsx(options: ExportOptions): Promise<Uint8Array> {
  const content = await exportContent(options)
  return spreadsheet.create(content, { type: 'excel' }).content as Uint8Array
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
