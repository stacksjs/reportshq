/**
 * Reading the event stream back.
 *
 * This is the raw-events browser, not the report engine (#10): it answers "what
 * arrived, and does it look right", which is the question an integrator asks in
 * the first ten minutes and almost never afterwards. Aggregation is a different
 * problem with different indexes and lands separately.
 */
import { db } from '@stacksjs/database'
import { getDialectDriver, resolveDialect } from 'bun-query-builder'

export interface EventQuery {
  name?: string
  from?: string
  to?: string
  userKey?: string
  /** Keyset cursor: return events strictly older than this id. */
  before?: number
  limit?: number
}

export interface EventPage {
  events: Array<Record<string, unknown>>
  /** Pass back as `before` for the next page; null when the stream is exhausted. */
  nextCursor: number | null
}

/** Hard ceiling regardless of what was asked for. */
export const MAX_PAGE = 200
export const DEFAULT_PAGE = 50

/**
 * A page of events, newest first.
 *
 * Keyset pagination, not offset. An append-only stream grows underneath a
 * reader, so `OFFSET 100` silently shifts as new events arrive and pages either
 * repeat or skip rows; and offset costs more the deeper it goes, which is
 * exactly backwards for a log people scroll. A cursor on `id` is stable and
 * costs the same on page 1 and page 400.
 */
export async function eventsFor(projectId: number, query: EventQuery = {}): Promise<EventPage> {
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_PAGE, 1), MAX_PAGE)

  const conditions: string[] = ['project_id = $1']
  const params: unknown[] = [projectId]

  const add = (clause: string, value: unknown): void => {
    params.push(value)
    conditions.push(clause.replace('?', `$${params.length}`))
  }

  if (query.name)
    add('name = ?', String(query.name))

  if (query.from)
    add('occurred_at >= ?', String(query.from))

  if (query.to)
    add('occurred_at <= ?', String(query.to))

  if (query.userKey)
    add('user_key = ?', String(query.userKey))

  if (query.before)
    add('id < ?', Number(query.before))

  // One row more than asked for, to learn whether another page exists without
  // a second COUNT over a table that only grows.
  params.push(limit + 1)

  const rows = await db.unsafe(
    `SELECT id, name, occurred_at, received_at, properties, value, currency, user_key, session_key
       FROM events
      WHERE ${conditions.join(' AND ')}
      ORDER BY id DESC
      LIMIT $${params.length}`,
    params,
  ) as Array<Record<string, unknown>>

  const events: Array<Record<string, unknown>> = rows.slice(0, limit).map(row => ({
    ...row,
    // Stored as text so one schema serves SQLite and Postgres alike; parsed
    // here so callers never have to know that.
    properties: parseProperties(row.properties),
  }))

  return {
    events,
    nextCursor: rows.length > limit ? Number(events[events.length - 1]?.id ?? 0) || null : null,
  }
}

function parseProperties(value: unknown): Record<string, unknown> {
  if (!value)
    return {}

  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  }
  catch {
    // A row written before a normalisation change, or by hand. Returning {}
    // keeps the page rendering rather than failing the whole request over one
    // unreadable bag.
    return {}
  }
}

/**
 * Distinct event names seen in a project, most frequent first.
 *
 * Drives the name filter in the UI and, later, template matching (#14): a
 * template can only be offered once the events it needs have actually arrived.
 */
export async function eventNamesFor(projectId: number, limit = 100): Promise<Array<{ name: string, count: number }>> {
  const rows = await db.unsafe(
    `SELECT name, COUNT(*) AS count
       FROM events
      WHERE project_id = $1
      GROUP BY name
      ORDER BY count DESC
      LIMIT $2`,
    [projectId, Math.min(Math.max(limit, 1), 500)],
  ) as Array<{ name: string, count: number | string }>

  return rows.map(row => ({ name: String(row.name), count: Number(row.count) }))
}

/**
 * Distinct `properties` keys seen in a project, most frequent first.
 *
 * The property bag is the customer's own vocabulary, so the only way the
 * builder can offer a dimension worth grouping by is to look at what has
 * actually arrived. Typing `properties.plan` from memory is how somebody
 * groups by a key that does not exist and gets one silent "other" bucket.
 *
 * Reads a bounded sample rather than the whole table. A project with ten
 * million events has the same handful of keys as its first thousand, and this
 * runs while somebody waits for a dropdown to open.
 */
export async function propertyKeysFor(projectId: number, limit = 50): Promise<Array<{ key: string, count: number }>> {
  const rows = await db.unsafe(
    `SELECT properties FROM events
      WHERE project_id = $1 AND properties IS NOT NULL AND properties != '{}'
      ORDER BY id DESC
      LIMIT 2000`,
    [projectId],
  ) as Array<{ properties: string }>

  const counts = new Map<string, number>()

  for (const row of rows) {
    try {
      const parsed = JSON.parse(String(row.properties))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        continue

      for (const key of Object.keys(parsed))
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    catch {
      // A row whose bag will not parse is not worth failing a dropdown over.
      continue
    }
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, Math.min(Math.max(limit, 1), 200))
}

/**
 * The values a property actually takes, most common first.
 *
 * Drives the report filter bar. Offering a text box instead would mean somebody
 * typing `pro` when the data says `Pro` and concluding the product is broken;
 * offering what is there makes a wrong answer impossible to pick.
 *
 * Sampled rather than exhaustive, for the same reason as `propertyKeysFor`:
 * this runs while a dropdown opens, and a project with ten million events has
 * the same handful of plan names as its first few thousand.
 */
export async function propertyValuesFor(projectId: number, key: string, limit = 20): Promise<string[]> {
  const clean = String(key ?? '').replace(/^properties\./, '')
  if (!clean || clean.length > 80)
    return []

  const rows = await db.unsafe(
    // json_extract with a bound path is not portable, so the key is validated
    // above and interpolated into the accessor. Bound as a parameter it would
    // be treated as a literal string rather than a path.
    // Aliased `property_value`, not `value`: the driver returns nulls for a
    // column by that name, so the query is right in sqlite and empty here.
    `SELECT ${getDialectDriver(resolveDialect()).jsonExtract('properties', `'${clean.replace(/[^\w.-]/g, '')}'`)} AS property_value, COUNT(*) AS n
       FROM events
      WHERE project_id = $1 AND properties IS NOT NULL
      GROUP BY property_value
      HAVING property_value IS NOT NULL
      ORDER BY n DESC
      LIMIT $2`,
    [projectId, Math.min(Math.max(limit, 1), 100)],
  ) as Array<{ property_value: unknown }>

  return rows
    .map(row => (row.property_value === null || row.property_value === undefined ? '' : String(row.property_value)))
    .filter(Boolean)
}
