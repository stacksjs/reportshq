/**
 * Every measure, every grain, every operator, against numbers worked out by hand.
 *
 * The engine tests next door use a fixture anchored on today, which is right for
 * them: it exercises the paths a report actually takes. It also means the week
 * and month buckets land wherever the calendar happens to put them, so those
 * grains are asserted loosely or not at all, and three of the eight filter
 * operators are never exercised.
 *
 * This is the other half. The dataset is **frozen**: six events on fixed dates in
 * February and March 2026, chosen so that every expected number below can be
 * checked with arithmetic rather than by running the code. 2026-02-02 is a
 * Monday and 2026-02-09 is the next one, so the week boundaries are not a
 * judgement call.
 *
 * The values are small and distinct on purpose. A fixture of tens and hundreds
 * makes a wrong `sum` obvious; a fixture of repeated 1s does not, and neither
 * does one whose expected values were copied from what the code returned.
 *
 * The events, in full:
 *
 * | when              | name                    | value | user | plan    |
 * |-------------------|-------------------------|-------|------|---------|
 * | Mon 2 Feb, 01:00  | commerce.order.created  |    10 | a    | pro     |
 * | Mon 2 Feb, 05:00  | commerce.order.created  |    20 | b    | pro     |
 * | Tue 3 Feb, 02:00  | commerce.order.created  |    30 | a    | starter |
 * | Mon 9 Feb, 07:00  | commerce.order.created  |    40 | c    | starter |
 * | Mon 9 Feb, 09:00  | user.registered         |     - | d    | -       |
 * | Mon 2 Mar, 03:00  | commerce.order.created  |    50 | b    | pro     |
 *
 * So for the five orders: count 5, sum 150, avg 30, min 10, max 50, and three
 * distinct users (a, b, c). The registration carries no value and no plan, which
 * is what makes `avg`, `exists` and `not_exists` worth asserting at all.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { runQuery } from '../../app/Reports/engine'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number

/** February and March 2026, with a week to spare at each end. */
const RANGE = {
  from: new Date('2026-02-01T00:00:00.000Z'),
  to: new Date('2026-04-01T00:00:00.000Z'),
}

const ORDERS = 'commerce.order.created'

interface Row {
  at: string
  name: string
  value: number | null
  user: string
  plan: string | null
}

const FIXTURE: Row[] = [
  { at: '2026-02-02T01:00:00.000Z', name: ORDERS, value: 10, user: 'a', plan: 'pro' },
  { at: '2026-02-02T05:00:00.000Z', name: ORDERS, value: 20, user: 'b', plan: 'pro' },
  { at: '2026-02-03T02:00:00.000Z', name: ORDERS, value: 30, user: 'a', plan: 'starter' },
  { at: '2026-02-09T07:00:00.000Z', name: ORDERS, value: 40, user: 'c', plan: 'starter' },
  { at: '2026-02-09T09:00:00.000Z', name: 'user.registered', value: null, user: 'd', plan: null },
  { at: '2026-03-02T03:00:00.000Z', name: ORDERS, value: 50, user: 'b', plan: 'pro' },
]

beforeAll(async () => {
  const email = `matrix-owner-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'pro', CURRENT_TIMESTAMP)`,
    ['matrix owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }
  projectId = Number((await createProject(owner, { name: `Matrix ${stamp}`, timezone: 'UTC' })).id)

  // Inserted directly: `storeEvents` refuses anything older than thirty days,
  // which is right for a public write endpoint and incompatible with a dataset
  // that has to stay on the same calendar dates forever.
  for (const event of FIXTURE) {
    await db.unsafe(
      `INSERT INTO events (project_id, name, occurred_at, received_at, value, currency, user_key, properties)
       VALUES ($1, $2, $3, $3, $4, 'USD', $5, $6)`,
      [
        projectId,
        event.name,
        event.at,
        event.value,
        event.user,
        event.plan === null ? null : JSON.stringify({ plan: event.plan }),
      ],
    )
  }
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

/** Run one query over the frozen range. */
async function ask(query: Record<string, unknown>) {
  return runQuery({ projectId, range: RANGE, query: { filters: [], ...query } as never })
}

/** The buckets that actually hold something, in time order. */
function filled(result: Awaited<ReturnType<typeof runQuery>>): number[] {
  return result.series[0]!.points.filter(point => Number(point.value) !== 0).map(point => Number(point.value))
}

describe('the fixture is what the table above says', () => {
  test('six events, five of them orders', async () => {
    // Guards every expectation below. A fixture that half-inserted would make
    // the rest of this file assert the wrong arithmetic against itself.
    const rows = await db.unsafe(
      `SELECT COUNT(*) AS n FROM events WHERE project_id = $1`,
      [projectId],
    ) as Array<{ n: number }>

    expect(Number(rows[0]!.n)).toBe(6)
    expect((await ask({ events: [ORDERS], measure: 'count', grain: 'day' })).total).toBe(5)
  })
})

describe('every measure, worked out by hand', () => {
  test('count: five orders', async () => {
    expect(Number((await ask({ events: [ORDERS], measure: 'count', grain: 'day' })).total)).toBe(5)
  })

  test('count_unique: a, b and c, so three people', async () => {
    // a bought on two days and b on two months, so any count that added up
    // per-bucket distincts would say five. The headline is asked over the whole
    // range instead, because "how many customers bought" has one answer and it
    // is not the sum of the daily answers.
    expect(Number((await ask({ events: [ORDERS], measure: 'count_unique', grain: 'day' })).total)).toBe(3)
  })

  test('count_unique does not change when the grain does', async () => {
    // The strongest statement of the same property. How many people bought is a
    // fact about the range, so drawing it in months rather than days cannot
    // change it. Under per-bucket summing it changed with every grain.
    for (const grain of ['day', 'week', 'month'] as const)
      expect(Number((await ask({ events: [ORDERS], measure: 'count_unique', grain })).total)).toBe(3)
  })

  test('sum: 10 + 20 + 30 + 40 + 50 = 150', async () => {
    expect(Number((await ask({ events: [ORDERS], measure: 'sum', field: 'value', grain: 'day' })).total)).toBe(150)
  })

  test('avg: 150 over 5 orders = 30', async () => {
    // The mean of the values, not the mean of the daily means. Folding bucket
    // averages would give (15 + 30 + 40 + 50) / 4 = 33.75, which weights 2
    // February's two orders the same as 2 March's one.
    expect(Number((await ask({ events: [ORDERS], measure: 'avg', field: 'value', grain: 'day' })).total)).toBe(30)
  })

  test('avg does not change when the grain does', async () => {
    // Same property as count_unique: an average order value is a fact about the
    // range, not about how it was drawn.
    for (const grain of ['day', 'week', 'month'] as const)
      expect(Number((await ask({ events: [ORDERS], measure: 'avg', field: 'value', grain })).total)).toBe(30)
  })

  test('avg ignores the event that carries no value at all', async () => {
    // Including every event adds the registration, whose value is null. Six
    // events, five values: reading the null as a zero would give 25.
    const result = await ask({ events: [], measure: 'avg', field: 'value', grain: 'day' })

    expect(Number(result.total)).toBe(30)
  })

  test('min: 10, and max: 50', async () => {
    expect(Number((await ask({ events: [ORDERS], measure: 'min', field: 'value', grain: 'day' })).total)).toBe(10)
    expect(Number((await ask({ events: [ORDERS], measure: 'max', field: 'value', grain: 'day' })).total)).toBe(50)
  })
})

describe('every grain, on a calendar that does not move', () => {
  test('hour: five orders in five distinct hours', async () => {
    expect(filled(await ask({ events: [ORDERS], measure: 'count', grain: 'hour' }))).toEqual([1, 1, 1, 1, 1])
  })

  test('day: 2 Feb has two, then one each on 3 Feb, 9 Feb and 2 Mar', async () => {
    expect(filled(await ask({ events: [ORDERS], measure: 'count', grain: 'day' }))).toEqual([2, 1, 1, 1])
  })

  test('week: three in the week of Monday 2 Feb, then one, then one', async () => {
    // 2 Feb and 9 Feb are consecutive Mondays, so 2 and 3 Feb fall in the same
    // week and 9 Feb starts the next. Weeks start on Monday.
    expect(filled(await ask({ events: [ORDERS], measure: 'count', grain: 'week' }))).toEqual([3, 1, 1])
  })

  test('month: four in February, one in March', async () => {
    expect(filled(await ask({ events: [ORDERS], measure: 'count', grain: 'month' }))).toEqual([4, 1])
  })

  test('a sum is bucketed by the same calendar', async () => {
    // 10 + 20 on 2 Feb, 30 on the 3rd, 40 on the 9th, 50 on 2 Mar.
    expect(filled(await ask({ events: [ORDERS], measure: 'sum', field: 'value', grain: 'day' }))).toEqual([30, 30, 40, 50])
    // By week: 10 + 20 + 30, then 40, then 50.
    expect(filled(await ask({ events: [ORDERS], measure: 'sum', field: 'value', grain: 'week' }))).toEqual([60, 40, 50])
    // By month: 10 + 20 + 30 + 40, then 50.
    expect(filled(await ask({ events: [ORDERS], measure: 'sum', field: 'value', grain: 'month' }))).toEqual([100, 50])
  })

  test('the total is the same whatever the grain', async () => {
    // Bucketing decides where a number is drawn, never how much there is. A
    // grain that dropped or duplicated an edge event would show up here and
    // nowhere else.
    for (const grain of ['hour', 'day', 'week', 'month'] as const) {
      const result = await ask({ events: [ORDERS], measure: 'sum', field: 'value', grain })
      expect(Number(result.total)).toBe(150)
    }
  })
})

describe('every filter operator', () => {
  const count = async (filter: Record<string, unknown>) =>
    Number((await ask({ events: [], measure: 'count', grain: 'day', filters: [filter] })).total)

  test('is: the orders, and nothing else', async () => {
    expect(await count({ field: 'name', operator: 'is', value: ORDERS })).toBe(5)
  })

  test('is_not: everything except the orders, which is the registration', async () => {
    expect(await count({ field: 'name', operator: 'is_not', value: ORDERS })).toBe(1)
  })

  test('contains: matches inside the value, not only at its start', async () => {
    expect(await count({ field: 'name', operator: 'contains', value: 'order' })).toBe(5)
    // `registered` contains `register`; `commerce.order.created` does not.
    expect(await count({ field: 'name', operator: 'contains', value: 'register' })).toBe(1)
  })

  test('starts_with: anchored, so an interior match does not count', async () => {
    expect(await count({ field: 'name', operator: 'starts_with', value: 'commerce' })).toBe(5)
    expect(await count({ field: 'name', operator: 'starts_with', value: 'user' })).toBe(1)
    // 'order' appears in the middle of every order name and at the start of none.
    expect(await count({ field: 'name', operator: 'starts_with', value: 'order' })).toBe(0)
  })

  test('gt and lt: 25 splits the values two against three', async () => {
    // 30, 40, 50 above; 10 and 20 below. Neither includes the registration,
    // which has no value at all.
    expect(await count({ field: 'value', operator: 'gt', value: 25 })).toBe(3)
    expect(await count({ field: 'value', operator: 'lt', value: 25 })).toBe(2)
  })

  test('gt and lt are strict, so the boundary itself is in neither', async () => {
    expect(await count({ field: 'value', operator: 'gt', value: 30 })).toBe(2)
    expect(await count({ field: 'value', operator: 'lt', value: 30 })).toBe(2)
  })

  test('exists and not_exists: the registration carries no plan', async () => {
    expect(await count({ field: 'properties.plan', operator: 'exists' })).toBe(5)
    expect(await count({ field: 'properties.plan', operator: 'not_exists' })).toBe(1)
  })

  test('a filter on a property value, not just its presence', async () => {
    expect(await count({ field: 'properties.plan', operator: 'is', value: 'pro' })).toBe(3)
    expect(await count({ field: 'properties.plan', operator: 'is', value: 'starter' })).toBe(2)
  })

  test('a filter on user_key', async () => {
    // a on 2 and 3 Feb, b on 2 Feb and 2 Mar, c once, d once.
    expect(await count({ field: 'user_key', operator: 'is', value: 'a' })).toBe(2)
    expect(await count({ field: 'user_key', operator: 'is', value: 'd' })).toBe(1)
  })
})

describe('dimensions, against the same arithmetic', () => {
  /** Series keyed by dimension value, with each series total. */
  async function byPlan(measure: string, field?: string) {
    const result = await ask({
      events: [ORDERS],
      measure,
      ...(field ? { field } : {}),
      grain: 'day',
      dimension: 'properties.plan',
    })

    return Object.fromEntries(result.series.map(series => [String(series.key), Number(series.total)]))
  }

  test('count splits three pro against two starter', async () => {
    expect(await byPlan('count')).toEqual({ pro: 3, starter: 2 })
  })

  test('sum splits 10 + 20 + 50 against 30 + 40', async () => {
    expect(await byPlan('sum', 'value')).toEqual({ pro: 80, starter: 70 })
  })

  test('the split adds back up to the undivided total', async () => {
    // A dimension that dropped rows with an unusual value, or counted one twice,
    // shows up as a total that no longer reconciles.
    const split = await byPlan('sum', 'value')
    const whole = Number((await ask({ events: [ORDERS], measure: 'sum', field: 'value', grain: 'day' })).total)

    expect(Object.values(split).reduce((total, value) => total + value, 0)).toBe(whole)
  })

  test('min and max are per series, not the whole set repeated', async () => {
    expect(await byPlan('min', 'value')).toEqual({ pro: 10, starter: 30 })
    expect(await byPlan('max', 'value')).toEqual({ pro: 50, starter: 40 })
  })

  test('count_unique per plan, bucket by bucket as everywhere else', async () => {
    // pro: 2 Feb has a and b, 2 Mar has b, so 3. starter: 3 Feb has a, 9 Feb
    // has c, so 2. The two do not add to the three distinct people in the
    // fixture, because a bought on both plans and distinct counts never
    // compose. The engine is consistent about this rather than right in one
    // place and wrong in another.
    expect(await byPlan('count_unique')).toEqual({ pro: 3, starter: 2 })
  })
})
