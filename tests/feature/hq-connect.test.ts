/**
 * `buddy hq:connect reportshq`, over the real routes and the real database.
 *
 * tests/unit/hq-connect.test.ts proves the rules over an in-memory table.
 * This proves the wiring: the routes are mounted where the CLI calls them,
 * the SQL stores read and write the tables the migrations create, and the
 * approve action refuses everyone it should before it issues anything.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { confirmationCode } from '@stacksjs/hq/service'
import { featureTest } from '@stacksjs/testing'
import { licensesOwnedBy } from '../../app/Hq/service'
import { resetConnectLimit } from '../../app/Support/connect-limits'

const stamp = Date.now()
const password = 'a-long-enough-passphrase'
const accounts = {
  alice: { email: `hq-alice-${stamp}@reportshq.test`, id: 0 },
  bob: { email: `hq-bob-${stamp}@reportshq.test`, id: 0 },
}

async function cleanup(): Promise<void> {
  for (const account of Object.values(accounts)) {
    const rows = await db.unsafe(`SELECT id FROM users WHERE email = $1`, [account.email]) as Array<{ id: number }>
    for (const row of rows) {
      await db.unsafe(`DELETE FROM licenses WHERE user_id = $1`, [row.id])
      try {
        await db.unsafe(`DELETE FROM personal_access_tokens WHERE user_id = $1`, [row.id])
      }
      catch {
        // The table name differs across drivers; the user row is what matters.
      }
      await db.unsafe(`DELETE FROM users WHERE id = $1`, [row.id])
    }
  }
}

beforeAll(async () => {
  await cleanup()
  for (const [name, account] of Object.entries(accounts)) {
    const res = await featureTest().post('/api/auth/register', { name: `HQ ${name} tester`, email: account.email, password })
    expect(res.status).toBe(201)
    account.id = Number(((await db.unsafe(`SELECT id FROM users WHERE email = $1`, [account.email])) as Array<{ id: number }>)[0]!.id)
  }
})

afterAll(cleanup)

interface Started { code: string, approveUrl: string, confirmCode: string }

async function start(app: string): Promise<Started> {
  await resetConnectLimit('start', 'unknown')
  const res = await featureTest().post('/api/cli/connect', { app })
  expect(res.status).toBe(201)
  return await res.json() as Started
}

async function poll(code: string): Promise<{ status: number, body: Record<string, unknown> }> {
  await resetConnectLimit('poll', 'unknown')
  const res = await featureTest().get(`/api/cli/connect/${code}`)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

function approve(code: string, user: { id: number } | null, confirm: unknown, headers: Record<string, string> = {}) {
  const client = user ? featureTest().actingAs(user) : featureTest()
  return client.withHeaders(headers).post(`/api/cli/connect/${code}/approve`, { confirm })
}

describe('POST /api/cli/connect', () => {
  test('answers a code, an approve link to this site, and the confirmation code', async () => {
    const started = await start(`starts-${stamp}`)
    expect(started.code).toMatch(/^[\w-]{32,}$/)
    expect(new URL(started.approveUrl).pathname).toBe('/cli/connect')
    expect(new URL(started.approveUrl).searchParams.get('code')).toBe(started.code)
    expect(started.confirmCode).toBe(await confirmationCode(started.code))
    // The confirmation code travels to the terminal only, never in the link.
    expect(started.approveUrl).not.toContain(started.confirmCode)
  })

  test('stores the hash of the code and never the code', async () => {
    const started = await start(`hashed-${stamp}`)
    const rows = await db.unsafe(`SELECT code_hash, app, status, sealed_grant FROM hq_connect_codes WHERE app = $1`, [`hashed-${stamp}`]) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('pending')
    expect(rows[0]!.sealed_grant).toBeNull()
    expect(JSON.stringify(rows[0])).not.toContain(started.code)
  })

  test('is pending until somebody approves it', async () => {
    const started = await start(`pending-${stamp}`)
    expect(await poll(started.code)).toEqual({ status: 200, body: { status: 'pending' } })
  })
})

describe('POST /api/cli/connect/{code}/approve', () => {
  test('refuses a visitor with no session', async () => {
    const started = await start(`anon-${stamp}`)
    const res = await approve(started.code, null, started.confirmCode)
    expect(res.status).toBe(401)
    expect((await poll(started.code)).body).toEqual({ status: 'pending' })
  })

  test('refuses a cross-site request, session or not', async () => {
    const started = await start(`forged-${stamp}`)
    const res = await approve(started.code, accounts.alice, started.confirmCode, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect((await poll(started.code)).body).toEqual({ status: 'pending' })
  })

  test('refuses without the confirmation code the terminal printed', async () => {
    const started = await start(`unconfirmed-${stamp}`)
    for (const confirm of [undefined, '', 'ABC-DEF', started.code]) {
      await resetConnectLimit('approve', accounts.alice.id)
      const res = await approve(started.code, accounts.alice, confirm)
      expect(res.status).toBe(422)
      expect((await res.json() as { reason: string }).reason).toBe('confirmation_mismatch')
    }
    expect(await licensesOwnedBy(accounts.alice.id)).toEqual([])
  })

  test('limits how many confirmation codes one person may try', async () => {
    const started = await start(`guessed-${stamp}`)
    await resetConnectLimit('approve', accounts.bob.id)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++)
      statuses.push((await approve(started.code, accounts.bob, 'AAA-AAA')).status)
    expect(statuses.slice(0, 10).every(status => status === 422)).toBe(true)
    expect(statuses[10]).toBe(429)
    await resetConnectLimit('approve', accounts.bob.id)
  })

  test('issues a licence, hands it to the terminal once, and lists it on the account', async () => {
    const app = `shop-${stamp}`
    const started = await start(app)
    await resetConnectLimit('approve', accounts.alice.id)

    const res = await approve(started.code, accounts.alice, started.confirmCode.toLowerCase())
    expect(res.status).toBe(200)
    const approved = await res.json() as { ok: boolean, project: { name: string } }
    expect(approved.project.name).toBe(app)
    // The approve page is told the name and nothing else: the licence goes to
    // the terminal that asked, not back to the browser.
    expect(JSON.stringify(approved)).not.toContain('rhq_lic_')

    const first = await poll(started.code)
    expect(first.status).toBe(200)
    expect(Object.keys(first.body).sort()).toEqual(['dashboardUrl', 'licenseKey', 'project', 'status'])
    expect(first.body.status).toBe('approved')
    expect(first.body.licenseKey).toMatch(/^rhq_lic_[0-9a-f]{32}$/)
    expect(new URL(String(first.body.dashboardUrl)).pathname).toBe('/account')

    expect((await poll(started.code)).status).toBe(404)

    const owned = await licensesOwnedBy(accounts.alice.id)
    expect(owned).toHaveLength(1)
    expect(owned[0]).toMatchObject({ ownerId: accounts.alice.id, application: app, key: first.body.licenseKey })
  })

  test('the same application gets the same licence again', async () => {
    const [existing] = await licensesOwnedBy(accounts.alice.id)
    const started = await start(existing!.application.toUpperCase())
    await resetConnectLimit('approve', accounts.alice.id)
    expect((await approve(started.code, accounts.alice, started.confirmCode)).status).toBe(200)
    expect((await poll(started.code)).body.licenseKey).toBe(existing!.key)
    expect(await licensesOwnedBy(accounts.alice.id)).toHaveLength(1)
  })

  test('a second application on the free plan is refused, and says which plan covers it', async () => {
    const started = await start(`second-${stamp}`)
    await resetConnectLimit('approve', accounts.alice.id)
    const res = await approve(started.code, accounts.alice, started.confirmCode)
    expect(res.status).toBe(409)
    const refused = await res.json() as { error: string, reason: string }
    expect(refused.reason).toBe('application_limit')
    expect(refused.error).toBe('Free covers 1 application and this account has 1. Hobby covers 3.')
    expect(await licensesOwnedBy(accounts.alice.id)).toHaveLength(1)
    expect((await poll(started.code)).body).toEqual({ status: 'pending' })
  })

  test('a code can be approved once', async () => {
    const started = await start(`once-${stamp}`)
    await resetConnectLimit('approve', accounts.bob.id)
    expect((await approve(started.code, accounts.bob, started.confirmCode)).status).toBe(200)
    expect((await approve(started.code, accounts.bob, started.confirmCode)).status).toBe(409)
  })

  test('an unknown code is expired, not an error', async () => {
    const code = 'a'.repeat(43)
    await resetConnectLimit('approve', accounts.bob.id)
    expect((await approve(code, accounts.bob, await confirmationCode(code))).status).toBe(410)
    expect((await poll(code)).status).toBe(404)
  })
})

describe('there is nothing to meter', () => {
  test('the usage route other HQ services answer does not exist here', async () => {
    const res = await featureTest().withHeaders({ Authorization: 'Bearer anything' }).get('/api/v1/usage')
    expect(res.status).toBe(404)
  })
})
