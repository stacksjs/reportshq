/**
 * The cache key, which is the part of caching that can leak data.
 *
 * A stale number is a nuisance. A cached answer served to a question it did not
 * answer, across a project boundary, is a breach. So the key includes
 * everything that changes an answer, and the tests below are mostly about
 * proving two different questions cannot collide.
 */
import { describe, expect, test } from 'bun:test'
import { cached, cacheKey, TTL_SECONDS } from '../../app/Reports/cache'

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

/**
 * The cache under a burst, which is the only time it matters.
 *
 * Sequentially any cache looks perfect: one miss, then hits. The hole is the
 * window between the miss and the fill, when every arriving request also misses
 * and starts its own copy of the same query. Measured before the fix, fifty
 * concurrent identical requests ran the query fifty times.
 *
 * That window is the shape of a shared report link posted somewhere busy: the
 * most public surface this product has, viewed by strangers who did not choose
 * to wait, all arriving at once because a link was clicked at once.
 */
describe('a burst of identical questions', () => {
  /** A slow computation, so the requests genuinely overlap. */
  function slowWork(counter: { runs: number }) {
    return async () => {
      counter.runs++
      await new Promise(resolve => setTimeout(resolve, 30))
      return { series: [], total: counter.runs, grain: 'day', range: { from: 'a', to: 'b' } } as never
    }
  }

  const partsFor = (projectId: number) => ({
    projectId,
    query: { events: ['commerce.order.created'], measure: 'count', filters: [] },
    grain: 'day',
    range: { from: '2026-01-01', to: '2026-02-01' },
    timezone: 'UTC',
  }) as never

  test('runs the query once, not once per viewer', async () => {
    const counter = { runs: 0 }
    const parts = partsFor(910_001)

    const answers = await Promise.all(Array.from({ length: 50 }, () => cached(parts, slowWork(counter))))

    expect(counter.runs).toBe(1)
    expect(answers).toHaveLength(50)
  })

  test('every viewer in the burst gets the same answer', async () => {
    // Coalescing is only correct if the shared answer is handed to everybody.
    // Returning early with a placeholder would also show one run.
    const counter = { runs: 0 }
    const parts = partsFor(910_002)

    const answers = await Promise.all(Array.from({ length: 20 }, () => cached(parts, slowWork(counter))))

    expect(new Set(answers.map(answer => answer.total)).size).toBe(1)
  })

  test('two different questions are not folded into one', async () => {
    // The failure the other way: coalescing on too coarse a key would serve one
    // project's numbers to another, which is worse than any amount of load.
    const first = { runs: 0 }
    const second = { runs: 0 }

    await Promise.all([
      ...Array.from({ length: 10 }, () => cached(partsFor(910_003), slowWork(first))),
      ...Array.from({ length: 10 }, () => cached(partsFor(910_004), slowWork(second))),
    ])

    expect(first.runs).toBe(1)
    expect(second.runs).toBe(1)
  })

  test('a failed computation does not poison the key forever', async () => {
    // If the in-flight entry outlived its rejection, every later viewer of this
    // report would inherit the same failure: one bad query becoming a permanent
    // outage for one report.
    const parts = partsFor(910_005)

    await Promise.all(Array.from({ length: 5 }, async () => {
      try {
        await cached(parts, async () => { throw new Error('engine fell over') })
      }
      catch {
        // Expected. The point is what happens next.
      }
    }))

    const counter = { runs: 0 }
    const recovered = await cached(parts, slowWork(counter))

    expect(counter.runs).toBe(1)
    expect(recovered.total).toBe(1)
  })
})
