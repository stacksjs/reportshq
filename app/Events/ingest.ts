/**
 * Accepting a batch of events.
 *
 * Separated from the route so the same path can be exercised directly by tests
 * and, later, by the SDK integration fixtures, without going through HTTP. The
 * route owns status codes and headers; this owns what actually happens.
 */
import { db } from '@stacksjs/database'
import { normalizeBatch } from './normalize'

export interface StoreResult {
  stored: number
  dropped: Array<{ index: number, reason: string }>
}

/**
 * Write a normalised batch.
 *
 * One multi-row INSERT rather than one per event: a batch of 500 is a routine
 * payload, and 500 round trips to write it is the difference between an ingest
 * that keeps up and one that becomes the bottleneck it was built to absorb.
 *
 * `first_event_at` is stamped in the same call, guarded so it only ever writes
 * once. It drives the onboarding state ("waiting for your first event"), and a
 * separate query to check it would double the cost of every batch to answer a
 * question that is interesting exactly once per project.
 */
export async function storeEvents(projectId: number, input: unknown, receivedAt = new Date()): Promise<StoreResult> {
  const { events, dropped } = normalizeBatch(input, receivedAt)

  if (events.length === 0)
    return { stored: 0, dropped }

  const columns = ['project_id', 'name', 'occurred_at', 'received_at', 'properties', 'value', 'currency', 'user_key', 'session_key']
  const params: unknown[] = []
  const rows: string[] = []

  for (const event of events) {
    const base = params.length
    rows.push(`(${columns.map((_, column) => `$${base + column + 1}`).join(', ')})`)
    params.push(
      projectId,
      event.name,
      event.occurred_at,
      event.received_at,
      event.properties,
      event.value,
      event.currency,
      event.user_key,
      event.session_key,
    )
  }

  await db.unsafe(
    `INSERT INTO events (${columns.map(column => `"${column}"`).join(', ')}) VALUES ${rows.join(', ')}`,
    params,
  )

  await db.unsafe(
    `UPDATE projects SET first_event_at = $1 WHERE id = $2 AND first_event_at IS NULL`,
    [receivedAt.toISOString(), projectId],
  )

  return { stored: events.length, dropped }
}
