import { describe, expect, it } from 'bun:test'
import type { RenderedBlock } from '../src/types'
import { csv, filename } from '../src/export'

const block = (over: Partial<RenderedBlock>): RenderedBlock => ({
  kind: 'bar', x: 0, y: 0, w: 4, h: 4, series: [], total: 0, error: null, ...over,
})

describe('exporting', () => {
  it('writes a value per point, under a stable header', () => {
    const out = csv([block({
      title: 'Revenue per day',
      series: [{ key: 'revenue', total: 15_000, points: [
        { t: '2026-08-03T00:00:00Z', value: 10_000 },
        { t: '2026-08-04T00:00:00Z', value: 5_000 },
      ] }],
      total: 15_000,
    })])

    const lines = out.trim().split('\n')

    expect(lines[0]).toBe('Block,Point,Series,Value')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('Revenue per day,2026-08-03T00:00:00Z,revenue,10000')
  })

  it('records a refused block rather than leaving a gap', () => {
    // A silent gap reads as a quiet week to whoever opens the file.
    expect(csv([block({ title: 'Broken', error: 'nope' })])).toContain('Broken,error,error,0')
  })

  it('keeps every value column numeric, even for a note', () => {
    const out = csv([block({ kind: 'note', title: 'Note', body: 'Revenue counts orders placed.' })])

    for (const line of out.trim().split('\n').slice(1))
      expect(Number.isNaN(Number(line.split(',').pop()))).toBe(false)
  })

  it('quotes a value that would otherwise change the shape of the row', () => {
    const out = csv([block({
      title: 'By product',
      series: [{ key: 'Ibuprofen, 200mg', total: 1, points: [{ t: 'x', value: 1 }] }],
    })])

    expect(out).toContain('"Ibuprofen, 200mg"')
  })

  it('names the file so it can be found again', () => {
    const at = new Date('2026-08-17T00:00:00Z')

    expect(filename('Commerce overview', 'csv', at)).toBe('commerce-overview-2026-08-17.csv')
    expect(filename('', 'csv', at)).toBe('report-2026-08-17.csv')
    expect(filename('Revenue / cost', 'csv', at)).toBe('revenue-cost-2026-08-17.csv')
  })
})
