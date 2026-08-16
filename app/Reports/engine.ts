/**
 * Block config in, numbers out.
 *
 * Everything a chart renders comes through here, so two properties matter more
 * than speed. The result shape is the same whatever the block asks for, so a
 * chart component never branches on which measure produced it. And every value
 * that reaches SQL is either a bound parameter or a token from a closed list;
 * a field name is never interpolated on the strength of having passed a regex.
 *
 * Filters, dimensions and measures are validated by app/Reports/schema.ts
 * before a block is stored, and validated again here, because a block is not
 * the only way in: a template ships JSON, and the builder previews a config
 * that has never been saved.
 */
import type { BlockQuery, Filter, Grain, Measure } from './schema'
import type { Range } from './range'
import { db } from '@stacksjs/database'
import { foldMeasure, meanOfMeaningful } from './aggregate'
import { bucketsFor, defaultGrain, previousRange, resolveRange, truncate } from './range'
import { canUseRollups, rollupAverage, rollupSeries, rollupsCover } from './rollup'
import { DEFAULT_SERIES, isAllowedField, validateBlockQuery } from './schema'
import { getDialectDriver, resolveDialect, toDialectPlaceholders } from 'bun-query-builder'

/**
 * Whether this query should read the pre-aggregate.
 *
 * Shape first, because it is a pure check and refuses most of what cannot be
 * answered; coverage second, because it costs a query. Both have to hold: a
 * shape the rollups support over days they have never built is the case that
 * returns a confident zero.
 */
async function useRollups(
  projectId: number,
  query: BlockQuery,
  grain: Grain,
  range: Range,
  timezone: string,
): Promise<boolean> {
  if (!canUseRollups(query, grain, range))
    return false

  return await rollupsCover(projectId, range, timezone)
}

export interface Point {
  /** Bucket start, ISO 8601. */
  t: string
  value: number
}

export interface Series {
  /** The dimension value, or `total` when the block has no dimension. */
  key: string
  points: Point[]
  total: number
}

export interface EngineResult {
  series: Series[]
  /** Every series summed: the number a big-number block shows. */
  total: number
  grain: Grain
  range: { from: string, to: string }
  /** Present when the block asked for a comparison. */
  comparison?: {
    total: number
    range: { from: string, to: string }
    /** Fractional change, or null when the previous period was zero. */
    change: number | null
  }
  /** Funnel steps, in order, when the block is a funnel. */
  steps?: Array<{ name: string, count: number, rate: number }>
}

export interface RunOptions {
  projectId: number
  query: BlockQuery
  timezone?: string
  /** A range token, or explicit instants from a viewer's date picker. */
  range?: string | Range
  now?: Date
}

/** Columns a measure or dimension may name, mapped to real SQL. */
function columnFor(field: string): string {
  if (field.startsWith('properties.')) {
    // Read through the driver's JSON accessor rather than string surgery on
    // the stored text. The key is a bound parameter, so a property called
    // `a") or 1=1 --` is a lookup that finds nothing rather than a hole.
    return getDialectDriver(resolveDialect()).jsonExtract('properties', '?')
  }

  return `"${field}"`
}

/** The SQL aggregate for a measure. */
function aggregateFor(measure: Measure, field?: string): { sql: string, needsField: boolean } {
  switch (measure) {
    case 'count':
      return { sql: 'COUNT(*)', needsField: false }
    case 'count_unique':
      return { sql: 'COUNT(DISTINCT user_key)', needsField: false }
    case 'sum':
      return { sql: `COALESCE(SUM(CAST(${field ? columnFor(field) : 'value'} AS REAL)), 0)`, needsField: true }
    case 'avg':
      return { sql: `AVG(CAST(${field ? columnFor(field) : 'value'} AS REAL))`, needsField: true }
    case 'min':
      return { sql: `MIN(CAST(${field ? columnFor(field) : 'value'} AS REAL))`, needsField: true }
    case 'max':
      return { sql: `MAX(CAST(${field ? columnFor(field) : 'value'} AS REAL))`, needsField: true }
  }
}

interface Clause {
  sql: string
  params: unknown[]
}

/**
 * One filter, as a SQL fragment plus its bound values.
 *
 * A property column compiles to `json_extract(properties, '$.' || ?)`, so it
 * carries a placeholder of its own. Operators that mention the column twice
 * therefore need the key bound twice, and building the fragment by string
 * concatenation while pushing the key once produced
 * `SQLite query expected 7 values, received 6` from three of the eight
 * operators. The column is emitted through a closure that pushes as it goes,
 * so placeholders and parameters cannot drift apart again however the fragment
 * is written.
 */
function filterClause(filter: Filter): Clause | null {
  if (!isAllowedField(filter.field))
    return null

  const params: unknown[] = []
  const isProperty = filter.field.startsWith('properties.')
  const key = isProperty ? filter.field.slice('properties.'.length) : null

  /** The column, binding its key if it has one. Call once per occurrence. */
  const column = (): string => {
    if (key !== null)
      params.push(key)
    return columnFor(filter.field)
  }

  const value = (transform: (input: unknown) => unknown = input => input): string => {
    params.push(transform(filter.value))
    return '?'
  }

  switch (filter.operator) {
    case 'is':
      return { sql: `${column()} = ${value()}`, params }
    case 'is_not':
      // Rows where the property is absent are kept: "plan is not pro" reads as
      // including events with no plan at all, which is what people mean.
      return { sql: `(${column()} IS NULL OR ${column()} != ${value()})`, params }
    case 'contains':
      return { sql: `${column()} LIKE ${value(input => `%${String(input)}%`)}`, params }
    case 'starts_with':
      return { sql: `${column()} LIKE ${value(input => `${String(input)}%`)}`, params }
    case 'gt':
      // Cast both sides: as text, "9" is greater than "50".
      return { sql: `CAST(${column()} AS REAL) > CAST(${value()} AS REAL)`, params }
    case 'lt':
      return { sql: `CAST(${column()} AS REAL) < CAST(${value()} AS REAL)`, params }
    case 'exists':
      return { sql: `(${column()} IS NOT NULL AND ${column()} != '')`, params }
    case 'not_exists':
      return { sql: `(${column()} IS NULL OR ${column()} = '')`, params }
    default:
      return null
  }
}

/** The WHERE shared by every query the engine runs. */
function whereFor(projectId: number, query: BlockQuery, range: Range): Clause {
  const parts = ['project_id = ?', 'occurred_at >= ?', 'occurred_at < ?']
  const params: unknown[] = [projectId, range.from.toISOString(), range.to.toISOString()]

  if (query.events.length > 0) {
    parts.push(`name IN (${query.events.map(() => '?').join(', ')})`)
    params.push(...query.events)
  }

  for (const filter of query.filters ?? []) {
    const clause = filterClause(filter)
    if (!clause)
      continue
    parts.push(clause.sql)
    params.push(...clause.params)
  }

  return { sql: parts.join(' AND '), params }
}

/**
 * Bucket an ISO timestamp in the project's timezone.
 *
 * Done in SQL rather than in JS so grouping happens once in the database
 * instead of pulling every row across. The offset is applied as a fixed number
 * of hours for the range, which is correct except across a daylight-saving
 * boundary, where one bucket is an hour wide or three. The alternative is
 * grouping in JS, and for a reporting product the trade is worth naming: a
 * chart is off by one hour on two days a year, and never off by a whole row.
 */
function bucketExpression(grain: Grain, offsetHours: number): string {
  return getDialectDriver(resolveDialect()).dateBucket('occurred_at', grain, offsetHours)
}


function offsetHoursFor(timezone: string, at: Date): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(at).find(part => part.type === 'timeZoneName')?.value ?? 'GMT+0'

  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(formatted)
  if (!match)
    return 0

  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) + Number(match[3] ?? 0) / 60)
}

/**
 * Run a block query.
 *
 * Returns the same shape for every measure and both with and without a
 * dimension, so a chart component never has to ask what produced it.
 */
export async function runQuery(options: RunOptions): Promise<EngineResult> {
  const { projectId, query } = options
  const timezone = options.timezone ?? 'UTC'
  const now = options.now ?? new Date()

  const validation = validateBlockQuery(query)
  if (!validation.valid)
    throw new Error(validation.errors.join(' '))

  const range = typeof options.range === 'object' && options.range !== null
    ? options.range as Range
    : resolveRange(String(options.range ?? 'last_30_days'), timezone, now)

  const grain = query.grain ?? defaultGrain(range)
  const offsetHours = offsetHoursFor(timezone, range.from)

  if (query.steps && query.steps.length >= 2)
    return await runFunnel(projectId, query, range, grain, timezone)

  // The pre-aggregate when it can answer exactly, the raw table otherwise.
  // canUseRollups is strict on purpose: a rollup that quietly answers a
  // question it cannot answer accurately is worse than none, because it is
  // wrong quickly and consistently, which reads as correct.
  // Two questions, not one: can the rollups answer this shape, and do they
  // actually cover these days. A day with no events stores no rows, so an
  // unbuilt project would otherwise return zeros that look exactly like a
  // quiet week.
  const series = await useRollups(projectId, query, grain, range, timezone)
    ? await rollupSeries(projectId, query, range, grain, timezone)
    : await runSeries(projectId, query, range, grain, offsetHours, timezone)

  const total = await headlineTotal(projectId, query, range, series, timezone)

  const result: EngineResult = {
    series,
    total,
    grain,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  }

  if (query.compare) {
    const previous = previousRange(range, timezone)
    const previousSeries = await useRollups(projectId, query, grain, previous, timezone)
      ? await rollupSeries(projectId, query, previous, grain, timezone)
      : await runSeries(projectId, query, previous, grain, offsetHoursFor(timezone, previous.from), timezone)
    const previousTotal = await headlineTotal(projectId, query, previous, previousSeries, timezone)

    result.comparison = {
      total: previousTotal,
      range: { from: previous.from.toISOString(), to: previous.to.toISOString() },
      // Null rather than Infinity or 100%: "up from nothing" is not a
      // percentage, and rendering one is how a dashboard claims a 4000%
      // increase because yesterday happened to be zero.
      change: previousTotal === 0 ? null : (total - previousTotal) / previousTotal,
    }
  }

  return result
}

/**
 * The one number a headline shows for the whole range.
 *
 * A series and its headline answer two different questions, and only some
 * measures give the same answer to both. `count` and `sum` do: the buckets are
 * a partition, and adding them up is the range. `avg` and `count_unique` do
 * not, and folding their buckets produces a number that is not wrong by a
 * rounding error but wrong by a different question:
 *
 * - **`avg`** folded is a mean of daily means, which weights a Tuesday with one
 *   order the same as a Saturday with forty. A month of real orders reported an
 *   average order value 18% below the true one, and nothing about it looked
 *   odd.
 * - **`count_unique`** folded is daily distinct counts added together, so a
 *   customer who ordered on five days counted five times. The Customers
 *   report's headline read 97 buying customers for 40 real ones.
 *
 * So the headline is asked as its own question, over the whole range, with no
 * bucketing. The series keeps its per-bucket values, because a chart of unique
 * buyers per day genuinely is per day. The two numbers differ, and they are
 * supposed to: the total is not the sum of the bars, and for these measures it
 * never was.
 *
 * Everything else still folds, which keeps one code path for the composable
 * measures and avoids a second query for the common case.
 */
async function headlineTotal(
  projectId: number,
  query: BlockQuery,
  range: Range,
  series: Series[],
  timezone: string,
): Promise<number> {
  if (query.measure !== 'avg' && query.measure !== 'count_unique')
    return totalOf(series, query.measure)

  // A funnel's total is its own thing, computed by runFunnel, and never
  // reaches here.
  if (query.steps && query.steps.length >= 2)
    return totalOf(series, query.measure)

  // The rollups keep `value_sum` and `value_count` per day, which is exactly
  // what a weighted mean over the range needs. They never serve count_unique
  // at all: see canUseRollups.
  if (query.measure === 'avg' && await useRollups(projectId, query, 'day', range, timezone))
    return await rollupAverage(projectId, query, range, timezone)

  return await rangeAggregate(projectId, query, range)
}

/**
 * One aggregate over the whole range, ungrouped.
 *
 * Deliberately built from the same `whereFor` and `aggregateFor` the series
 * uses, so the headline can never be filtering differently from the chart above
 * it, which is the failure this fix would otherwise trade for the one it fixes.
 */
async function rangeAggregate(projectId: number, query: BlockQuery, range: Range): Promise<number> {
  const where = whereFor(projectId, query, range)
  const aggregate = aggregateFor(query.measure, query.field)

  const params: unknown[] = []

  // Same left-to-right parameter order as the series statement: the
  // aggregate's property key, if it has one, then the WHERE clause's.
  if (aggregate.needsField && query.field?.startsWith('properties.'))
    params.push(query.field.slice('properties.'.length))

  params.push(...where.params)

  const rows = await db.unsafe(
    toDialectPlaceholders(
      `SELECT ${aggregate.sql} AS value FROM events WHERE ${where.sql}`,
      resolveDialect(),
    ),
    params,
  ) as Array<{ value: number | null }>

  return Number(rows?.[0]?.value ?? 0)
}

/**
 * An average of averages is not an average, and a total of maxima is not a
 * maximum. The overall number is derived from the series the way the measure
 * actually composes.
 */
function totalOf(series: Series[], measure: Measure): number {
  const totals = series.map(entry => entry.total)

  if (totals.length === 0)
    return 0

  // An average is taken over every bucket rather than over the series totals,
  // so a dimension with two values does not average two averages and weight a
  // quiet series like a busy one.
  if (measure === 'avg')
    return meanOfMeaningful(series.flatMap(entry => entry.points).map(point => point.value))

  // Everything else folds the series totals the same way a series folds its own
  // buckets, which is what keeps a split consistent with the whole: an empty
  // series reports 0, and folding that into a minimum would reintroduce the
  // phantom zero the per-series calculation just removed.
  return foldMeasure(measure, totals)
}

async function runSeries(
  projectId: number,
  query: BlockQuery,
  range: Range,
  grain: Grain,
  offsetHours: number,
  timezone: string,
): Promise<Series[]> {
  const where = whereFor(projectId, query, range)
  const aggregate = aggregateFor(query.measure, query.field)
  const bucket = bucketExpression(grain, offsetHours)

  const params: unknown[] = []

  // Parameter order follows the statement, left to right: the aggregate's
  // property key (if any) appears before the dimension's, which appears before
  // the WHERE clause's.
  if (aggregate.needsField && query.field?.startsWith('properties.'))
    params.push(query.field.slice('properties.'.length))

  let dimensionSql = `'total'`
  if (query.dimension) {
    dimensionSql = columnFor(query.dimension)
    if (query.dimension.startsWith('properties.'))
      params.push(query.dimension.slice('properties.'.length))
  }

  params.push(...where.params)

  // The fragments above are written with `?`, which Postgres does not accept.
  // The library renumbers them and leaves any `?` inside a literal alone.
  const rows = await db.unsafe(
    toDialectPlaceholders(
      `SELECT ${bucket} AS bucket, ${dimensionSql} AS series_key, ${aggregate.sql} AS value
       FROM events
      WHERE ${where.sql}
      GROUP BY bucket, series_key
      ORDER BY bucket`,
      resolveDialect(),
    ),
    params,
  ) as Array<{ bucket: string, series_key: string | null, value: number | null }>

  const buckets = bucketsFor(range, grain, timezone).map(date => bucketKey(date, grain, offsetHours))
  const byKey = new Map<string, Map<string, number>>()

  for (const row of rows) {
    const key = row.series_key === null || row.series_key === '' ? '(none)' : String(row.series_key)
    if (!byKey.has(key))
      byKey.set(key, new Map())
    byKey.get(key)!.set(row.bucket, Number(row.value ?? 0))
  }

  let series: Series[] = [...byKey.entries()].map(([key, values]) => {
    // Every bucket in the range gets a point, present in the data or not. A
    // chart that skips empty days draws a line straight across them, which
    // reads as "steady" when it means "nothing happened".
    const points = buckets.map(bucketStart => ({
      t: bucketStart,
      value: values.get(bucketStart) ?? 0,
    }))

    return { key, points, total: totalOf([{ key, points, total: 0 }], query.measure) }
  })

  // Recompute totals now that points exist.
  series = series.map(entry => ({
    ...entry,
    total: foldMeasure(query.measure, entry.points.map(point => point.value)),
  }))

  if (!query.dimension)
    return series.length > 0 ? series : [{ key: 'total', points: buckets.map(t => ({ t, value: 0 })), total: 0 }]

  return collapseToTopN(series, query.limit ?? DEFAULT_SERIES, buckets)
}


/**
 * Keep the largest N series and fold the rest into one.
 *
 * A dimension with 400 values is 400 lines, which is a smear rather than a
 * chart. Folding the tail keeps the total honest, which dropping it would not.
 */
function collapseToTopN(series: Series[], limit: number, buckets: string[]): Series[] {
  const sorted = [...series].sort((a, b) => b.total - a.total)

  if (sorted.length <= limit)
    return sorted

  const kept = sorted.slice(0, limit)
  const rest = sorted.slice(limit)

  const other: Series = {
    key: 'Other',
    points: buckets.map((t, index) => ({
      t,
      value: rest.reduce((sum, entry) => sum + (entry.points[index]?.value ?? 0), 0),
    })),
    total: rest.reduce((sum, entry) => sum + entry.total, 0),
  }

  return [...kept, other]
}

/** The bucket key a row will have, computed the same way SQL computes it. */
function bucketKey(date: Date, grain: Grain, offsetHours: number): string {
  const shifted = new Date(date.getTime() + offsetHours * 3_600_000)
  const iso = shifted.toISOString()

  switch (grain) {
    case 'hour':
      return `${iso.slice(0, 13)}:00:00.000Z`
    case 'month':
      return `${iso.slice(0, 7)}-01T00:00:00.000Z`
    case 'week':
    case 'day':
    default:
      return `${iso.slice(0, 10)}T00:00:00.000Z`
  }
}

/**
 * A funnel: how many sessions reached each step, in order.
 *
 * Counted per session rather than per event, and each step only counts sessions
 * that reached the one before it. Counting events would let a session that
 * viewed six products and bought nothing report a 600% view step.
 */
async function runFunnel(
  projectId: number,
  query: BlockQuery,
  range: Range,
  grain: Grain,
  _timezone: string,
): Promise<EngineResult> {
  const steps = query.steps ?? []
  const counts: Array<{ name: string, count: number, rate: number }> = []

  let previousSessions: string[] | null = null
  let first = 0

  for (const step of steps) {
    const where = whereFor(projectId, { ...query, events: [step] }, range)
    const params = [...where.params]

    let sql = `SELECT DISTINCT session_key FROM events WHERE ${where.sql} AND session_key IS NOT NULL`

    if (previousSessions !== null) {
      if (previousSessions.length === 0) {
        counts.push({ name: step, count: 0, rate: 0 })
        continue
      }
      sql += ` AND session_key IN (${previousSessions.map(() => '?').join(', ')})`
      params.push(...previousSessions)
    }

    const rows = await db.unsafe(toDialectPlaceholders(sql, resolveDialect()), params) as Array<{ session_key: string }>
    const sessions = rows.map(row => row.session_key)

    if (previousSessions === null)
      first = sessions.length

    counts.push({
      name: step,
      count: sessions.length,
      rate: first === 0 ? 0 : sessions.length / first,
    })

    previousSessions = sessions
  }

  return {
    series: counts.map(step => ({
      key: step.name,
      points: [{ t: range.from.toISOString(), value: step.count }],
      total: step.count,
    })),
    total: counts[0]?.count ?? 0,
    grain,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    steps: counts,
  }
}

export { truncate }
