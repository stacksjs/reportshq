import type { ConnectCodeStore, HqServiceAdapter, LicenseGrant } from '@stacksjs/hq/service'
import type { Tier } from '../Billing/limits'
import { allowanceFor, nextTierFor, planFor } from '../Billing/limits'

/**
 * ReportsHQ's side of the HQ connect contract (`@stacksjs/hq/service`).
 *
 * `buddy hq:connect reportshq` asks for a code, a signed-in person approves
 * it on /cli/connect, and the CLI collects a licence key and writes it to the
 * app's `REPORTSHQ_LICENSE`. The package owns the codes and the wire format.
 * This file owns what they mean here: which licence, and whether the account
 * may have another.
 *
 * ReportsHQ is the licence-only kind of service. The product runs inside the
 * customer's application against their own database and never calls back, so
 * there is no ingest key, no read key and nothing to meter. The adapter
 * therefore answers a `LicenseGrant` and has no `authenticateReadKey` and no
 * `usage`, which leaves the service with the two connect routes and no usage
 * route.
 *
 * Nothing in this file touches the database. It is handed a `LicenseStore`,
 * which is what lets the package's contract suite run against the same code
 * the routes use (tests/unit/hq-connect.test.ts).
 */

export const LICENSE_PREFIX = 'rhq_lic_'

/** `rhq_lic_` and 32 hex characters: the shape `@reportshq/stacks` and reportshq/laravel check offline. */
export function newLicenseKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `${LICENSE_PREFIX}${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function looksLikeLicenseKey(value: unknown): value is string {
  return typeof value === 'string' && /^rhq_lic_[0-9a-f]{32}$/.test(value)
}

/** One licence: one installed application on one account. */
export interface AppLicense {
  id: number
  ownerId: number
  /** The application's name, as the CLI sent it the first time. */
  application: string
  key: string
}

export interface LicenseStore {
  /** The owner's licence for an application of this name, compared case-insensitively. */
  findOwnedByApplication: (ownerId: number, application: string) => Promise<AppLicense | null>
  countOwned: (ownerId: number) => Promise<number>
  create: (license: Omit<AppLicense, 'id'>) => Promise<AppLicense>
}

/** The signed-in person approving a connect. */
export interface HqUser {
  id: number | string
}

export type ConnectRefusal = 'application_limit'

/** A connect the account is not allowed to complete, with a sentence for the page. */
export class ConnectRefusedError extends Error {
  readonly reason: ConnectRefusal

  constructor(reason: ConnectRefusal, message: string) {
    super(message)
    this.name = 'ConnectRefusedError'
    this.reason = reason
  }
}

/**
 * Why an account cannot license one more application, or `null` when it can.
 *
 * The allowance is the plan's `applications` number and nothing else. It
 * limits how many licences an account is issued. It does not reach into any
 * application: one that is already licensed, or not licensed at all, reports
 * on its own data exactly as before (app/Billing/limits.ts).
 */
export function applicationLimitMessage(tier: unknown, used: number): string | null {
  const allowance = allowanceFor(tier, 'applications')
  if (used < allowance)
    return null

  const plan = planFor(tier)
  const covers = `${plan.name} covers ${allowance} ${allowance === 1 ? 'application' : 'applications'} and this account has ${used}.`
  const next = nextTierFor(tier, 'applications')
  return next
    ? `${covers} ${next.name} covers ${next.applications}.`
    : `${covers} Write to us about a larger estate.`
}

export interface ReportshqAdapterDeps {
  licenses: LicenseStore
  codes: ConnectCodeStore
  /** Public web origin, no trailing slash. */
  origin: () => string
  /** The account's plan, as the user row holds it. */
  tierOf: (ownerId: number) => Promise<Tier | string | null | undefined>
}

export function createReportshqAdapter(deps: ReportshqAdapterDeps): HqServiceAdapter<HqUser> {
  const { licenses } = deps

  async function provision(user: HqUser, { app }: { app: string }): Promise<LicenseGrant> {
    const ownerId = Number(user.id)
    if (!Number.isFinite(ownerId) || ownerId <= 0)
      throw new TypeError('A connect can only be approved by a signed-in user.')

    // An application that is already licensed keeps its licence. Connecting a
    // second machine, or the same one again, must hand back the same key and
    // must not count as another application.
    let license = await licenses.findOwnedByApplication(ownerId, app)

    if (!license) {
      const refusal = applicationLimitMessage(await deps.tierOf(ownerId), await licenses.countOwned(ownerId))
      if (refusal)
        throw new ConnectRefusedError('application_limit', refusal)
      license = await licenses.create({ ownerId, application: app, key: newLicenseKey() })
    }

    return {
      project: { id: String(license.id), name: license.application },
      licenseKey: license.key,
      dashboardUrl: `${deps.origin()}/account`,
    }
  }

  return {
    service: 'reportshq',
    approveUrl: code => `${deps.origin()}/cli/connect?code=${encodeURIComponent(code)}`,
    upgradeUrl: () => `${deps.origin()}/pricing`,
    codes: deps.codes,
    provision,
  }
}
