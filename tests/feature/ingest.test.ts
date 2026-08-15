/**
 * Ingestion: normalisation, bounds, storage and reading back.
 *
 * The governing rule under test is that one bad row must never cost a good one.
 * A batch comes from a running application, and losing forty-nine good events
 * because the fiftieth had an unusable name is a data loss the customer cannot
 * see and cannot recover.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { storeEvents } from '../../app/Events/ingest'
import { checkIngestLimits, IP_LIMIT, PROJECT_LIMIT, resetIngestLimits } from '../../app/Events/limits'
import { LIMITS, normalizeBatch, normalizeName, normalizeProperties, normalizeTimestamp } from '../../app/Events/normalize'
import { eventNamesFor, eventsFor, MAX_PAGE } from '../../app/Events/query'
import { projectForIngestKey } from '../../app/Support/access'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number
let otherProjectId: number
let ingestKey: string

beforeAll(async () => {
  const email = `ingest-owner-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    ['ingest owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }

  const project = await createProject(owner, { name: `Ingest ${stamp}` })
  projectId = Number(project.id)
  ingestKey = String(project.ingest_key)

  const other = await createProject(owner, { name: `Ingest other ${stamp}` })
  otherProjectId = Number(other.id)
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM events WHERE project_id IN ($1, $2)`, [projectId, otherProjectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id IN ($1, $2)`, [projectId, otherProjectId])
  await db.unsafe(`DELETE FROM projects WHERE id IN ($1, $2)`, [projectId, otherProjectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

describe('event names', () => {
  test('are lowercased, so one taxonomy does not become two', () => {
    // `Commerce.Order.Created` and `commerce.order.created` from two places in
    // one codebase would otherwise be two series on every chart.
    expect(normalizeName('Commerce.Order.Created')).toBe('commerce.order.created')
  })

  test('separators collapse to dots', () => {
    expect(normalizeName('commerce order  created')).toBe('commerce.order.created')
    expect(normalizeName('commerce/order/created')).toBe('commerce.order.created')
    expect(normalizeName('commerce..order...created')).toBe('commerce.order.created')
  })

  test('leading and trailing dots are trimmed', () => {
    expect(normalizeName('.commerce.order.')).toBe('commerce.order')
  })

  test('unusable names come back null rather than as an empty string', () => {
    expect(normalizeName('')).toBeNull()
    expect(normalizeName('   ')).toBeNull()
    expect(normalizeName('!!!')).toBeNull()
    expect(normalizeName(null)).toBeNull()
  })

  test('over-long names are truncated, not rejected', () => {
    expect(normalizeName('a'.repeat(400))?.length).toBe(LIMITS.NAME)
  })
})

describe('timestamps', () => {
  const received = new Date('2026-06-01T12:00:00.000Z')

  test('a sane timestamp is kept as sent', () => {
    const { at, clamped } = normalizeTimestamp('2026-05-30T09:00:00.000Z', received)
    expect(at.toISOString()).toBe('2026-05-30T09:00:00.000Z')
    expect(clamped).toBeFalse()
  })

  test('seconds and milliseconds epochs are both understood', () => {
    expect(normalizeTimestamp(1780000000, received).at.getTime()).toBe(1780000000 * 1000)
    expect(normalizeTimestamp(1780000000000, received).at.getTime()).toBe(1780000000000)
  })

  test('a wildly past clock is clamped, not dropped', () => {
    // A phone with a wrong clock is still a real event the customer paid for.
    const { at, clamped } = normalizeTimestamp('2019-01-01T00:00:00.000Z', received)
    expect(clamped).toBeTrue()
    expect(at.getTime()).toBe(received.getTime() - LIMITS.PAST_MS)
  })

  test('a future clock is clamped to an hour ahead', () => {
    const { at, clamped } = normalizeTimestamp('2030-01-01T00:00:00.000Z', received)
    expect(clamped).toBeTrue()
    expect(at.getTime()).toBe(received.getTime() + LIMITS.FUTURE_MS)
  })

  test('a missing timestamp becomes the receive time', () => {
    expect(normalizeTimestamp(undefined, received).at.getTime()).toBe(received.getTime())
  })

  test('nonsense falls back to the receive time rather than an invalid date', () => {
    const { at } = normalizeTimestamp('not a date', received)
    expect(Number.isNaN(at.getTime())).toBeFalse()
    expect(at.getTime()).toBe(received.getTime())
  })
})

describe('properties', () => {
  test('scalars survive intact', () => {
    expect(JSON.parse(normalizeProperties({ plan: 'pro', seats: 4, trial: false })))
      .toEqual({ plan: 'pro', seats: 4, trial: false })
  })

  test('nested values are flattened to JSON rather than dropped', () => {
    const parsed = JSON.parse(normalizeProperties({ items: [{ sku: 'a' }] }))
    expect(parsed.items).toBe('[{"sku":"a"}]')
  })

  test('over-long values are truncated', () => {
    const parsed = JSON.parse(normalizeProperties({ note: 'x'.repeat(5000) }))
    expect(parsed.note.length).toBe(LIMITS.VALUE)
  })

  test('too many properties are trimmed to the cap', () => {
    const many: Record<string, number> = {}
    for (let i = 0; i < LIMITS.PROPERTIES + 40; i++)
      many[`k${i}`] = i

    expect(Object.keys(JSON.parse(normalizeProperties(many)))).toHaveLength(LIMITS.PROPERTIES)
  })

  test('an oversized bag is trimmed at the property level, staying valid JSON', () => {
    const heavy: Record<string, string> = {}
    for (let i = 0; i < 60; i++)
      heavy[`key${i}`] = 'y'.repeat(LIMITS.VALUE)

    const encoded = normalizeProperties(heavy)
    expect(encoded.length).toBeLessThanOrEqual(LIMITS.PROPERTIES_BYTES)
    expect(() => JSON.parse(encoded)).not.toThrow()
  })

  test('circular structures do not throw', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    const parsed = JSON.parse(normalizeProperties(circular))
    expect(parsed.name).toBe('loop')
    expect(parsed.self).toBeUndefined()
  })

  test('a non-object properties field becomes an empty bag', () => {
    expect(normalizeProperties('nope')).toBe('{}')
    expect(normalizeProperties(null)).toBe('{}')
    expect(normalizeProperties([1, 2])).toBe('{}')
  })
})

describe('normalising a batch', () => {
  test('a bad row is dropped and the good ones survive', () => {
    const { events, dropped } = normalizeBatch([
      { name: 'user.registered' },
      { name: '' },
      { name: 'commerce.order.created', value: 42, currency: 'usd' },
      'not an object',
    ])

    expect(events.map(event => event.name)).toEqual(['user.registered', 'commerce.order.created'])
    expect(dropped).toHaveLength(2)
    expect(dropped[0]).toEqual({ index: 1, reason: 'missing or unusable name' })
    expect(dropped[1]?.reason).toBe('not an object')
  })

  test('currency is uppercased and validated to three letters', () => {
    const { events } = normalizeBatch([
      { name: 'a', currency: 'usd' },
      { name: 'b', currency: 'dollars' },
    ])

    expect(events[0]?.currency).toBe('USD')
    expect(events[1]?.currency).toBeNull()
  })

  test('a non-numeric value becomes null rather than NaN', () => {
    const { events } = normalizeBatch([{ name: 'a', value: 'lots' }])
    expect(events[0]?.value).toBeNull()
  })

  test('the batch cap truncates rather than rejecting', () => {
    const many = Array.from({ length: LIMITS.BATCH + 25 }, () => ({ name: 'user.login' }))
    expect(normalizeBatch(many).events).toHaveLength(LIMITS.BATCH)
  })

  test('a non-array yields nothing rather than throwing', () => {
    expect(normalizeBatch({ events: [] }).events).toHaveLength(0)
  })
})

describe('storing a batch', () => {
  test('events land against the project and can be read back', async () => {
    const result = await storeEvents(projectId, [
      { name: 'commerce.order.created', value: 99.5, currency: 'usd', user_key: 'cust-1', properties: { plan: 'pro' } },
      { name: 'user.registered', user_key: 'cust-2' },
    ])

    expect(result.stored).toBe(2)
    expect(result.dropped).toHaveLength(0)

    const page = await eventsFor(projectId, {})
    expect(page.events.length).toBeGreaterThanOrEqual(2)

    const order = page.events.find(event => event.name === 'commerce.order.created')
    expect(Number(order?.value)).toBe(99.5)
    expect(order?.currency).toBe('USD')
    expect((order?.properties as Record<string, unknown>).plan).toBe('pro')
  })

  test('the first event stamps the project, and only the first', async () => {
    const before = (await db.unsafe(`SELECT first_event_at FROM projects WHERE id = $1`, [projectId]))?.[0] as { first_event_at: string }
    expect(before.first_event_at).toBeTruthy()

    await storeEvents(projectId, [{ name: 'user.login' }])

    const after = (await db.unsafe(`SELECT first_event_at FROM projects WHERE id = $1`, [projectId]))?.[0] as { first_event_at: string }
    expect(after.first_event_at).toBe(before.first_event_at)
  })

  test('an all-bad batch stores nothing and reports why, without failing', async () => {
    const result = await storeEvents(projectId, [{ name: '' }, { nope: true }])

    expect(result.stored).toBe(0)
    expect(result.dropped).toHaveLength(2)
  })

  test('a large batch is written in one statement', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ name: 'bulk.event', user_key: `u${i % 10}` }))
    const result = await storeEvents(otherProjectId, many)

    expect(result.stored).toBe(250)

    const rows = await db.unsafe(`SELECT COUNT(*) AS n FROM events WHERE project_id = $1`, [otherProjectId]) as Array<{ n: number }>
    expect(Number(rows[0]?.n)).toBe(250)
  })
})

describe('reading events back', () => {
  test('only ever returns one project, never another', async () => {
    const page = await eventsFor(projectId, { limit: MAX_PAGE })
    expect(page.events.every(event => event.name !== 'bulk.event')).toBeTrue()
  })

  test('filters by name', async () => {
    const page = await eventsFor(projectId, { name: 'user.registered' })
    expect(page.events.every(event => event.name === 'user.registered')).toBeTrue()
    expect(page.events.length).toBeGreaterThan(0)
  })

  test('keyset pagination walks the stream without repeating or skipping', async () => {
    const first = await eventsFor(otherProjectId, { limit: 100 })
    expect(first.events).toHaveLength(100)
    expect(first.nextCursor).not.toBeNull()

    const second = await eventsFor(otherProjectId, { limit: 100, before: first.nextCursor! })
    expect(second.events).toHaveLength(100)

    const firstIds = new Set(first.events.map(event => Number(event.id)))
    const overlap = second.events.filter(event => firstIds.has(Number(event.id)))
    expect(overlap).toHaveLength(0)

    // And a page appended after the cursor was taken cannot shift the results,
    // which is the whole reason this is not OFFSET.
    await storeEvents(otherProjectId, [{ name: 'bulk.event' }])
    const again = await eventsFor(otherProjectId, { limit: 100, before: first.nextCursor! })
    expect(again.events.map(event => Number(event.id))).toEqual(second.events.map(event => Number(event.id)))
  })

  test('the cursor is null once the stream is exhausted', async () => {
    const page = await eventsFor(projectId, { limit: MAX_PAGE })
    expect(page.nextCursor).toBeNull()
  })

  test('the page size is capped however much is asked for', async () => {
    const page = await eventsFor(otherProjectId, { limit: 10_000 })
    expect(page.events.length).toBeLessThanOrEqual(MAX_PAGE)
  })

  test('names come back with counts, most frequent first', async () => {
    const names = await eventNamesFor(projectId)
    expect(names.length).toBeGreaterThan(0)
    expect(names[0]?.count).toBeGreaterThanOrEqual(names[names.length - 1]?.count ?? 0)
  })
})

describe('ingest keys', () => {
  test('a project is resolvable by its key, and only its own', async () => {
    const resolved = await projectForIngestKey(ingestKey)
    expect(Number(resolved?.id)).toBe(projectId)
  })

  test('an unknown key resolves to nothing', async () => {
    expect(await projectForIngestKey('rhq_made_up')).toBeNull()
  })
})

describe('rate limits', () => {
  test('a project is allowed up to its ceiling and then refused', async () => {
    const id = `limit-test-${stamp}`
    await resetIngestLimits(id, '')

    for (let i = 0; i < PROJECT_LIMIT; i++) {
      const decision = await checkIngestLimits(id, '')
      expect(decision.ok).toBeTrue()
    }

    const refused = await checkIngestLimits(id, '')
    expect(refused.ok).toBeFalse()
    expect(refused.scope).toBe('project')
    // Retry-After has to be a usable number of seconds, not 0.
    expect(refused.retryAfter).toBeGreaterThan(0)

    await resetIngestLimits(id, '')
  })

  test('one project hitting its limit does not refuse another', async () => {
    const busy = `busy-${stamp}`
    const quiet = `quiet-${stamp}`
    await resetIngestLimits(busy, '')
    await resetIngestLimits(quiet, '')

    for (let i = 0; i <= PROJECT_LIMIT; i++)
      await checkIngestLimits(busy, '')

    expect((await checkIngestLimits(busy, '')).ok).toBeFalse()
    expect((await checkIngestLimits(quiet, '')).ok).toBeTrue()

    await resetIngestLimits(busy, '')
    await resetIngestLimits(quiet, '')
  })

  test('an address is limited across projects', async () => {
    // The per-project window alone would happily let one source hammer many
    // projects; this is the dimension that catches that.
    const address = `10.0.0.${stamp % 250}`
    await resetIngestLimits('', address)

    let refusals = 0
    for (let i = 0; i <= IP_LIMIT + 5; i++) {
      const decision = await checkIngestLimits(`spread-${stamp}-${i}`, address)
      if (!decision.ok && decision.scope === 'ip')
        refusals++
    }

    expect(refusals).toBeGreaterThan(0)
    await resetIngestLimits('', address)
  })
})
