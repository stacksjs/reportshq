import type { RenderedBlock } from './types'

/**
 * A report, as a spreadsheet.
 *
 * Two shapes for two formats, and the difference is not an oversight. A CSV
 * stays long, because it has no word for a tab and one flat table a pivot can
 * read beats several stacked with blank lines between them.
 *
 * A block that would not run contributes a row saying so rather than nothing. A
 * silent gap in an export is indistinguishable from a quiet week, and the
 * person reading the file is not the person who saw the error on the tile.
 */
export const HEADINGS = ['Block', 'Point', 'Series', 'Value'] as const

const LABELS: Record<string, string> = {
  big_number: 'Big number',
  line: 'Line',
  area: 'Area',
  bar: 'Bar',
  donut: 'Donut',
  table: 'Table',
  funnel: 'Funnel',
  heatmap: 'Heatmap',
}

export function toRows(blocks: RenderedBlock[]): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = []

  for (const block of blocks) {
    const title = block.title || LABELS[block.kind] || 'Block'

    if (block.error) {
      rows.push([title, 'error', 'error', 0])
      continue
    }

    // A note has no numbers. Its prose in a column of values would break every
    // formula somebody wrote against the sheet, so it carries its own row with
    // the text where a series name would be.
    if (block.kind === 'note') {
      rows.push([title, '', block.body ?? '', 0])
      continue
    }

    for (const series of block.series) {
      for (const point of series.points)
        rows.push([title, point.t, series.key, point.value])
    }
  }

  return rows
}

export function csv(blocks: RenderedBlock[]): string {
  const lines = [HEADINGS.join(',')]

  for (const row of toRows(blocks))
    lines.push(row.map(cell).join(','))

  return `${lines.join('\n')}\n`
}

/** A filename somebody can find again in a downloads folder. */
export function filename(name: string, format: string, at: Date = new Date()): string {
  const slug = name.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '')

  return `${(slug || 'report').slice(0, 60)}-${at.toISOString().slice(0, 10)}.${format}`
}

/** Quote only when the value would otherwise change meaning. */
function cell(value: string | number): string {
  const text = String(value)

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
