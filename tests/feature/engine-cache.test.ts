/**
 * The cache key, which is the part of caching that can leak data.
 *
 * A stale number is a nuisance. A cached answer served to a question it did not
 * answer, across a project boundary, is a breach. So the key includes
 * everything that changes an answer, and the tests below are mostly about
 * proving two different questions cannot collide.
 */
import { describe, expect, test } from 'bun:test'
import { cacheKey, TTL_SECONDS } from '../../app/Reports/cache'

const base = {
  projectId: 1,
  timezone: 'UTC',
  range: 'last_30_days',
  query: { events: ['commerce.order.created'], measure: 'count' as const, filters: [] },
}

describe('the cache key', () => {
  test('the same question produces the same key', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }))
  })

  test('key order in the query does not change the key', () => {
    // JSON.stringify is not stable across key order, so two literals that mean
    // the same thing would otherwise cache twice, and a refactor that reorders
    // a literal would silently miss every existing entry.
    const reordered = {
      ...base,
      query: { filters: [], measure: 'count' as const, events: ['commerce.order.created'] },
    }

    expect(cacheKey(reordered)).toBe(cacheKey(base))
  })

  test('a different project never shares a key', () => {
    expect(cacheKey({ ...base, projectId: 2 })).not.toBe(cacheKey(base))
  })

  test('the project id is readable in the key, so a collision still cannot cross tenants', () => {
    expect(cacheKey(base).startsWith('reportshq:q:1:')).toBeTrue()
    expect(cacheKey({ ...base, projectId: 2 }).startsWith('reportshq:q:2:')).toBeTrue()
  })

  test('every part of the question changes the key', () => {
    const variants = [
      { ...base, range: 'last_7_days' },
      { ...base, timezone: 'Europe/Lisbon' },
      { ...base, query: { ...base.query, measure: 'count_unique' as const } },
      { ...base, query: { ...base.query, events: ['user.registered'] } },
      { ...base, query: { ...base.query, filters: [{ field: 'name', operator: 'is' as const, value: 'x' }] } },
      { ...base, query: { ...base.query, dimension: 'properties.plan' } },
      { ...base, query: { ...base.query, grain: 'week' as const } },
      { ...base, query: { ...base.query, compare: true } },
      { ...base, query: { ...base.query, limit: 3 } },
    ]

    const keys = new Set(variants.map(cacheKey))
    keys.add(cacheKey(base))

    expect(keys.size).toBe(variants.length + 1)
  })

  test('a filter value change changes the key', () => {
    const one = { ...base, query: { ...base.query, filters: [{ field: 'name', operator: 'is' as const, value: 'a' }] } }
    const two = { ...base, query: { ...base.query, filters: [{ field: 'name', operator: 'is' as const, value: 'b' }] } }

    expect(cacheKey(one)).not.toBe(cacheKey(two))
  })

  test('the TTL is short enough that a test event is visible quickly', () => {
    // An analytics product is judged on whether the numbers are current. This
    // is a deliberate ceiling, not an accident of configuration.
    expect(TTL_SECONDS).toBeLessThanOrEqual(10)
  })
})
