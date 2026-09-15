import { describe, expect, it } from 'bun:test'
import { Registry, SemanticError } from '../src/semantic'

const order = {
  table: 'orders',
  measures: {
    orders: { aggregate: 'count' as const },
    revenue: { aggregate: 'sum' as const, column: 'total' },
  },
  dimensions: { status: 'status' },
  time: { placed: 'created_at' },
  relations: {
    customer: { table: 'customers', foreignKey: 'customer_id' },
  },
}

describe('semantic registry', () => {
  it('adds descriptions fluently and keeps keys deterministic', () => {
    const registry = new Registry().describe('zebra', order).describe('alpha', order)

    expect(registry.has('alpha')).toBe(true)
    expect(registry.has('missing')).toBe(false)
    expect(registry.keys()).toEqual(['alpha', 'zebra'])
  })

  it('allows count without a column but refuses other incomplete measures', () => {
    const registry = new Registry({
      order: {
        ...order,
        measures: { rows: { aggregate: 'count' }, broken: { aggregate: 'sum' } },
      },
    })

    expect(registry.measure('order', 'rows')).toEqual({ aggregate: 'count' })
    expect(() => registry.measure('order', 'broken')).toThrow(/needs a column/)
  })

  it('returns only explicitly described direct relations', () => {
    const registry = new Registry({
      order,
      customer: { table: 'customers', measures: {}, dimensions: {}, time: {} },
      product: { table: 'products', measures: {}, dimensions: {}, time: {} },
    })

    expect(registry.relation('order', 'customer')).toMatchObject({ name: 'customer', table: 'customers' })
    expect(() => registry.relation('order', 'product')).toThrow(/no described relation/)
  })

  it('accepts only the grains the compiler implements', () => {
    expect(['hour', 'day', 'week', 'month'].map(Registry.grain)).toEqual(['hour', 'day', 'week', 'month'])
    expect(() => Registry.grain('quarter')).toThrow(SemanticError)
    expect(() => Registry.grain(null)).toThrow(/not a grain/)
  })

  it('publishes the same sorted choices a builder may offer', () => {
    const choices = new Registry({ order }).choices()

    expect(choices.models).toEqual([{
      key: 'order',
      measures: ['orders', 'revenue'],
      dimensions: ['status'],
      time: ['placed'],
    }])
    expect(choices.grains).toEqual(['hour', 'day', 'week', 'month'])
  })
})
