/**
 * `buddy hq:connect reportshq`, from this service's side.
 *
 * The adapter (app/Hq/adapter.ts) is what decides which licence a connect
 * hands over and whether an account may have another. It touches no database,
 * so it is exercised here over an in-memory `licenses` table: the package's
 * own contract suite first, then the rules that are ours.
 */
import type { LicenseGrant } from '@stacksjs/hq/service'
import type { AppLicense, HqUser, LicenseStore } from '../../app/Hq/adapter'
import { describe, expect, test } from 'bun:test'
import { confirmationCode, createHqService, createMemoryConnectCodeStore } from '@stacksjs/hq/service'
import { hqServiceContract } from '@stacksjs/hq/testing'
import { License } from '@reportshq/stacks'
import { PLANS } from '../../app/Billing/limits'
import { applicationLimitMessage, ConnectRefusedError, createReportshqAdapter, looksLikeLicenseKey, newLicenseKey } from '../../app/Hq/adapter'

const ORIGIN = 'https://reportshq.test'

/** The `licenses` table, as much of it as the adapter touches. */
function memoryLicenses(seed: AppLicense[] = []): LicenseStore & { rows: AppLicense[] } {
  const rows = seed.map(license => ({ ...license }))
  return {
    rows,
    async findOwnedByApplication(ownerId, application) {
      const found = rows.find(license => license.ownerId === ownerId && license.application.toLowerCase() === application.toLowerCase())
      return found ? { ...found } : null
    },
    async countOwned(ownerId) {
      return rows.filter(license => license.ownerId === ownerId).length
    },
    async create(license) {
      const created = { ...license, id: rows.length + 1 }
      rows.push(created)
      return { ...created }
    },
  }
}

function setup(options: { licenses?: AppLicense[], tiers?: Record<number, string> } = {}) {
  const licenses = memoryLicenses(options.licenses)
  const tiers = options.tiers ?? {}
  const adapter = createReportshqAdapter({
    licenses,
    codes: createMemoryConnectCodeStore(),
    origin: () => ORIGIN,
    tierOf: async ownerId => tiers[ownerId] ?? 'free',
  })
  const service = createHqService(adapter)

  const call = async (path: string, init: { method?: string, body?: unknown } = {}) => {
    const response = await service.handle(new Request(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }))
    return response ? { status: response.status, body: await response.json() as Record<string, unknown> } : null
  }
  const start = async (app: string) => (await call('/api/cli/connect', { method: 'POST', body: { app } }))!.body as { code: string, approveUrl: string }
  const connect = async (app: string, user: HqUser): Promise<LicenseGrant> => {
    const { code } = await start(app)
    await service.approveConnect(code, user, await confirmationCode(code))
    return (await call(`/api/cli/connect/${code}`))!.body as unknown as LicenseGrant
  }

  return { licenses, adapter, service, call, start, connect }
}

const ALICE: HqUser = { id: 1 }
const BOB: HqUser = { id: 2 }

// The package's own suite against this adapter: codes hashed at rest, single
// use under concurrent polls, expiry, reuse, a licence and no keys, and no
// usage route. Pro, so the suite's several application names all fit.
hqServiceContract('reportshq', () => ({ adapter: setup({ tiers: { 1: 'pro' } }).adapter, user: ALICE }))

describe('a licence key', () => {
  test('is the shape the package checks offline', () => {
    const key = newLicenseKey()
    expect(key).toMatch(/^rhq_lic_[0-9a-f]{32}$/)
    expect(looksLikeLicenseKey(key)).toBe(true)
    // The same judgement the embedded package makes, so a key issued here
    // never shows the "not in the expected format" notice there.
    expect(new License(key).valid()).toBe(true)
    expect(new License(key).notice()).toBeNull()
  })

  test('is different every time', () => {
    expect(new Set(Array.from({ length: 200 }, newLicenseKey)).size).toBe(200)
  })

  test('nothing else passes for one', () => {
    for (const value of ['', 'rhq_lic_', `rhq_lic_${'g'.repeat(32)}`, `rhq_lic_${'a'.repeat(31)}`, `RHQ_LIC_${'a'.repeat(32)}`, null, undefined, 12])
      expect(looksLikeLicenseKey(value)).toBe(false)
  })
})

describe('connecting an application', () => {
  test('points a terminal at this service\'s approve page, without the confirmation code', async () => {
    const { start } = setup()
    const { code, approveUrl } = await start('cursio')
    expect(approveUrl).toBe(`${ORIGIN}/cli/connect?code=${code}`)
  })

  test('issues a licence, and nothing a CLI could mistake for keys', async () => {
    const { connect, licenses } = setup()
    const grant = await connect('cursio', ALICE)
    expect(Object.keys(grant).sort()).toEqual(['dashboardUrl', 'licenseKey', 'project', 'status'])
    expect(looksLikeLicenseKey(grant.licenseKey)).toBe(true)
    expect(grant.project.name).toBe('cursio')
    expect(grant.dashboardUrl).toBe(`${ORIGIN}/account`)
    expect(licenses.rows).toEqual([{ id: 1, ownerId: 1, application: 'cursio', key: grant.licenseKey }])
  })

  test('the same application gets the same licence, however its name is cased', async () => {
    const { connect, licenses } = setup()
    const first = await connect('Cursio', ALICE)
    const second = await connect('cursio', ALICE)
    expect(second.licenseKey).toBe(first.licenseKey)
    expect(second.project).toEqual(first.project)
    expect(licenses.rows).toHaveLength(1)
  })

  test('two accounts with an application of the same name do not share a licence', async () => {
    const { connect, licenses } = setup()
    const alice = await connect('shop', ALICE)
    const bob = await connect('shop', BOB)
    expect(bob.licenseKey).not.toBe(alice.licenseKey)
    expect(licenses.rows.map(license => license.ownerId)).toEqual([1, 2])
  })

  test('has no usage route, because nothing is metered', async () => {
    const { service, call } = setup()
    expect(service.routes.map(route => `${route.method} ${route.path}`).sort()).toEqual(['GET /api/cli/connect/{code}', 'POST /api/cli/connect'])
    expect(await call('/api/v1/usage')).toBeNull()
  })

  test('is refused for anyone who is not a signed-in user', async () => {
    const { start, service } = setup()
    for (const id of [0, -1, Number.NaN, 'nobody']) {
      const { code } = await start('cursio')
      await expect(service.approveConnect(code, { id }, await confirmationCode(code))).rejects.toThrow(TypeError)
    }
  })
})

describe('the plan\'s application allowance', () => {
  test('free covers one application and refuses a second, naming the next plan', async () => {
    const { start, service, connect, licenses } = setup()
    await connect('first', ALICE)

    const { code } = await start('second')
    const refused = await service.approveConnect(code, ALICE, await confirmationCode(code)).catch(error => error)
    expect(refused).toBeInstanceOf(ConnectRefusedError)
    expect(refused.reason).toBe('application_limit')
    expect(refused.message).toBe('Free covers 1 application and this account has 1. Hobby covers 3.')
    expect(licenses.rows).toHaveLength(1)
  })

  test('a refused connect is left pending, so an upgrade can still complete it', async () => {
    const tiers: Record<number, string> = {}
    const { start, service, connect, call } = setup({ tiers })
    await connect('first', ALICE)

    const { code } = await start('second')
    await service.approveConnect(code, ALICE, await confirmationCode(code)).catch(() => {})
    expect((await call(`/api/cli/connect/${code}`))!.body).toEqual({ status: 'pending' })

    tiers[1] = 'hobby'
    expect((await service.approveConnect(code, ALICE, await confirmationCode(code))).ok).toBe(true)
    expect((await call(`/api/cli/connect/${code}`))!.body.status).toBe('approved')
  })

  test('reconnecting a licensed application is never refused, at the limit or past it', async () => {
    const { connect } = setup({
      licenses: [
        { id: 1, ownerId: 1, application: 'one', key: newLicenseKey() },
        { id: 2, ownerId: 1, application: 'two', key: newLicenseKey() },
      ],
    })
    // Two licences on a plan that covers one: a downgrade leaves this behind.
    expect(looksLikeLicenseKey((await connect('one', ALICE)).licenseKey)).toBe(true)
    expect(looksLikeLicenseKey((await connect('TWO', ALICE)).licenseKey)).toBe(true)
  })

  test('each plan issues exactly as many as the pricing page says', async () => {
    for (const plan of Object.values(PLANS)) {
      const { connect, start, service, licenses } = setup({ tiers: { 1: plan.tier } })
      for (let i = 0; i < plan.applications; i++)
        await connect(`app-${i}`, ALICE)
      const { code } = await start('one-too-many')
      await expect(service.approveConnect(code, ALICE, await confirmationCode(code))).rejects.toThrow(ConnectRefusedError)
      expect(licenses.rows).toHaveLength(plan.applications)
    }
  })

  test('another account\'s licences do not count against this one', async () => {
    const { connect } = setup()
    await connect('theirs', BOB)
    expect(looksLikeLicenseKey((await connect('mine', ALICE)).licenseKey)).toBe(true)
  })

  test('the message says nothing when there is room, and has no next plan to name at the top', () => {
    expect(applicationLimitMessage('free', 0)).toBeNull()
    expect(applicationLimitMessage('hobby', 2)).toBeNull()
    expect(applicationLimitMessage('hobby', 3)).toBe('Hobby covers 3 applications and this account has 3. Pro covers 10.')
    expect(applicationLimitMessage('pro', 10)).toBe('Pro covers 10 applications and this account has 10. Write to us about a larger estate.')
    // An unknown plan reads as free, like every other gate (planFor).
    expect(applicationLimitMessage('enterprise', 1)).toBe('Free covers 1 application and this account has 1. Hobby covers 3.')
  })
})
