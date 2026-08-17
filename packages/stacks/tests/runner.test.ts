import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Compiler } from '../src/compiler'
import { Registry } from '../src/semantic'
import { Runner } from '../src/runner'

/**
 * A report, run.
 *
 * The property under test is that one bad block does not take the page with it,
 * because the alternative is a reader losing eleven working charts to one bad
 * question.
 */

function runner() {
  const sqlite = new Database(':memory:')
  sqlite.run(`CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER, created_at TEXT)`)
  sqlite.run(`INSERT INTO orders (total, created_at) VALUES (10000, '2026-08-03T10:00:00Z'), (5000, '2026-08-04T10:00:00Z')`)

  const registry = new Registry({
    order: {
      table: 'orders',
      measures: { revenue: { aggregate: 'sum', column: 'total' } },
      time: { placed: 'created_at' },
      dimensions: {},
    },
  })

  const db = { unsafe: async (q: string, v: unknown[] = []) => sqlite.query(q).all(...(v as any[])) as any[] }

  return new Runner(new Compiler(registry, db, 'sqlite'))
}

describe('the runner', () => {
  it('runs the blocks it can and refuses the ones it cannot', async () => {
    const blocks = await runner().report([
      { kind: 'big_number', title: 'Revenue', query: { model: 'order', measure: 'revenue' } },
      { kind: 'bar', title: 'Nonsense', query: { model: 'order', measure: 'invented' } },
      { kind: 'note', title: 'Note', body: 'Revenue counts orders placed.' },
    ])

    expect(blocks[0].total).toBe(15_000)
    expect(blocks[0].error).toBeNull()

    // The refusal names what was wrong, on the block it belongs to.
    expect(blocks[1].error).toContain('no measure called')
    expect(blocks[1].series).toEqual([])

    // And a note is not a failure for having no query.
    expect(blocks[2].error).toBeNull()
    expect(blocks[2].body).toContain('orders placed')
  })

  it('gives a block its geometry even when the query fails', async () => {
    // The tile still has to occupy its cell, or a refusal reflows the grid and
    // the reader thinks something was deleted.
    const [block] = await runner().report([
      { kind: 'bar', x: 4, y: 2, w: 8, h: 5, query: { model: 'nope', measure: 'revenue' } },
    ])

    expect(block).toMatchObject({ x: 4, y: 2, w: 8, h: 5 })
    expect(block.error).toContain('No model called')
  })

  it('defaults geometry rather than rendering a zero-sized block', async () => {
    const [block] = await runner().report([{ kind: 'big_number', query: { model: 'order', measure: 'revenue' } }])

    expect(block.w).toBeGreaterThan(0)
    expect(block.h).toBeGreaterThan(0)
  })
})
