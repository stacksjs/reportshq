import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Compiler } from '../src/compiler'
import { elementHtml, tagFor } from '../src/elements'
import { createHandlers, NotFound, type ReportStore } from '../src/http/handlers'
import { reportRoutes } from '../src/http/routes'
import { Registry } from '../src/semantic'
import { Runner } from '../src/runner'
import type { RenderedBlock } from '../src/types'

function harness() {
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
  const runner = new Runner(new Compiler(registry, db, 'sqlite'))

  const saved: any[] = []
  const store: ReportStore = {
    list: async () => [{ id: 1, name: 'Commerce', slug: 'commerce', status: 'published' }],
    find: async slug => slug === 'commerce' ? { id: 1, name: 'Commerce', slug: 'commerce', timezone: 'UTC' } : null,
    blocks: async () => [
      { id: 10, kind: 'big_number', title: 'Revenue', x: 0, y: 0, w: 4, h: 4, query: { model: 'order', measure: 'revenue' } },
    ],
    saveLayout: async (_id, blocks) => { saved.push(...blocks) },
  }

  return { handlers: createHandlers(store, runner, registry), saved }
}

describe('handlers', () => {
  it('renders a report', async () => {
    const { blocks } = await harness().handlers.show('commerce')

    expect(blocks[0].total).toBe(15_000)
    expect(blocks[0].error).toBeNull()
  })

  it('refuses a report that is not there, without leaking anything else', async () => {
    await expect(harness().handlers.show('nope')).rejects.toThrow(NotFound)
  })

  it('exports only formats it writes', async () => {
    const { headers, body } = await harness().handlers.download('commerce', 'csv')

    expect(headers['Content-Type']).toContain('text/csv')
    expect(headers['Content-Disposition']).toContain('commerce-')
    expect(body).toContain('Revenue')

    await expect(harness().handlers.download('commerce', 'pdf')).rejects.toThrow(NotFound)
  })

  it('ignores a layout naming a block from another report', async () => {
    // Both ids arrive from a browser, so neither is trusted.
    const { handlers, saved } = harness()

    await handlers.saveLayout('commerce', [
      { id: 10, x: 4, y: 0, w: 4, h: 4 },
      { id: 999, x: 0, y: 0, w: 4, h: 4 },
    ])

    expect(saved.map(b => b.id)).toEqual([10])
  })

  it('publishes the same schema the compiler enforces', () => {
    const schema = harness().handlers.schema() as any

    expect(schema.models[0].measures).toEqual(['revenue'])
    expect(schema.grains).toContain('day')
  })
})

describe('routes', () => {
  it('puts the fixed paths before the slug', () => {
    // Or a report called "schema" is unreachable and the schema endpoint is
    // read as a slug.
    const paths = reportRoutes(harness().handlers).map(r => r.path)

    expect(paths.indexOf('/schema')).toBeLessThan(paths.indexOf('/{slug}'))
    expect(paths.indexOf('/{slug}/draft')).toBeLessThan(paths.indexOf('/{slug}'))
  })

  it('describes routes rather than registering them', () => {
    // The application mounts these. A package that calls the router has
    // decided the prefix and the middleware on the application's behalf.
    for (const route of reportRoutes(harness().handlers)) {
      expect(typeof route.handle).toBe('function')
      expect(route.name.startsWith('reportshq.')).toBe(true)
    }
  })
})

describe('elements', () => {
  const block = (over: Partial<RenderedBlock>): RenderedBlock => ({
    kind: 'bar', x: 0, y: 0, w: 4, h: 4, series: [], total: 0, error: null, ...over,
  })

  it('builds the tag the bundle registers', () => {
    expect(tagFor('donut')).toBe('stacks-donut-chart')
    // An unknown kind gets a text block rather than nothing: a tile that says
    // something beats a hole nobody can explain.
    expect(tagFor('invented')).toBe('stacks-text-block')
  })

  it('escapes a payload so a product name cannot close the attribute', () => {
    // The value is a customer's own text, and one unescaped quote ends the
    // attribute and starts markup.
    const html = elementHtml(block({
      title: `"><script>alert(1)</script>`,
      series: [{ key: `Ibuprofen "200mg"`, total: 1, points: [{ t: 'x', value: 1 }] }],
    }))

    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;')
    expect(html.match(/</g)?.length).toBe(2)
  })

  it('round-trips the payload as JSON', () => {
    const html = elementHtml(block({ title: 'Revenue', total: 15_000 }))
    const payload = html.match(/result="([^"]*)"/)![1]
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

    expect(JSON.parse(payload).total).toBe(15_000)
  })
})
