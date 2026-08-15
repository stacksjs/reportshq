/**
 * The query engine, against hand-computed expectations.
 *
 * Fixtures are written so every number below can be checked by hand from the
 * events created in beforeAll: 3 orders on day -2, 1 on day -1, 2 today, with
 * known values. An engine test that asserts "whatever it returned last time"
 * is a snapshot, and a snapshot cannot tell you the aggregation is wrong.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { storeEvents } from '../../app/Events/ingest'
import { runQuery } from '../../app/Reports/engine'
import { addDays, bucketsFor, previousRange, resolveRange, startOfDay, startOfWeek } from '../../app/Reports/range'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number

/**
 * Midnight UTC yesterday, so every fixture time is exact, reproducible, and in
 * the past.
 *
 * Anchoring on today broke the hourly test just after UTC midnight: fixtures at
 * "today 08:00" were then in the future, the ingest clamped them to an hour
 * ahead as it is supposed to, and two events that should sit in different hours
 * landed in the same one. The suite is not allowed to depend on what time it is
 * run.
 */
const today = new Date(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z')
const at = (dayOffset: number, hour: number): string =>
  new Date(today.getTime() + dayOffset * 86_400_000 + hour * 3_600_000).toISOString()

beforeAll(async () => {
  const email = `engine-owner-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    ['engine owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }
  projectId = Number((await createProject(owner, { name: `Engine ${stamp}`, timezone: 'UTC' })).id)

  await storeEvents(projectId, [
    // Day -2: three orders, 10 + 20 + 30 = 60, two customers, plan split 2/1.
    { name: 'commerce.order.created', occurred_at: at(-2, 9), value: 10, user_key: 'a', session_key: 's1', properties: { plan: 'pro' } },
    { name: 'commerce.order.created', occurred_at: at(-2, 13), value: 20, user_key: 'b', session_key: 's2', properties: { plan: 'pro' } },
    { name: 'commerce.order.created', occurred_at: at(-2, 20), value: 30, user_key: 'a', session_key: 's3', properties: { plan: 'starter' } },
    // Day -1: one order, 40, one customer.
    { name: 'commerce.order.created', occurred_at: at(-1, 11), value: 40, user_key: 'c', session_key: 's4', properties: { plan: 'starter' } },
    // Day 0: two orders, 50 + 60 = 110, two customers.
    { name: 'commerce.order.created', occurred_at: at(0, 8), value: 50, user_key: 'a', session_key: 's5', properties: { plan: 'pro' } },
    { name: 'commerce.order.created', occurred_at: at(0, 15), value: 60, user_key: 'd', session_key: 's6', properties: { plan: 'scale' } },
    // Funnel: s5 completes all three steps, s6 stops after checkout, s7 only views.
    { name: 'commerce.product.viewed', occurred_at: at(0, 7), session_key: 's5', user_key: 'a' },
    { name: 'commerce.checkout.started', occurred_at: at(0, 7), session_key: 's5', user_key: 'a' },
    { name: 'commerce.product.viewed', occurred_at: at(0, 14), session_key: 's6', user_key: 'd' },
    { name: 'commerce.checkout.started', occurred_at: at(0, 14), session_key: 's6', user_key: 'd' },
    { name: 'commerce.product.viewed', occurred_at: at(0, 16), session_key: 's7', user_key: 'e' },
    // A different event, to prove event filtering actually filters.
    { name: 'user.registered', occurred_at: at(0, 9), user_key: 'f' },
  ])
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

/** Covers the three fixture days inclusive. */
const range = { from: new Date(today.getTime() - 2 * 86_400_000), to: new Date(today.getTime() + 86_400_000) }

describe('measures', () => {
  test('count counts matching events, not every event', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day' },
    })

    // Six orders across three days; the user.registered event is excluded.
    expect(result.total).toBe(6)
  })

  test('sum adds the values', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [], grain: 'day' },
    })

    // 60 + 40 + 110
    expect(result.total).toBe(210)
  })

  test('count_unique counts people, not events', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'count_unique', filters: [], grain: 'day' },
    })

    // a, b on day -2 (a twice); c on day -1; a, d on day 0. Distinct per
    // bucket then summed: 2 + 1 + 2.
    expect(result.total).toBe(5)
  })

  test('avg averages the buckets that have data', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'avg', field: 'value', filters: [], grain: 'day' },
    })

    // Daily averages are 20, 40 and 55; their mean is 38.33.
    expect(result.total).toBeCloseTo((20 + 40 + 55) / 3, 5)
  })

  test('min and max read the extremes', async () => {
    const min = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'min', field: 'value', filters: [], grain: 'day' },
    })
    const max = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'max', field: 'value', filters: [], grain: 'day' },
    })

    expect(min.total).toBe(10)
    expect(max.total).toBe(60)
  })
})

describe('time buckets', () => {
  test('every day in the range gets a point, including empty ones', async () => {
    const wide = { from: new Date(today.getTime() - 5 * 86_400_000), to: new Date(today.getTime() + 86_400_000) }

    const result = await runQuery({
      projectId,
      range: wide,
      query: { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day' },
    })

    // Six days, three of which have no orders. A chart that skips them draws a
    // line straight across, which reads as "steady" when it means "nothing".
    expect(result.series[0]?.points).toHaveLength(6)
    expect(result.series[0]?.points.filter(point => point.value === 0)).toHaveLength(3)
  })

  test('points are in chronological order', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day' },
    })

    const times = result.series[0]!.points.map(point => point.t)
    expect([...times].sort()).toEqual(times)
  })

  test('daily values land on the right days', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [], grain: 'day' },
    })

    expect(result.series[0]!.points.map(point => point.value)).toEqual([60, 40, 110])
  })

  test('an hourly grain separates events within a day', async () => {
    const oneDay = { from: today, to: new Date(today.getTime() + 86_400_000) }

    const result = await runQuery({
      projectId,
      range: oneDay,
      query: { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'hour' },
    })

    expect(result.series[0]?.points).toHaveLength(24)
    // 08:00 and 15:00 have one order each.
    expect(result.series[0]!.points.filter(point => point.value > 0)).toHaveLength(2)
  })
})

describe('dimensions', () => {
  test('splitting by a property produces one series per value', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: {
        events: ['commerce.order.created'],
        measure: 'count',
        dimension: 'properties.plan',
        filters: [],
        grain: 'day',
      },
    })

    const keys = result.series.map(series => series.key).sort()
    expect(keys).toEqual(['pro', 'scale', 'starter'])

    const pro = result.series.find(series => series.key === 'pro')
    expect(pro?.total).toBe(3)
  })

  test('the total across series still adds up', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: {
        events: ['commerce.order.created'],
        measure: 'sum',
        field: 'value',
        dimension: 'properties.plan',
        filters: [],
        grain: 'day',
      },
    })

    expect(result.total).toBe(210)
  })

  test('a low limit folds the tail into Other rather than dropping it', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: {
        events: ['commerce.order.created'],
        measure: 'count',
        dimension: 'properties.plan',
        filters: [],
        limit: 1,
        grain: 'day',
      },
    })

    expect(result.series).toHaveLength(2)
    expect(result.series[1]?.key).toBe('Other')
    // Dropping the tail would make the chart disagree with the big number
    // beside it; folding keeps the total honest.
    expect(result.total).toBe(6)
  })
})

describe('filters', () => {
  test('is matches a property value', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: {
        events: ['commerce.order.created'],
        measure: 'count',
        filters: [{ field: 'properties.plan', operator: 'is', value: 'pro' }],
        grain: 'day',
      },
    })

    expect(result.total).toBe(3)
  })

  test('is_not excludes, and keeps rows where the property is absent', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: {
        events: ['commerce.order.created'],
        measure: 'count',
        filters: [{ field: 'properties.plan', operator: 'is_not', value: 'pro' }],
        grain: 'day',
      },
    })

    expect(result.total).toBe(3)
  })

  test('gt compares numerically, not as text', async () => {
    // As strings, "9" > "50", which is exactly the bug this guards.
    const result = await runQuery({
      projectId,
      range,
      query: {
        events: ['commerce.order.created'],
        measure: 'count',
        filters: [{ field: 'value', operator: 'gt', value: 35 }],
        grain: 'day',
      },
    })

    expect(result.total).toBe(3)
  })

  test('exists and not_exists split the set', async () => {
    const withKey = await runQuery({
      projectId,
      range,
      query: { events: [], measure: 'count', filters: [{ field: 'session_key', operator: 'exists' }], grain: 'day' },
    })
    const withoutKey = await runQuery({
      projectId,
      range,
      query: { events: [], measure: 'count', filters: [{ field: 'session_key', operator: 'not_exists' }], grain: 'day' },
    })
    const all = await runQuery({
      projectId,
      range,
      query: { events: [], measure: 'count', filters: [], grain: 'day' },
    })

    expect(withKey.total + withoutKey.total).toBe(all.total)
  })

  test('a filter naming something unreadable is refused, not silently ignored', async () => {
    await expect(runQuery({
      projectId,
      range,
      query: {
        events: [],
        measure: 'count',
        filters: [{ field: 'users.password', operator: 'is', value: 'x' }],
        grain: 'day',
      },
    })).rejects.toThrow()
  })

  test('a property name carrying SQL is refused outright', async () => {
    // Two layers, and this one catches it first: the field allowlist refuses
    // quotes inside a property key, so the query never runs at all.
    await expect(runQuery({
      projectId,
      range,
      query: {
        events: [],
        measure: 'count',
        filters: [{ field: `properties.plan') or 1=1 --`, operator: 'is', value: 'pro' }],
        grain: 'day',
      },
    })).rejects.toThrow('cannot be read')
  })

  test('an unusual but legal property name is a lookup that finds nothing', async () => {
    // The second layer: a key that passes the allowlist is still bound as a
    // parameter to a JSON accessor, so it can only ever be a key that does not
    // exist, never syntax.
    const result = await runQuery({
      projectId,
      range,
      query: {
        events: [],
        measure: 'count',
        filters: [{ field: 'properties.plan OR 1=1', operator: 'is', value: 'pro' }],
        grain: 'day',
      },
    })

    expect(result.total).toBe(0)
  })

  test('a filter on a property binds its key once per mention', async () => {
    // `is_not` names the column twice, and a property column carries its own
    // placeholder, so the key has to be bound twice. Getting this wrong threw
    // "SQLite query expected 7 values, received 6" rather than a wrong number.
    for (const operator of ['is_not', 'exists', 'not_exists'] as const) {
      const result = await runQuery({
        projectId,
        range,
        query: {
          events: ['commerce.order.created'],
          measure: 'count',
          filters: [operator === 'is_not'
            ? { field: 'properties.plan', operator, value: 'pro' }
            : { field: 'properties.plan', operator }],
          grain: 'day',
        },
      })

      expect(result.total).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('comparison', () => {
  test('compares against the previous period of equal length', async () => {
    const result = await runQuery({
      projectId,
      range,
      query: { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [], grain: 'day', compare: true },
    })

    expect(result.comparison).toBeDefined()
    // The three days before the fixtures have nothing in them.
    expect(result.comparison?.total).toBe(0)
    // Up from zero is not a percentage, so it is null rather than Infinity.
    expect(result.comparison?.change).toBeNull()
  })

  test('a real change is a fraction', async () => {
    const lastTwo = { from: new Date(today.getTime() - 86_400_000), to: new Date(today.getTime() + 86_400_000) }

    const result = await runQuery({
      projectId,
      range: lastTwo,
      query: { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [], grain: 'day', compare: true },
    })

    // Current: 40 + 110 = 150. Previous two days: 60 and nothing.
    expect(result.total).toBe(150)
    expect(result.comparison?.total).toBe(60)
    expect(result.comparison?.change).toBeCloseTo((150 - 60) / 60, 5)
  })
})

describe('funnels', () => {
  test('steps count sessions, and each step only counts sessions that reached the last', async () => {
    const oneDay = { from: today, to: new Date(today.getTime() + 86_400_000) }

    const result = await runQuery({
      projectId,
      range: oneDay,
      query: {
        events: [],
        measure: 'count',
        filters: [],
        steps: ['commerce.product.viewed', 'commerce.checkout.started', 'commerce.order.created'],
      },
    })

    // s5, s6, s7 viewed; s5 and s6 checked out; only s5 and s6 ordered, and s7
    // never gets counted downstream despite existing.
    expect(result.steps?.map(step => step.count)).toEqual([3, 2, 2])
    expect(result.steps?.[0]?.rate).toBe(1)
    expect(result.steps?.[1]?.rate).toBeCloseTo(2 / 3, 5)
  })
})

describe('range resolution', () => {
  test('last_7_days covers seven calendar days ending today', () => {
    const resolved = resolveRange('last_7_days', 'UTC', today)
    const days = Math.round((resolved.to.getTime() - resolved.from.getTime()) / 86_400_000)
    expect(days).toBe(7)
  })

  test('to is exclusive, so an event at 23:59:59.999 belongs to its own day', () => {
    const resolved = resolveRange('today', 'UTC', today)
    expect(resolved.to.getTime() - resolved.from.getTime()).toBe(86_400_000)
  })

  test('the previous period matches in length', () => {
    const resolved = resolveRange('last_30_days', 'UTC', today)
    const previous = previousRange(resolved, 'UTC')

    expect(previous.to.getTime()).toBe(resolved.from.getTime())
    expect(Math.round((previous.to.getTime() - previous.from.getTime()) / 86_400_000)).toBe(30)
  })

  test('a week starts on Monday', () => {
    // A Wednesday.
    const wednesday = new Date('2026-08-12T15:00:00.000Z')
    expect(startOfWeek(wednesday, 'UTC').toISOString().slice(0, 10)).toBe('2026-08-10')
  })

  test('adding days crosses a daylight-saving boundary as calendar days', () => {
    // Lisbon springs forward on 2026-03-29. Adding one day to the 28th must
    // land on the 29th, not 23 hours later on the same date.
    const before = new Date('2026-03-28T12:00:00.000Z')
    const start = startOfDay(before, 'Europe/Lisbon')
    const next = addDays(start, 1, 'Europe/Lisbon')

    const label = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit' }).format(next)
    expect(label).toBe('03-29')
  })

  test('buckets cover the range without gaps or duplicates', () => {
    const resolved = resolveRange('last_7_days', 'UTC', today)
    const buckets = bucketsFor(resolved, 'day', 'UTC')

    expect(buckets).toHaveLength(7)
    expect(new Set(buckets.map(date => date.toISOString())).size).toBe(7)
  })
})

describe('a project only ever sees its own events', () => {
  test('another project returns nothing for the same query', async () => {
    const other = await createProject(owner, { name: `Engine other ${stamp}` })

    const result = await runQuery({
      projectId: Number(other.id),
      range,
      query: { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day' },
    })

    expect(result.total).toBe(0)

    await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [other.id])
    await db.unsafe(`DELETE FROM projects WHERE id = $1`, [other.id])
  })
})
