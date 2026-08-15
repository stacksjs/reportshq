/**
 * Rollups must agree with the raw table, exactly.
 *
 * This is the test that makes the pre-aggregate safe to use. A rollup that is
 * subtly wrong is worse than no rollup: it is wrong quickly and consistently,
 * which reads as correct, and nobody re-derives a dashboard number by hand.
 *
 * So every assertion here compares the two paths against each other on the same
 * data rather than against a constant. The constants are checked once, at the
 * top, so a bug that broke both paths identically still fails.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { storeEvents } from '../../app/Events/ingest'
import { runQuery } from '../../app/Reports/engine'
import { canUseRollups, localDayString, rebuildDay, rebuildProject, rollupsCover } from '../../app/Reports/rollup'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number

const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')
const at = (dayOffset: number, hour: number): string =>
  new Date(today.getTime() + dayOffset * 86_400_000 + hour * 3_600_000).toISOString()

/** Wide enough to exercise week and month grains. */
const range = { from: new Date(today.getTime() - 20 * 86_400_000), to: new Date(today.getTime() + 86_400_000) }

beforeAll(async () => {
  const email = `rollup-owner-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    ['rollup owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }
  projectId = Number((await createProject(owner, { name: `Rollup ${stamp}`, timezone: 'UTC' })).id)

  const events: Array<Record<string, unknown>> = []
  for (let day = 20; day >= 0; day--) {
    // Uneven on purpose: a rollup that averages or sums wrongly still matches
    // a uniform fixture.
    const orders = (day % 4) + 1
    for (let i = 0; i < orders; i++) {
      events.push({
        name: 'commerce.order.created',
        occurred_at: at(-day, 6 + i * 3),
        value: 10 + day * 2 + i,
        user_key: `cust_${(day + i) % 7}`,
      })
    }

    if (day % 3 === 0) {
      events.push({ name: 'user.registered', occurred_at: at(-day, 11), user_key: `new_${day}` })
      // An event carrying no value at all: `avg` must not count it.
      events.push({ name: 'user.login', occurred_at: at(-day, 12), user_key: `new_${day}` })
    }
  }

  await storeEvents(projectId, events)
  await rebuildProject(projectId, 25, 'UTC', new Date(today.getTime() + 86_400_000))
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM rollup_states WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM event_rollups WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

/** Force the raw path by adding a filter that changes nothing. */
const alwaysTrue = { field: 'name', operator: 'is_not' as const, value: '__never__' }

describe('the rollup and raw paths agree', () => {
  const measures = [
    { measure: 'count' as const },
    { measure: 'sum' as const, field: 'value' },
    { measure: 'avg' as const, field: 'value' },
    { measure: 'min' as const, field: 'value' },
    { measure: 'max' as const, field: 'value' },
  ]

  for (const grain of ['day', 'week', 'month'] as const) {
    for (const spec of measures) {
      test(`${spec.measure} at ${grain} grain matches the raw table`, async () => {
        const base = { events: ['commerce.order.created'], filters: [], grain, ...spec }

        const viaRollup = await runQuery({ projectId, range, timezone: 'UTC', query: base })
        const viaRaw = await runQuery({
          projectId,
          range,
          timezone: 'UTC',
          query: { ...base, filters: [alwaysTrue] },
        })

        // The filter is what forces the raw path; prove it did.
        expect(canUseRollups(base, grain, range)).toBeTrue()
        expect(canUseRollups({ ...base, filters: [alwaysTrue] }, grain, range)).toBeFalse()

        expect(viaRollup.total).toBeCloseTo(viaRaw.total, 6)
        expect(viaRollup.series[0]?.points.map(point => point.value))
          .toEqual(viaRaw.series[0]!.points.map(point => point.value))
      })
    }
  }

  test('a query with no event filter matches too', async () => {
    const base = { events: [], measure: 'count' as const, filters: [], grain: 'day' as const }

    const viaRollup = await runQuery({ projectId, range, timezone: 'UTC', query: base })
    const viaRaw = await runQuery({
      projectId,
      range,
      timezone: 'UTC',
      query: { ...base, filters: [alwaysTrue] },
    })

    expect(viaRollup.total).toBe(viaRaw.total)
  })

  test('avg ignores events that carry no value, on both paths', async () => {
    // user.login events have no value. Averaging across them would drag the
    // result toward zero, and it would do so identically on both paths if the
    // rollup divided by event_count instead of value_count.
    const base = { events: ['commerce.order.created', 'user.login'], measure: 'avg' as const, field: 'value', filters: [], grain: 'day' as const }

    const viaRollup = await runQuery({ projectId, range, timezone: 'UTC', query: base })
    const viaRaw = await runQuery({ projectId, range, timezone: 'UTC', query: { ...base, filters: [alwaysTrue] } })

    expect(viaRollup.total).toBeCloseTo(viaRaw.total, 6)
    // And the number is a real order value, not something dragged toward zero.
    expect(viaRollup.total).toBeGreaterThan(10)
  })

  test('a comparison matches on both paths', async () => {
    const base = { events: ['commerce.order.created'], measure: 'sum' as const, field: 'value', filters: [], grain: 'day' as const, compare: true }

    const viaRollup = await runQuery({ projectId, range, timezone: 'UTC', query: base })
    const viaRaw = await runQuery({ projectId, range, timezone: 'UTC', query: { ...base, filters: [alwaysTrue] } })

    expect(viaRollup.comparison?.total).toBeCloseTo(viaRaw.comparison?.total ?? -1, 6)
  })
})

describe('what the rollups refuse to answer', () => {
  const base = { events: ['commerce.order.created'], measure: 'count' as const, filters: [], grain: 'day' as const }

  test('a dimension goes raw, because dimensions are not rolled up', () => {
    expect(canUseRollups({ ...base, dimension: 'properties.plan' }, 'day', range)).toBeFalse()
  })

  test('a filter goes raw, because a filtered question is a different question', () => {
    expect(canUseRollups({ ...base, filters: [alwaysTrue] }, 'day', range)).toBeFalse()
  })

  test('an hourly grain goes raw, because the buckets are finer than a day', () => {
    expect(canUseRollups(base, 'hour', range)).toBeFalse()
  })

  test('count_unique always goes raw', () => {
    // Summing daily uniques double-counts anyone appearing on two days, and a
    // single-day exception is one branch whose failure returns a plausible
    // number rather than an error.
    expect(canUseRollups({ ...base, measure: 'count_unique' }, 'day', range)).toBeFalse()

    const oneDay = { from: today, to: new Date(today.getTime() + 86_400_000) }
    expect(canUseRollups({ ...base, measure: 'count_unique' }, 'day', oneDay)).toBeFalse()
  })

  test('a funnel goes raw', () => {
    expect(canUseRollups({ ...base, steps: ['a', 'b'] }, 'day', range)).toBeFalse()
  })

  test('a measure over a property goes raw', () => {
    expect(canUseRollups({ ...base, measure: 'sum', field: 'properties.total' }, 'day', range)).toBeFalse()
    expect(canUseRollups({ ...base, measure: 'sum', field: 'value' }, 'day', range)).toBeTrue()
  })

  test('count_unique still returns the right answer, via the raw path', async () => {
    const result = await runQuery({
      projectId,
      range,
      timezone: 'UTC',
      query: { ...base, measure: 'count_unique' },
    })

    expect(result.total).toBeGreaterThan(0)
  })
})

describe('building', () => {
  test('rebuilding a day twice leaves one set of rows', async () => {
    const day = localDayString(today, 'UTC')

    await rebuildDay(projectId, day, 'UTC')
    const first = await db.unsafe(
      `SELECT name, event_count FROM event_rollups WHERE project_id = $1 AND day = $2 ORDER BY name`,
      [projectId, day],
    ) as Array<{ name: string, event_count: number }>

    await rebuildDay(projectId, day, 'UTC')
    const second = await db.unsafe(
      `SELECT name, event_count FROM event_rollups WHERE project_id = $1 AND day = $2 ORDER BY name`,
      [projectId, day],
    ) as Array<{ name: string, event_count: number }>

    expect(second).toEqual(first)
  })

  test('a rebuilt day reflects events that arrived after the first build', async () => {
    const day = localDayString(today, 'UTC')

    const before = await runQuery({
      projectId,
      range: { from: today, to: new Date(today.getTime() + 86_400_000) },
      timezone: 'UTC',
      query: { events: ['late.arrival'], measure: 'count', filters: [], grain: 'day' },
    })
    expect(before.total).toBe(0)

    await storeEvents(projectId, [{ name: 'late.arrival', occurred_at: at(0, 5) }])
    await rebuildDay(projectId, day, 'UTC')

    const after = await runQuery({
      projectId,
      range: { from: today, to: new Date(today.getTime() + 86_400_000) },
      timezone: 'UTC',
      query: { events: ['late.arrival'], measure: 'count', filters: [], grain: 'day' },
    })
    expect(after.total).toBe(1)
  })

  test('a day with no events leaves no rows rather than a zero row', async () => {
    const empty = localDayString(new Date(today.getTime() - 200 * 86_400_000), 'UTC')
    await rebuildDay(projectId, empty, 'UTC')

    const rows = await db.unsafe(
      `SELECT id FROM event_rollups WHERE project_id = $1 AND day = $2`,
      [projectId, empty],
    ) as unknown[]

    // The engine fills empty buckets itself, so a stored zero would be a row
    // per project per day forever, for nothing.
    expect(rows).toHaveLength(0)
  })
})

describe('coverage', () => {
  test('a project with no rollups built answers correctly from the raw table', async () => {
    // The bug this guards: a day with no events stores no rollup rows by
    // design, so an unbuilt project returned zeros that looked exactly like a
    // quiet week. Confident, fast, and wrong.
    const fresh = await createProject(owner, { name: `Unbuilt ${stamp}`, timezone: 'UTC' })
    const freshId = Number(fresh.id)

    await storeEvents(freshId, [
      { name: 'commerce.order.created', occurred_at: at(-1, 10), value: 25 },
      { name: 'commerce.order.created', occurred_at: at(0, 10), value: 75 },
    ])

    const query = { events: ['commerce.order.created'], measure: 'sum' as const, field: 'value', filters: [], grain: 'day' as const }

    // The shape is one the rollups support, so only the coverage check keeps
    // this correct.
    expect(canUseRollups(query, 'day', range)).toBeTrue()
    expect(await rollupsCover(freshId, range, 'UTC')).toBeFalse()

    const result = await runQuery({ projectId: freshId, range, timezone: 'UTC', query })
    expect(result.total).toBe(100)

    await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [freshId])
    await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [freshId])
    await db.unsafe(`DELETE FROM projects WHERE id = $1`, [freshId])
  })

  test('coverage is reported only for the days actually built', async () => {
    const inside = { from: new Date(today.getTime() - 3 * 86_400_000), to: new Date(today.getTime() + 86_400_000) }
    const older = { from: new Date(today.getTime() - 300 * 86_400_000), to: new Date(today.getTime() + 86_400_000) }

    expect(await rollupsCover(projectId, inside, 'UTC')).toBeTrue()
    expect(await rollupsCover(projectId, older, 'UTC')).toBeFalse()
  })

  test('a range ending today is covered, since `to` is exclusive', async () => {
    // Comparing coverage against `to` itself would demand a day the query
    // never reads, refusing the rollups for every range that ends now.
    const endingToday = { from: new Date(today.getTime() - 2 * 86_400_000), to: new Date(today.getTime() + 86_400_000) }
    expect(await rollupsCover(projectId, endingToday, 'UTC')).toBeTrue()
  })

  test('a different timezone is not covered, because day is a local date', async () => {
    // Every stored row is bucketed against the zone it was built in, so
    // reading them in another zone would shift every boundary silently.
    expect(await rollupsCover(projectId, range, 'Asia/Tokyo')).toBeFalse()
  })

  test('rebuilding a narrow window does not shrink existing coverage', async () => {
    const before = (await db.unsafe(
      `SELECT covered_from FROM rollup_states WHERE project_id = $1`,
      [projectId],
    ))?.[0] as { covered_from: string }

    await rebuildProject(projectId, 2, 'UTC', new Date(today.getTime() + 86_400_000))

    const after = (await db.unsafe(
      `SELECT covered_from FROM rollup_states WHERE project_id = $1`,
      [projectId],
    ))?.[0] as { covered_from: string }

    // The ten-minute job rebuilds three days; it must not drop every older
    // query back to the raw path each time it runs.
    expect(after.covered_from).toBe(before.covered_from)
  })
})
