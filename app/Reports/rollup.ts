/**
 * Building and reading the daily pre-aggregate.
 *
 * Two halves: `rebuildDay` recomputes one project-day from the raw events, and
 * `rollupSeries` answers a query from the rollups when the query is one the
 * rollups can answer honestly.
 *
 * The honesty test is `canUseRollups`, and it is deliberately strict. A rollup
 * that quietly answers a question it cannot answer accurately is worse than no
 * rollup at all: it is wrong quickly and consistently, which reads as correct.
 */
import type { BlockQuery, Grain, Measure } from './schema'
import type { Range } from './range'
import type { Point, Series } from './engine'
import { db } from '@stacksjs/database'
import { bucketsFor, truncate } from './range'

/**
 * Which version of the rollup computation this code produces.
 *
 * **Bump this whenever a stored rollup value would come out different for the
 * same events**: a changed aggregate, a changed bucketing rule, a corrected
 * column type. Rows recorded under an older build are ignored until rebuilt, so
 * queries answer from the raw table in the meantime - slower, and right.
 *
 * Not bumping it is the dangerous direction, and it is the quiet one. A fix
 * ships, the numbers stay wrong, and everything reports success.
 *
 * 1: the first versioned build. `value_sum`, `value_min` and `value_max` were
 *    integer columns on Postgres, so every stored total was truncated to whole
 *    units. Widening them fixed what gets written next; every row already
 *    written stayed wrong, and the nightly job only revisits three days.
 */
export const ROLLUP_BUILD = 1

/**
 * Whether the rollups can answer this question exactly.
 *
 * The range is taken but unused: it was read when a single-day `count_unique`
 * had an exception, and the parameter stays so callers do not have to change
 * when a future measure needs it again.
 *
 * Every clause here is a case where the pre-aggregate would otherwise be
 * subtly wrong:
 *
 * - a **dimension** is not rolled up at all, because a row per property value
 *   is larger than the events it summarises for anything high-cardinality;
 * - a **filter** makes it a different question, and there is no way to
 *   pre-compute one nobody has asked;
 * - an **hourly grain** is finer than a day, so the buckets do not exist;
 * - **`count_unique`** does not compose across days, and summing daily uniques
 *   double-counts anyone who appears on two of them.
 */
export function canUseRollups(query: BlockQuery, grain: Grain, _range: Range): boolean {
  if (query.dimension)
    return false

  if ((query.filters ?? []).length > 0)
    return false

  if (query.steps && query.steps.length > 0)
    return false

  if (grain === 'hour')
    return false

  // `sum`, `avg`, `min` and `max` only make sense over `value`, which is the
  // one numeric column the rollup keeps. A measure over a property is a raw
  // query.
  if (query.field && query.field !== 'value')
    return false

  // A single-day range could be answered exactly from `unique_users`, and that
  // exception was written and then removed: it is one branch, reachable only
  // for one range width, and getting it wrong returns a plausible number
  // rather than an error. The raw path is correct for every width, and a
  // one-day query is the cheapest raw query there is.
  if (query.measure === 'count_unique')
    return false

  return true
}

/**
 * Recompute one project-day from raw events.
 *
 * Idempotent: the day is deleted and rewritten inside one pass, so a rebuild
 * that runs twice, or races another, leaves one correct set of rows rather
 * than doubled counts. The unique index on (project, day, name) is the
 * backstop.
 *
 * `day` is a project-local date, and the window it covers is computed from the
 * project's timezone offset at that date rather than a fixed one, so a rebuild
 * across a daylight-saving boundary still covers exactly one local day.
 */
export async function rebuildDay(projectId: number, day: string, timezone = 'UTC'): Promise<number> {
  const from = localDayStart(day, timezone)
  const to = new Date(from.getTime() + dayLengthMs(day, timezone))

  const rows = await db.unsafe(
    `SELECT name,
            COUNT(*) AS event_count,
            COALESCE(SUM(CASE WHEN value IS NOT NULL THEN CAST(value AS REAL) END), 0) AS value_sum,
            SUM(CASE WHEN value IS NOT NULL THEN 1 ELSE 0 END) AS value_count,
            MIN(CAST(value AS REAL)) AS value_min,
            MAX(CAST(value AS REAL)) AS value_max,
            COUNT(DISTINCT user_key) AS unique_users
       FROM events
      WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at < $3
      GROUP BY name`,
    [projectId, from.toISOString(), to.toISOString()],
  ) as Array<{
    name: string
    event_count: number
    value_sum: number
    value_count: number
    value_min: number | null
    value_max: number | null
    unique_users: number
  }>

  await db.unsafe(`DELETE FROM event_rollups WHERE project_id = $1 AND day = $2`, [projectId, day])

  const built = new Date().toISOString()

  for (const row of rows) {
    await db.unsafe(
      `INSERT INTO event_rollups (project_id, day, name, event_count, value_sum, value_count, value_min, value_max, unique_users, built_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        projectId,
        day,
        row.name,
        Number(row.event_count),
        Number(row.value_sum ?? 0),
        Number(row.value_count ?? 0),
        row.value_min,
        row.value_max,
        Number(row.unique_users ?? 0),
        built,
      ],
    )
  }

  return rows.length
}

/**
 * Rebuild a span of days.
 *
 * Used by the maintenance job for recent days, and in full by a project whose
 * timezone changed: `day` is a project-local date, so every existing row is
 * bucketed against the old zone and has to be recomputed.
 */
export async function rebuildProject(projectId: number, days: number, timezone = 'UTC', now = new Date()): Promise<number> {
  let rebuilt = 0

  for (let back = 0; back < days; back++) {
    const day = localDayString(new Date(now.getTime() - back * 86_400_000), timezone)
    rebuilt += await rebuildDay(projectId, day, timezone)
  }

  const from = localDayString(new Date(now.getTime() - (days - 1) * 86_400_000), timezone)
  const through = localDayString(now, timezone)

  await recordCoverage(projectId, from, through, timezone)

  return rebuilt
}

/**
 * Record which days are now covered.
 *
 * The window extends rather than replaces: a job that rebuilds the last three
 * days must not shrink coverage that a wider backfill established, or every
 * older query would silently drop back to the raw path for no reason.
 *
 * A timezone change is the exception. `day` is a project-local date, so every
 * existing row is bucketed against the old zone, and coverage restarts rather
 * than merging two incompatible sets.
 */
async function recordCoverage(projectId: number, from: string, through: string, timezone: string): Promise<void> {
  const existing = (await db.unsafe(
    `SELECT covered_from, covered_through, timezone, build FROM rollup_states WHERE project_id = $1`,
    [projectId],
  ))?.[0] as { covered_from: string | null, covered_through: string | null, timezone: string, build: number | null } | undefined

  // Coverage may only be widened from rows this build actually produced.
  // Extending across a zone change or a build change would claim days whose
  // stored numbers came out of a different calculation.
  const comparable = existing?.timezone === timezone && Number(existing?.build ?? 0) === ROLLUP_BUILD

  const nextFrom = comparable && existing?.covered_from && existing.covered_from < from ? existing.covered_from : from
  const nextThrough = comparable && existing?.covered_through && existing.covered_through > through ? existing.covered_through : through
  const builtAt = new Date().toISOString()

  if (existing) {
    await db.unsafe(
      `UPDATE rollup_states SET covered_from = $1, covered_through = $2, timezone = $3, built_at = $4, build = $5 WHERE project_id = $6`,
      [nextFrom, nextThrough, timezone, builtAt, ROLLUP_BUILD, projectId],
    )
    return
  }

  await db.unsafe(
    `INSERT INTO rollup_states (project_id, covered_from, covered_through, timezone, built_at, build)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [projectId, nextFrom, nextThrough, timezone, builtAt, ROLLUP_BUILD],
  )
}

/**
 * Whether the rollups cover a range, in the zone being asked about.
 *
 * Without this the engine cannot tell "no events that day" from "never built":
 * a day with no events stores no rows by design, so an unbuilt project returned
 * zeros that looked exactly like a quiet week. Caught by the engine tests,
 * which query projects whose rollups were never built.
 */
export async function rollupsCover(projectId: number, range: Range, timezone: string): Promise<boolean> {
  const state = (await db.unsafe(
    `SELECT covered_from, covered_through, timezone, build FROM rollup_states WHERE project_id = $1`,
    [projectId],
  ))?.[0] as { covered_from: string | null, covered_through: string | null, timezone: string, build: number | null } | undefined

  if (!state?.covered_from || !state.covered_through)
    return false

  if (state.timezone !== timezone)
    return false

  // Rows from an older computation are not trusted. Falling back to the raw
  // table is slower and always right, which is the correct way round: the
  // alternative is answering quickly from numbers we know were produced
  // differently.
  if (Number(state.build ?? 0) !== ROLLUP_BUILD)
    return false

  const from = localDayString(range.from, timezone)
  // `to` is exclusive, so the last day the range actually reads is the one
  // before it. Comparing against `to` itself would demand coverage of a day
  // the query never touches, and refuse the rollups for every range ending
  // today.
  const lastDay = localDayString(new Date(range.to.getTime() - 1), timezone)

  return state.covered_from <= from && state.covered_through >= lastDay
}

/** The project-local date of an instant, as YYYY-MM-DD. */
export function localDayString(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

function offsetMinutes(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant)

  const read = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0)
  const hour = read('hour')
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), hour === 24 ? 0 : hour, read('minute'), read('second'))

  return Math.round((asUtc - instant.getTime()) / 60_000)
}

/** Midnight, project-local, for a YYYY-MM-DD string. */
function localDayStart(day: string, timezone: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  const naive = Date.UTC(year!, (month ?? 1) - 1, date ?? 1, 0, 0, 0)
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), timezone) * 60_000)
  return new Date(naive - offsetMinutes(firstGuess, timezone) * 60_000)
}

/** How long that local day is: 23, 24 or 25 hours. */
function dayLengthMs(day: string, timezone: string): number {
  const start = localDayStart(day, timezone)
  const [year, month, date] = day.split('-').map(Number)
  const nextDay = new Date(Date.UTC(year!, (month ?? 1) - 1, (date ?? 1) + 1))
  const next = localDayStart(nextDay.toISOString().slice(0, 10), timezone)
  return next.getTime() - start.getTime()
}

/**
 * Answer a query from the rollups.
 *
 * Returns the same `Series[]` the raw path returns, so the engine can swap
 * between them without the caller noticing anything except the latency.
 */
export async function rollupSeries(
  projectId: number,
  query: BlockQuery,
  range: Range,
  grain: Grain,
  timezone: string,
): Promise<Series[]> {
  const conditions = ['project_id = $1', 'day >= $2', 'day < $3']
  const params: unknown[] = [
    projectId,
    localDayString(range.from, timezone),
    localDayString(range.to, timezone),
  ]

  if (query.events.length > 0) {
    const placeholders = query.events.map((_, index) => `$${params.length + index + 1}`)
    conditions.push(`name IN (${placeholders.join(', ')})`)
    params.push(...query.events)
  }

  const rows = await db.unsafe(
    `SELECT day, event_count, value_sum, value_count, value_min, value_max, unique_users
       FROM event_rollups
      WHERE ${conditions.join(' AND ')}`,
    params,
  ) as Array<{
    day: string
    event_count: number
    value_sum: number
    value_count: number
    value_min: number | null
    value_max: number | null
    unique_users: number
  }>

  // Several event names can share a day, so fold them together before
  // bucketing. `min` and `max` fold by extremum, everything else by sum.
  const byDay = new Map<string, { count: number, sum: number, valueCount: number, min: number | null, max: number | null, unique: number }>()

  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { count: 0, sum: 0, valueCount: 0, min: null, max: null, unique: 0 }

    entry.count += Number(row.event_count)
    entry.sum += Number(row.value_sum ?? 0)
    entry.valueCount += Number(row.value_count ?? 0)
    entry.unique += Number(row.unique_users ?? 0)

    if (row.value_min !== null)
      entry.min = entry.min === null ? Number(row.value_min) : Math.min(entry.min, Number(row.value_min))

    if (row.value_max !== null)
      entry.max = entry.max === null ? Number(row.value_max) : Math.max(entry.max, Number(row.value_max))

    byDay.set(row.day, entry)
  }

  const buckets = bucketsFor(range, grain, timezone)
  const points: Point[] = buckets.map((bucketStart) => {
    // Which local days fall in this bucket. For a daily grain that is one; for
    // a week or a month it is several, and they fold the same way.
    const bucketEnd = nextBucket(bucketStart, grain, timezone, buckets)
    let count = 0
    let sum = 0
    let valueCount = 0
    let min: number | null = null
    let max: number | null = null

    for (const [day, entry] of byDay) {
      const dayStart = localDayStart(day, timezone)
      if (dayStart < bucketStart || dayStart >= bucketEnd)
        continue

      count += entry.count
      sum += entry.sum
      valueCount += entry.valueCount

      if (entry.min !== null)
        min = min === null ? entry.min : Math.min(min, entry.min)
      if (entry.max !== null)
        max = max === null ? entry.max : Math.max(max, entry.max)
    }

    return {
      t: bucketKeyFor(bucketStart, grain, timezone),
      value: valueFor(query.measure, { count, sum, valueCount, min, max }),
    }
  })

  const total = totalFor(query.measure, points)

  return [{ key: 'total', points, total }]
}

function valueFor(
  measure: Measure,
  bucket: { count: number, sum: number, valueCount: number, min: number | null, max: number | null },
): number {
  switch (measure) {
    case 'sum':
      return bucket.sum
    case 'avg':
      // Over rows that carried a value, not over every event: averaging across
      // events with no value drags every average toward zero.
      return bucket.valueCount === 0 ? 0 : bucket.sum / bucket.valueCount
    case 'min':
      return bucket.min ?? 0
    case 'max':
      return bucket.max ?? 0
    case 'count':
    default:
      return bucket.count
  }
}

function totalFor(measure: Measure, points: Point[]): number {
  switch (measure) {
    case 'avg': {
      const meaningful = points.filter(point => point.value !== 0)
      return meaningful.length === 0 ? 0 : meaningful.reduce((sum, point) => sum + point.value, 0) / meaningful.length
    }
    case 'min':
      return Math.min(...points.map(point => point.value))
    case 'max':
      return Math.max(...points.map(point => point.value))
    default:
      return points.reduce((sum, point) => sum + point.value, 0)
  }
}

function nextBucket(bucketStart: Date, grain: Grain, timezone: string, buckets: Date[]): Date {
  const index = buckets.findIndex(bucket => bucket.getTime() === bucketStart.getTime())
  const next = buckets[index + 1]
  if (next)
    return next

  // The last bucket runs to the end of its own period.
  const approximate = grain === 'month' ? 31 : grain === 'week' ? 7 : 1
  return truncate(new Date(bucketStart.getTime() + approximate * 86_400_000 + 86_400_000), grain, timezone)
}

/** The bucket key the raw path would produce, so both agree. */
function bucketKeyFor(bucketStart: Date, grain: Grain, timezone: string): string {
  const local = localDayString(bucketStart, timezone)

  if (grain === 'month')
    return `${local.slice(0, 7)}-01T00:00:00.000Z`

  return `${local}T00:00:00.000Z`
}

