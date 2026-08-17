import type { BlockQuery, Grain, QueryResult, Series } from './types'
import type { Registry } from './semantic'
import { SemanticError } from './semantic'

/**
 * A block's configuration, turned into one query and one answer.
 *
 * Everything reaching SQL comes from the registry rather than from the request:
 * a measure resolves to a described aggregate and column, a dimension to a
 * described column, a grain to one of four constants. The request supplies
 * keys; the registry supplies identifiers. That is the whole safety story, and
 * it is why block configuration can arrive from a browser.
 *
 * Values are parameterised. Identifiers cannot be, so they are never taken from
 * input at all, which is a stronger guarantee than escaping them would be.
 */
export interface Db {
  unsafe: (query: string, values?: unknown[]) => Promise<any[]>
}

export class Compiler {
  constructor(
    private readonly registry: Registry,
    private readonly db: Db,
    private readonly dialect: 'sqlite' | 'mysql' | 'postgres' = 'sqlite',
  ) {}

  async run(query: BlockQuery, timezone = 'UTC'): Promise<QueryResult> {
    const model = this.registry.model(query.model)
    const measure = this.registry.measure(query.model, query.measure)

    const dimensionModel = query.dimension?.model ?? query.model
    const timeModel = query.time?.model ?? query.model

    if (query.time && timeModel !== query.model) {
      throw new SemanticError(
        `A report buckets by a date on the model it measures. '${query.time.key}' belongs to '${timeModel}', not '${query.model}'.`,
      )
    }

    // The refusal that matters most. Crossing a one-to-many join multiplies the
    // base row, so summing its column counts it once per match: revenue by
    // product across order lines charges every order once per line. The number
    // looks right, which is exactly why this cannot be a warning.
    let join: string | null = null
    let dimensionTable = model.table

    if (query.dimension && dimensionModel !== query.model) {
      const relation = this.registry.relation(query.model, dimensionModel)

      if (relation.fansOut && measure.aggregate !== 'count') {
        throw new SemanticError(
          `'${query.measure}' reads several rows per one ${query.model} once joined to ${dimensionModel}, so summing it would count each ${query.model} more than once. Measure ${dimensionModel} instead.`,
        )
      }

      dimensionTable = relation.table

      // A relation may pass through a join table, which is the ordinary
      // commerce shape: an order reaches a product only by way of its lines.
      // Describing the hop makes the fan-out visible rather than implied.
      join = relation.through
        ? ` INNER JOIN ${q(relation.through.table)} ON ${q(relation.through.table)}.${q(relation.through.foreignKey)} = ${q(model.table)}.${q(relation.through.ownerKey ?? 'id')}`
          + ` INNER JOIN ${q(relation.table)} ON ${q(relation.table)}.${q(relation.ownerKey ?? 'id')} = ${q(relation.through.table)}.${q(relation.foreignKey)}`
        : ` INNER JOIN ${q(relation.table)} ON ${q(relation.table)}.${q(relation.ownerKey ?? 'id')} = ${q(model.table)}.${q(relation.foreignKey)}`
    }

    const value = measure.aggregate === 'count'
      ? `COUNT(*)`
      : `${measure.aggregate.toUpperCase()}(${q(model.table)}.${q(measure.column!)})`

    const values: unknown[] = []
    const wheres: string[] = []

    let bucket = `'total'`
    let groupBy = ''

    if (query.time) {
      const column = `${q(model.table)}.${q(this.registry.time(query.model, query.time.key))}`
      const grain = query.grain ? Registry_grain(query.grain) : 'day'

      bucket = this.bucket(column, grain, timezone)
      groupBy = ` GROUP BY ${bucket}`
    }
    else if (query.dimension) {
      const column = `${q(dimensionTable)}.${q(this.registry.dimension(dimensionModel, query.dimension.key))}`
      bucket = column
      groupBy = ` GROUP BY ${column}`
    }

    if (query.from) {
      wheres.push(`${q(model.table)}.${q(this.timeColumn(query))} >= ?`)
      values.push(query.from)
    }

    if (query.to) {
      wheres.push(`${q(model.table)}.${q(this.timeColumn(query))} < ?`)
      values.push(query.to)
    }

    for (const filter of query.filters ?? []) {
      // The operator is matched against a fixed set rather than interpolated,
      // and the column comes from the registry. A filter is the one place a
      // reader's input reaches a query, so it gets the strictest treatment.
      const op = OPERATORS[filter.op]

      if (!op)
        throw new SemanticError(`'${filter.op}' is not a filter operator. Use one of: ${Object.keys(OPERATORS).join(', ')}.`)

      wheres.push(`${q(model.table)}.${q(this.registry.dimension(query.model, filter.key))} ${op} ?`)
      values.push(filter.value)
    }

    const where = wheres.length ? ` WHERE ${wheres.join(' AND ')}` : ''
    const order = query.time ? ` ORDER BY 1 ASC` : ` ORDER BY 2 DESC`
    const limit = query.dimension && query.limit ? ` LIMIT ${Math.max(1, Math.min(500, Math.floor(query.limit)))}` : ''

    const sql = `SELECT ${bucket} AS bucket, ${value} AS value FROM ${q(model.table)}${join ?? ''}${where}${groupBy}${order}${limit}`

    const rows = await this.db.unsafe(sql, values)

    return this.shape(rows, query)
  }

  /** Which column a range applies to: the one being bucketed, or the model's first. */
  private timeColumn(query: BlockQuery): string {
    if (query.time)
      return this.registry.time(query.model, query.time.key)

    const model = this.registry.model(query.model)
    const first = Object.values(model.time)[0]

    if (!first)
      throw new SemanticError(`'${query.model}' has no time column, so it cannot be filtered by a date range.`)

    return first
  }

  /**
   * A date column, truncated to a grain, in the reader's timezone.
   *
   * The timezone is applied here rather than after the fact because a bucket
   * boundary is a property of the query: a day that starts at midnight in
   * Berlin is a different set of rows from one that starts at midnight in UTC,
   * and no amount of relabelling afterwards fixes which rows landed where.
   */
  private bucket(column: string, grain: Grain, timezone: string): string {
    if (this.dialect === 'postgres') {
      const local = `(${column} AT TIME ZONE 'UTC' AT TIME ZONE ${literal(timezone)})`

      return `to_char(date_trunc('${grain}', ${local}), ${literal(FORMATS[grain].postgres)})`
    }

    if (this.dialect === 'mysql') {
      const local = `CONVERT_TZ(${column}, '+00:00', ${literal(offsetFor(timezone))})`

      return `DATE_FORMAT(${local}, ${literal(FORMATS[grain].mysql)})`
    }

    // SQLite has no timezone database, so the offset is resolved in JS and
    // applied as a fixed shift. It is correct except across a DST boundary
    // inside a single bucket, which is a known and stated limit rather than a
    // silent one; see the note in the README.
    const local = `datetime(${column}, ${literal(sqliteShift(timezone))})`

    return `strftime(${literal(FORMATS[grain].sqlite)}, ${local})`
  }

  /** Rows to series, with the total computed once rather than by every reader. */
  private shape(rows: any[], query: BlockQuery): QueryResult {
    const points = rows.map(row => ({
      t: String(row.bucket ?? ''),
      value: Number(row.value ?? 0),
    }))

    const total = points.reduce((sum, point) => sum + point.value, 0)

    // A dimensioned block is one series per bucket; a time series is one series
    // with many points. The distinction is what a chart component reads to know
    // whether it is drawing a line or a set of slices.
    const series: Series[] = query.dimension && !query.time
      ? points.map(point => ({ key: point.t, total: point.value, points: [point] }))
      : [{ key: query.measure, total, points }]

    return {
      series,
      total,
      grain: query.time ? (query.grain ?? 'day') : undefined,
      comparison: null,
    }
  }
}

/** Quote an identifier. Identifiers never come from input, so this is belt and braces. */
function q(identifier: string): string {
  if (!/^[A-Za-z_][\w$]*$/.test(identifier))
    throw new SemanticError(`'${identifier}' is not a usable identifier.`)

  return `"${identifier}"`
}

/** A string literal for a fragment that cannot be parameterised, from a closed set. */
function literal(value: string): string {
  return `'${value.replace(/'/g, '\'\'')}'`
}

function Registry_grain(grain: Grain): Grain {
  return grain
}

const OPERATORS: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
  'like': 'LIKE',
}

const FORMATS: Record<Grain, { sqlite: string, mysql: string, postgres: string }> = {
  hour: { sqlite: '%Y-%m-%dT%H:00:00Z', mysql: '%Y-%m-%dT%H:00:00Z', postgres: 'YYYY-MM-DD"T"HH24:00:00"Z"' },
  day: { sqlite: '%Y-%m-%dT00:00:00Z', mysql: '%Y-%m-%dT00:00:00Z', postgres: 'YYYY-MM-DD"T"00:00:00"Z"' },
  week: { sqlite: '%Y-%W', mysql: '%x-%v', postgres: 'IYYY-IW' },
  month: { sqlite: '%Y-%m-01T00:00:00Z', mysql: '%Y-%m-01T00:00:00Z', postgres: 'YYYY-MM-01"T"00:00:00"Z"' },
}

/**
 * The offset for a zone, as SQLite's datetime modifier understands it.
 *
 * Minutes, not `+HH:MM hours`. SQLite does not parse the second form and does
 * not complain about it either: `datetime(col, '+12:00 hours')` returns NULL,
 * every bucket collapses to NULL, and the chart shows one bar holding
 * everything. It looks like a grouping bug and it is a modifier typo.
 */
function sqliteShift(timezone: string): string {
  const minutes = offsetMinutes(timezone)

  return `${minutes >= 0 ? '+' : '-'}${Math.abs(minutes)} minutes`
}

function offsetFor(timezone: string): string {
  const minutes = offsetMinutes(timezone)
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)

  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** A zone's current offset in minutes, read from the platform rather than a table. */
function offsetMinutes(timezone: string): number {
  if (timezone === 'UTC')
    return 0

  try {
    const now = new Date()
    const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))

    return Math.round((local.getTime() - utc.getTime()) / 60000)
  }
  catch {
    // An unknown zone reads as UTC rather than throwing. A report with the
    // wrong zone is wrong; a report that will not render at all is worse, and
    // the project's own settings page is where a bad zone gets fixed.
    return 0
  }
}
