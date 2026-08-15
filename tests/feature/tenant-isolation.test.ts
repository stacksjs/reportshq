/**
 * Cross-tenant isolation, at the data layer.
 *
 * app/Support/access.ts decides who MAY read a project, and
 * project-access.test.ts covers that thoroughly. This file asks the question
 * one layer down and assumes the answer to the first is wrong: if a project id
 * reaches a query it should not have, does the query itself refuse, or does it
 * hand over another tenant's rows?
 *
 * That distinction is the whole point. A permission helper is one `if` away
 * from being bypassed — a new route that forgets to call it, a background job
 * that trusts its input, a query built from a URL parameter. Defence in depth
 * means the scoping lives in the SQL as well, so a missing check is a bug
 * rather than a breach.
 *
 * Two tenants are built with deliberately distinctive data. Every assertion is
 * "A's read never contains B's value", not "A's read has N rows": a count can
 * match by accident, a foreign customer id cannot.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { recordUsage } from '../../app/Billing/usage'
import { storeEvents } from '../../app/Events/ingest'
import { eventNamesFor, eventsFor, propertyKeysFor, propertyValuesFor } from '../../app/Events/query'
import { runQuery } from '../../app/Reports/engine'
import { createShare, revokeShare, rotateShare, shareByToken, sharesFor } from '../../app/Reports/shares'
import { projectForIngestKey } from '../../app/Support/access'

const stamp = Date.now()

interface Tenant {
  user: { id: number }
  project: { id: number, ingest_key: string }
  report: { id: number }
  /** A property value that appears in this tenant's events and nowhere else. */
  marker: string
}

let alpha: Tenant
let beta: Tenant

async function makeUser(label: string): Promise<{ id: number }> {
  const email = `${label}-${stamp}@isolation.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'pro', CURRENT_TIMESTAMP)`,
    [label, email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  return { id: Number(row.id) }
}

async function makeTenant(label: string): Promise<Tenant> {
  const user = await makeUser(label)
  const key = `rhq_${label}${stamp}${Math.random().toString(16).slice(2, 8)}`

  await db.unsafe(
    `INSERT INTO projects (name, slug, ingest_key, owner_id, timezone, created_at)
     VALUES ($1, $2, $3, $4, 'UTC', CURRENT_TIMESTAMP)`,
    [label, `${label}-${stamp}`, key, user.id],
  )
  const project = (await db.unsafe(
    `SELECT id, ingest_key FROM projects WHERE ingest_key = $1`,
    [key],
  ))?.[0] as { id: number, ingest_key: string }
  project.id = Number(project.id)

  await db.unsafe(
    `INSERT INTO reports (project_id, name, slug, status, created_by_id, created_at)
     VALUES ($1, $2, $3, 'published', $4, CURRENT_TIMESTAMP)`,
    [project.id, `${label} report`, `${label}-report-${stamp}`, user.id],
  )
  const report = (await db.unsafe(
    `SELECT id FROM reports WHERE project_id = $1 ORDER BY id DESC LIMIT 1`,
    [project.id],
  ))?.[0] as { id: number }
  report.id = Number(report.id)

  // The marker appears in a property value, a user_key and an event name, so
  // every read path has something unforgeable to be checked against.
  const marker = `${label}-secret-${stamp}`

  await storeEvents(project.id, [
    {
      name: `commerce.order.created`,
      value: 100,
      currency: 'USD',
      user_key: marker,
      properties: { tenant: marker },
    },
    {
      name: `${label}.private.event`,
      user_key: marker,
      properties: { tenant: marker },
    },
  ])

  return { user, project, report, marker }
}

beforeAll(async () => {
  alpha = await makeTenant('alpha')
  beta = await makeTenant('beta')
})

afterAll(async () => {
  for (const tenant of [alpha, beta]) {
    if (!tenant)
      continue
    await db.unsafe(`DELETE FROM report_shares WHERE report_id = $1`, [tenant.report.id])
    await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [tenant.project.id])
    await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [tenant.project.id])
    await db.unsafe(`DELETE FROM reports WHERE project_id = $1`, [tenant.project.id])
    await db.unsafe(`DELETE FROM projects WHERE id = $1`, [tenant.project.id])
    await db.unsafe(`DELETE FROM users WHERE id = $1`, [tenant.user.id])
  }
})

describe('the ingest key is a key to exactly one project', () => {
  test('it resolves to its own project and no other', async () => {
    const resolved = await projectForIngestKey(alpha.project.ingest_key)

    expect(Number(resolved?.id)).toBe(alpha.project.id)
    expect(Number(resolved?.id)).not.toBe(beta.project.id)
  })

  test('a key that does not exist resolves to nothing rather than the first project', async () => {
    // A lookup that fell back to "any project" would hand a stranger a tenant.
    expect(await projectForIngestKey('rhq_definitely_not_a_key')).toBeNull()
    expect(await projectForIngestKey('')).toBeNull()
  })

  test('events written with one key belong to that key\'s project only', async () => {
    const before = await eventsFor(beta.project.id, {})

    await storeEvents(alpha.project.id, [
      { name: 'commerce.order.created', user_key: alpha.marker },
    ])

    const after = await eventsFor(beta.project.id, {})
    expect(after.events.length).toBe(before.events.length)
  })
})

describe('event reads are scoped to their project', () => {
  test('a listing never contains the other tenant\'s rows', async () => {
    const page = await eventsFor(alpha.project.id, {})

    expect(page.events.length).toBeGreaterThan(0)
    for (const event of page.events)
      expect(String(event.user_key ?? '')).not.toBe(beta.marker)
  })

  test('event names do not leak across projects', async () => {
    const names = (await eventNamesFor(alpha.project.id)).map(row => row.name)

    expect(names).toContain('alpha.private.event')
    expect(names).not.toContain('beta.private.event')
  })

  test('property keys and values do not leak across projects', async () => {
    const values = await propertyValuesFor(alpha.project.id, 'tenant')

    expect(values).toContain(alpha.marker)
    expect(values).not.toContain(beta.marker)

    // The key itself is shared, which is fine and expected; the values are not.
    const keys = (await propertyKeysFor(alpha.project.id)).map(row => row.key)
    expect(keys).toContain('tenant')
  })

  test('a filter naming the other tenant\'s value finds nothing', async () => {
    // The adversarial shape: the attacker knows the marker and asks for it
    // against a project they do hold.
    const page = await eventsFor(alpha.project.id, { name: 'beta.private.event' })

    expect(page.events.length).toBe(0)
  })
})

describe('the query engine is scoped to its project', () => {
  test('a count for one project does not include the other', async () => {
    const alphaResult = await runQuery({
      projectId: alpha.project.id,
      query: { events: [], measure: 'count', filters: [] },
      range: 'last_30_days',
    })
    const betaResult = await runQuery({
      projectId: beta.project.id,
      query: { events: [], measure: 'count', filters: [] },
      range: 'last_30_days',
    })

    // Both tenants have events, so a query that ignored project_id would return
    // the same total for both.
    expect(alphaResult.total).toBeGreaterThan(0)
    expect(betaResult.total).toBeGreaterThan(0)

    const combined = await db.unsafe(
      `SELECT COUNT(*) AS n FROM events WHERE project_id IN ($1, $2)`,
      [alpha.project.id, beta.project.id],
    ) as Array<{ n: number }>

    expect(Number(alphaResult.total)).toBeLessThan(Number(combined[0]!.n))
  })

  test('grouping by a property never surfaces the other tenant\'s values', async () => {
    const result = await runQuery({
      projectId: alpha.project.id,
      query: { events: [], measure: 'count', filters: [], dimension: 'properties.tenant' },
      range: 'last_30_days',
    })

    const keys = result.series.map(series => String(series.key))
    expect(keys).not.toContain(beta.marker)
  })

  test('an event name belonging to the other tenant returns an empty series', async () => {
    const result = await runQuery({
      projectId: alpha.project.id,
      query: { events: ['beta.private.event'], measure: 'count', filters: [] },
      range: 'last_30_days',
    })

    expect(Number(result.total)).toBe(0)
  })
})

describe('share tokens address one report', () => {
  test('a token resolves to its own report', async () => {
    const share = await createShare(alpha.project.id, alpha.report.id, alpha.user, {})
    const resolved = await shareByToken(String(share.token))

    expect(Number(resolved?.reportId)).toBe(alpha.report.id)
  })

  test('an unknown token resolves to nothing rather than the first share', async () => {
    expect(await shareByToken('not-a-token')).toBeNull()
    expect(await shareByToken('')).toBeNull()
  })

  test('one project cannot revoke another project\'s share', async () => {
    const share = await createShare(alpha.project.id, alpha.report.id, alpha.user, {})
    const shareId = Number(share.id)

    // Beta knows the id and asks. The answer has to be no, and the share has to
    // still work afterwards.
    expect(await revokeShare(beta.project.id, shareId)).toBeFalse()
    expect(await shareByToken(String(share.token))).not.toBeNull()

    // And the rightful owner can still revoke it, so the refusal above was
    // about ownership rather than the share being unrevokable.
    expect(await revokeShare(alpha.project.id, shareId)).toBeTrue()
  })

  test('one project cannot rotate another project\'s share', async () => {
    const share = await createShare(alpha.project.id, alpha.report.id, alpha.user, {})

    expect(await rotateShare(beta.project.id, Number(share.id))).toBeNull()
    // The original token still works, so nothing was rotated out from under it.
    expect(await shareByToken(String(share.token))).not.toBeNull()
  })

  test('listing a report\'s shares does not list another report\'s', async () => {
    const alphaShare = await createShare(alpha.project.id, alpha.report.id, alpha.user, {})
    const betaShare = await createShare(beta.project.id, beta.report.id, beta.user, {})

    const tokens = (await sharesFor(alpha.report.id)).map(row => String(row.token))

    expect(tokens).toContain(String(alphaShare.token))
    expect(tokens).not.toContain(String(betaShare.token))
  })
})

describe('usage is metered per project', () => {
  const readCounter = async (projectId: number): Promise<number> => {
    const rows = await db.unsafe(
      `SELECT COALESCE(SUM(events), 0) AS n FROM usage_counters WHERE project_id = $1`,
      [projectId],
    ) as Array<{ n: number }>
    return Number(rows[0]?.n ?? 0)
  }

  test('one project\'s usage does not move another\'s meter', async () => {
    // The upsert keys on (project_id, month). A conflict target that dropped
    // project_id would have every tenant sharing one row, which is a billing
    // bug rather than a display bug.
    const betaBefore = await readCounter(beta.project.id)

    await recordUsage(alpha.project.id, 'UTC', { events: 7 })

    expect(await readCounter(alpha.project.id)).toBeGreaterThanOrEqual(7)
    expect(await readCounter(beta.project.id)).toBe(betaBefore)
  })

  test('repeated usage accumulates on the tenant that incurred it', async () => {
    const alphaBefore = await readCounter(alpha.project.id)
    const betaBefore = await readCounter(beta.project.id)

    await recordUsage(alpha.project.id, 'UTC', { events: 3 })
    await recordUsage(alpha.project.id, 'UTC', { events: 4 })

    expect(await readCounter(alpha.project.id)).toBe(alphaBefore + 7)
    expect(await readCounter(beta.project.id)).toBe(betaBefore)
  })
})
