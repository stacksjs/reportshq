import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Compiler } from '../src/compiler'
import { Registry, SemanticError } from '../src/semantic'

/**
 * The compiler, against a real database.
 *
 * Asserting SQL strings tests the compiler's opinion of itself. These run the
 * query and check the number, which is the only thing anybody cares about.
 */

function fixture() {
  const sqlite = new Database(':memory:')

  sqlite.run(`CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER, status TEXT, created_at TEXT)`)
  sqlite.run(`CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, line_total INTEGER)`)
  sqlite.run(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)`)

  // Anchored to fixed dates, never to "today": a fixture at today 08:00 lands
  // in a different bucket depending on when the suite runs, which broke CI once.
  const orders: Array<[number, string, string]> = [
    [10_000, 'paid', '2026-08-03T10:00:00Z'],
    [5_000, 'paid', '2026-08-03T18:00:00Z'],
    [2_500, 'refunded', '2026-08-04T09:00:00Z'],
  ]

  for (const [total, status, at] of orders)
    sqlite.run(`INSERT INTO orders (total, status, created_at) VALUES (?, ?, ?)`, [total, status, at])

  sqlite.run(`INSERT INTO products (id, name) VALUES (1, 'Ibuprofen'), (2, 'Paracetamol')`)
  // Order 1 has two lines, which is what makes the fan-out refusal matter.
  sqlite.run(`INSERT INTO order_items (order_id, product_id, line_total) VALUES (1, 1, 6000), (1, 2, 4000), (2, 1, 5000), (3, 1, 2500)`)

  const db = {
    unsafe: async (query: string, values: unknown[] = []) => sqlite.query(query).all(...(values as any[])) as any[],
  }

  const registry = new Registry({
    order: {
      table: 'orders',
      measures: {
        revenue: { aggregate: 'sum', column: 'total', unit: 'currency' },
        orders: { aggregate: 'count' },
        average: { aggregate: 'avg', column: 'total' },
      },
      time: { placed: 'created_at' },
      dimensions: { status: 'status' },
      relations: {
        // An order reaches a product only through its lines, and doing so
        // multiplies the order row once per line.
        product: {
          table: 'products',
          foreignKey: 'product_id',
          ownerKey: 'id',
          through: { table: 'order_items', foreignKey: 'order_id', ownerKey: 'id' },
          fansOut: true,
        },
      },
    },
    order_item: {
      table: 'order_items',
      measures: { line_revenue: { aggregate: 'sum', column: 'line_total' } },
      time: {},
      dimensions: {},
      relations: {
        product: { table: 'products', foreignKey: 'product_id', ownerKey: 'id', fansOut: false },
      },
    },
    product: { table: 'products', measures: {}, time: {}, dimensions: { name: 'name' } },
  })

  return { compiler: new Compiler(registry, db, 'sqlite'), registry }
}

describe('the compiler', () => {
  it('sums a measure with no dimension', async () => {
    const { compiler } = fixture()
    const result = await compiler.run({ model: 'order', measure: 'revenue' })

    expect(result.total).toBe(17_500)
  })

  it('counts rows', async () => {
    const { compiler } = fixture()

    expect((await compiler.run({ model: 'order', measure: 'orders' })).total).toBe(3)
  })

  it('buckets by day', async () => {
    const { compiler } = fixture()
    const result = await compiler.run({
      model: 'order', measure: 'revenue',
      time: { key: 'placed' }, grain: 'day',
    })

    expect(result.series[0].points).toEqual([
      { t: '2026-08-03T00:00:00Z', value: 15_000 },
      { t: '2026-08-04T00:00:00Z', value: 2_500 },
    ])
    expect(result.total).toBe(17_500)
  })

  it('buckets in the reader timezone, not in UTC', async () => {
    const { compiler } = fixture()
    // 2026-08-03T18:00Z is already the 4th in Auckland (UTC+12), so an order
    // moves between days. The count of buckets is the same either way, which is
    // exactly why asserting it would prove nothing: the distribution is the
    // thing the timezone changes, and getting it wrong misstates somebody's
    // Monday without changing the shape of the chart.
    const utc = await compiler.run(
      { model: 'order', measure: 'revenue', time: { key: 'placed' }, grain: 'day' },
      'UTC',
    )
    const auckland = await compiler.run(
      { model: 'order', measure: 'revenue', time: { key: 'placed' }, grain: 'day' },
      'Pacific/Auckland',
    )

    expect(utc.series[0].points.map(p => p.value)).toEqual([15_000, 2_500])
    expect(auckland.series[0].points.map(p => p.value)).toEqual([10_000, 7_500])

    // And the total is unchanged, because moving a row between buckets is not
    // losing it. A timezone bug that also changed the total would be obvious.
    expect(auckland.total).toBe(17_500)
  })

  it('groups by a dimension on the same model', async () => {
    const { compiler } = fixture()
    const result = await compiler.run({
      model: 'order', measure: 'revenue', dimension: { key: 'status' },
    })

    expect(result.series.map(s => [s.key, s.total])).toEqual([['paid', 15_000], ['refunded', 2_500]])
  })

  it('refuses a measure that would be multiplied by a join', async () => {
    const { compiler } = fixture()

    // Order 1 has two lines, so summing its total across them would report
    // 27,500 instead of 17,500: plausible, wrong, and nobody would check.
    const attempt = compiler.run({
      model: 'order', measure: 'revenue', dimension: { model: 'product', key: 'name' },
    })

    await expect(attempt).rejects.toThrow(/several rows per one/)
  })

  it('allows the same question asked of the model that owns the measure', async () => {
    const { compiler } = fixture()
    const result = await compiler.run({
      model: 'order_item', measure: 'line_revenue', dimension: { model: 'product', key: 'name' },
    })

    expect(result.total).toBe(17_500)
    expect(result.series.map(s => s.key).sort()).toEqual(['Ibuprofen', 'Paracetamol'])
  })

  it('refuses anything not described', async () => {
    const { compiler } = fixture()

    await expect(compiler.run({ model: 'order', measure: 'password' })).rejects.toThrow(SemanticError)
    await expect(compiler.run({ model: 'nope', measure: 'revenue' })).rejects.toThrow(/No model called/)
    await expect(compiler.run({
      model: 'order', measure: 'revenue', dimension: { key: 'total' },
    })).rejects.toThrow(/no dimension called/)
  })

  it('parameterises a filter value rather than concatenating it', async () => {
    const { compiler } = fixture()
    const result = await compiler.run({
      model: 'order', measure: 'revenue',
      filters: [{ key: 'status', op: '=', value: 'paid' }],
    })

    expect(result.total).toBe(15_000)

    // The value that would end the statement if it were concatenated.
    const injected = await compiler.run({
      model: 'order', measure: 'revenue',
      filters: [{ key: 'status', op: '=', value: `paid'; DROP TABLE orders; --` }],
    })

    expect(injected.total).toBe(0)
    expect((await compiler.run({ model: 'order', measure: 'orders' })).total).toBe(3)
  })

  it('refuses an operator outside the closed set', async () => {
    const { compiler } = fixture()

    await expect(compiler.run({
      model: 'order', measure: 'revenue',
      filters: [{ key: 'status', op: '= 1 OR 1', value: 'x' }],
    })).rejects.toThrow(/not a filter operator/)
  })

  it('applies a date range', async () => {
    const { compiler } = fixture()
    const result = await compiler.run({
      model: 'order', measure: 'revenue',
      from: '2026-08-04T00:00:00Z', to: '2026-08-05T00:00:00Z',
    })

    expect(result.total).toBe(2_500)
  })
})
