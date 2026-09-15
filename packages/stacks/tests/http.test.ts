import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Compiler } from '../src/compiler'
import { elementHtml, tagFor } from '../src/elements'
import { createHandlers, NotFound, ReadOnly, readQuery, type ReportStore } from '../src/http/handlers'
import { isNotFound, reportRoutes } from '../src/http/routes'
import { Registry } from '../src/semantic'
import { Runner } from '../src/runner'
import type { Handlers, RenderedBlock } from '../src'

function harness(overrides: Partial<ReportStore> = {}) {
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
    ...overrides,
  }

  return { handlers: createHandlers(store, runner, registry), saved }
}

describe('handlers', () => {
  it('lists the reports exposed by the store', async () => {
    expect((await harness().handlers.index()).reports).toEqual([
      { id: 1, name: 'Commerce', slug: 'commerce', status: 'published' },
    ])
  })

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

  it('keeps code-defined reports read-only', async () => {
    const { handlers } = harness()

    expect(handlers.editable).toBe(false)
    await expect(handlers.addBlock('commerce', 'bar')).rejects.toThrow(ReadOnly)
    await expect(handlers.saveBlock('commerce', 10, { title: 'Changed' })).rejects.toThrow(ReadOnly)
    await expect(handlers.removeBlock('commerce', 10)).rejects.toThrow(ReadOnly)
    await expect(handlers.publish('commerce')).rejects.toThrow(ReadOnly)
  })

  it('does not advertise an incomplete editor as writable', async () => {
    const { handlers } = harness({
      addBlock: async () => ({ id: 11, kind: 'bar' }),
      saveBlock: async () => {},
      removeBlock: async () => {},
    })

    expect(handlers.editable).toBe(false)
    await expect(handlers.publish('commerce')).rejects.toThrow(ReadOnly)
  })

  it('writes only known kinds, owned blocks, and editable fields', async () => {
    const calls: Array<[string, ...unknown[]]> = []
    const { handlers } = harness({
      addBlock: async (reportId, kind) => {
        calls.push(['add', reportId, kind])
        return { id: 11, kind: kind as any }
      },
      saveBlock: async (reportId, blockId, patch) => { calls.push(['save', reportId, blockId, patch]) },
      removeBlock: async (reportId, blockId) => { calls.push(['remove', reportId, blockId]) },
      publish: async reportId => { calls.push(['publish', reportId]) },
    })

    expect(handlers.editable).toBe(true)
    await expect(handlers.addBlock('commerce', 'script')).rejects.toThrow(NotFound)
    expect((await handlers.addBlock('commerce', 'bar')).block.id).toBe(11)

    await handlers.saveBlock('commerce', 10, {
      id: 999,
      kind: 'note',
      reportId: 2,
      title: 'Net revenue',
      body: 'After refunds',
      query: { model: 'order', measure: 'revenue', limit: '25' },
    })
    await expect(handlers.saveBlock('commerce', 999, { title: 'Foreign' })).rejects.toThrow(NotFound)
    await handlers.removeBlock('commerce', 10)
    expect(await handlers.publish('commerce')).toEqual({ published: true })

    expect(calls).toEqual([
      ['add', 1, 'bar'],
      ['save', 1, 10, {
        title: 'Net revenue',
        body: 'After refunds',
        query: { model: 'order', measure: 'revenue', dimension: undefined, time: undefined, grain: undefined, from: undefined, to: undefined, filters: undefined, limit: 25 },
      }],
      ['remove', 1, 10],
      ['publish', 1],
    ])
  })

  it('normalizes builder queries before they reach storage', () => {
    expect(readQuery({ model: 7, measure: null, from: 20260801, to: '', limit: '12' })).toEqual({
      model: '7',
      measure: '',
      dimension: undefined,
      time: undefined,
      grain: undefined,
      from: '20260801',
      to: undefined,
      filters: undefined,
      limit: 12,
    })
  })
})

describe('routes', () => {
  it('identifies only package not-found errors', () => {
    expect(isNotFound(new NotFound('missing'))).toBe(true)
    expect(isNotFound(new Error('missing'))).toBe(false)
  })

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

  it('forwards route parameters and bodies to the handlers', async () => {
    const calls: Array<[string, ...unknown[]]> = []
    const handlers: Handlers = {
      editable: true,
      index: async () => { calls.push(['index']); return { reports: [] } },
      schema: () => { calls.push(['schema']); return { models: [], grains: [] } },
      show: async (slug, published) => { calls.push(['show', slug, published]); return { report: {}, blocks: [] } },
      download: async (slug, format) => { calls.push(['download', slug, format]); return { body: '', headers: {} } },
      saveLayout: async (slug, blocks) => { calls.push(['layout', slug, blocks]); return { blocks: [] } },
      addBlock: async (slug, kind) => { calls.push(['add', slug, kind]); return { block: { kind: 'note' } } },
      saveBlock: async (slug, id, body) => { calls.push(['save', slug, id, body]); return { saved: true } },
      removeBlock: async (slug, id) => { calls.push(['remove', slug, id]); return { removed: true } },
      publish: async (slug) => { calls.push(['publish', slug]); return { published: true } },
    }
    const routes = new Map(reportRoutes(handlers).map(route => [route.name, route]))

    await routes.get('reportshq.index')!.handle({})
    await routes.get('reportshq.schema')!.handle({})
    await routes.get('reportshq.download')!.handle({ params: { slug: 'sales', format: 'csv' } })
    await routes.get('reportshq.draft')!.handle({ params: { slug: 'sales' } })
    await routes.get('reportshq.blocks.add')!.handle({ params: { slug: 'sales' }, body: { kind: 'bar' } })
    await routes.get('reportshq.blocks.save')!.handle({ params: { slug: 'sales', block: '42' }, body: { title: 'Sales' } })
    await routes.get('reportshq.blocks.remove')!.handle({ params: { slug: 'sales', block: '42' } })
    await routes.get('reportshq.publish')!.handle({ params: { slug: 'sales' } })
    await routes.get('reportshq.layout')!.handle({ params: { slug: 'sales' }, body: { blocks: [{ id: 42 }] } })
    await routes.get('reportshq.show')!.handle({ params: { slug: 'sales' } })

    expect(calls).toEqual([
      ['index'],
      ['schema'],
      ['download', 'sales', 'csv'],
      ['show', 'sales', false],
      ['add', 'sales', 'bar'],
      ['save', 'sales', 42, { title: 'Sales' }],
      ['remove', 'sales', 42],
      ['publish', 'sales'],
      ['layout', 'sales', [{ id: 42 }]],
      ['show', 'sales', true],
    ])
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
