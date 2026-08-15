/**
 * The ingest endpoint over HTTP.
 *
 * Dispatched in-process through the real router with `featureTest`, so the
 * route registration, the header contract and the status codes are all
 * exercised without a listening port. The logic underneath is covered by
 * ingest.test.ts; what this proves is that a caller holding a key and speaking
 * the documented protocol actually gets through, and that the ways of getting
 * it wrong return what docs/ingest.md promises.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { featureTest } from '@stacksjs/testing'
import { LIMITS } from '../../app/Events/normalize'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number
let key: string

beforeAll(async () => {
  const email = `http-owner-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    ['http owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }

  const project = await createProject(owner, { name: `HTTP ${stamp}` })
  projectId = Number(project.id)
  key = String(project.ingest_key)
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

function withKey(value = key) {
  return featureTest().withHeaders({ 'X-ReportsHQ-Key': value })
}

describe('POST /ingest', () => {
  test('accepts a batch and reports what it did with each row', async () => {
    const res = await withKey().post('/ingest', {
      events: [
        { name: 'Commerce.Order.Created', value: 42, currency: 'usd', user_key: 'c1', properties: { plan: 'pro' } },
        { name: '' },
        { name: 'user.registered' },
      ],
    })

    expect(res.status).toBe(201)

    const body = await res.json() as { ok: boolean, stored: number, dropped: number, skipped: number, errors: unknown[] }
    expect(body.ok).toBeTrue()
    expect(body.stored).toBe(2)
    expect(body.dropped).toBe(1)
    expect(body.skipped).toBe(0)
    // The reason travels with the count, so a client can fix its payload
    // without opening a support conversation.
    expect(body.errors[0]).toEqual({ index: 1, reason: 'missing or unusable name' })
  })

  test('a bare array is accepted, because it is what people try first', async () => {
    const res = await withKey().post('/ingest', [{ name: 'user.login' }])
    expect(res.status).toBe(201)
    expect((await res.json() as { stored: number }).stored).toBe(1)
  })

  test('an unknown key is refused, and says nothing about which part was wrong', async () => {
    const res = await withKey('rhq_not_a_real_key').post('/ingest', { events: [{ name: 'user.login' }] })

    expect(res.status).toBe(401)
    expect((await res.json() as { error: string }).error).toBe('invalid_key')
  })

  test('a missing key is refused the same way', async () => {
    const res = await featureTest().post('/ingest', { events: [{ name: 'user.login' }] })

    expect(res.status).toBe(401)
    expect((await res.json() as { error: string }).error).toBe('invalid_key')
  })

  test('a body that is not JSON is a 400, not a crash', async () => {
    const res = await withKey().post('/ingest', 'this is not json{')

    expect(res.status).toBe(400)

    // The status is the contract; the envelope is not ours to promise. The
    // router parses the body before a handler runs, so a malformed one is
    // refused upstream with the framework's standard error shape rather than
    // the ingest one. docs/ingest.md says so, because a client that only
    // pattern-matches on `error: "invalid_json"` would otherwise be surprised
    // by the one response it is most likely to hit while integrating.
    const body = await res.json() as { error?: string, message?: string }
    expect(`${body.error} ${body.message}`.toLowerCase()).toContain('bad request')
  })

  test('a body without an events array explains the shape it wanted', async () => {
    const res = await withKey().post('/ingest', { logs: [] })

    expect(res.status).toBe(422)
    const body = await res.json() as { error: string, message: string }
    expect(body.error).toBe('invalid_body')
    expect(body.message).toContain('events')
  })

  test('an oversized body is refused with the limit stated', async () => {
    const big = { events: [{ name: 'user.login', properties: { blob: 'x'.repeat(LIMITS.BODY_BYTES + 1024) } }] }
    const res = await withKey().post('/ingest', big)

    expect(res.status).toBe(413)
    const body = await res.json() as { error: string, limit_bytes: number }
    expect(body.error).toBe('payload_too_large')
    expect(body.limit_bytes).toBe(LIMITS.BODY_BYTES)
  })

  test('an over-long batch stores what it can and counts the rest', async () => {
    const events = Array.from({ length: LIMITS.BATCH + 10 }, () => ({ name: 'bulk.http' }))
    const res = await withKey().post('/ingest', { events })

    expect(res.status).toBe(201)
    const body = await res.json() as { stored: number, skipped: number }
    expect(body.stored).toBe(LIMITS.BATCH)
    expect(body.skipped).toBe(10)
  })

  test('an empty batch succeeds rather than erroring', async () => {
    // An SDK flushing on an interval with nothing queued should not be told it
    // did something wrong.
    const res = await withKey().post('/ingest', { events: [] })

    expect(res.status).toBe(201)
    expect((await res.json() as { stored: number }).stored).toBe(0)
  })
})

describe('GET /ingest/verify', () => {
  test('confirms a key without writing anything', async () => {
    const before = await db.unsafe(`SELECT COUNT(*) AS n FROM events WHERE project_id = $1`, [projectId]) as Array<{ n: number }>

    const res = await withKey().get('/ingest/verify')
    expect(res.status).toBe(200)

    const body = await res.json() as { ok: boolean, project: { name: string } }
    expect(body.ok).toBeTrue()
    expect(body.project.name).toBe(`HTTP ${stamp}`)

    const after = await db.unsafe(`SELECT COUNT(*) AS n FROM events WHERE project_id = $1`, [projectId]) as Array<{ n: number }>
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n))
  })

  test('returns the project name and nothing else about the account', async () => {
    const res = await withKey().get('/ingest/verify')
    const body = await res.json() as { project: Record<string, unknown> }

    // A public write credential must not become a way to read the account
    // behind it: no id, no owner, no key echoed back.
    expect(Object.keys(body.project)).toEqual(['name'])
  })

  test('an unknown key is refused', async () => {
    const res = await withKey('rhq_nope').get('/ingest/verify')
    expect(res.status).toBe(401)
  })
})
