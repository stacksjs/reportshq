/**
 * Reading the event stream back.
 *
 * This is the raw-events browser, not the report engine (#10): it answers "what
 * arrived, and does it look right", which is the question an integrator asks in
 * the first ten minutes and almost never afterwards. Aggregation is a different
 * problem with different indexes and lands separately.
 */
import { db } from '@stacksjs/database'

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
