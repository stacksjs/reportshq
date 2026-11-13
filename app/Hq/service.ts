import type { HqService } from '@stacksjs/hq/service'
import type { AppLicense, HqUser, LicenseStore } from './adapter'
import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'
import { createHqService, sqlConnectCodeStore } from '@stacksjs/hq/service'
import { appOrigin } from '../Support/origin'
import { applicationLimitMessage, createReportshqAdapter } from './adapter'

/**
 * The HQ service wired to this app's database. routes/hq.ts mounts its two
 * endpoints and the approve page (resources/views/cli/connect.stx) calls
 * `describeApproval`. The tables behind it are `licenses`
 * (app/Models/License.ts) and `hq_connect_codes` (app/Models/HqConnectCode.ts).
 */

function toLicense(row: Record<string, unknown> | null | undefined): AppLicense | null {
  if (!row)
    return null
  return {
    id: Number(row.id),
    ownerId: Number(row.user_id),
    application: String(row.application ?? ''),
    key: String(row.license_key ?? ''),
  }
}

function utcNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export const sqlLicenseStore: LicenseStore = {
  async findOwnedByApplication(ownerId, application) {
    // lower() on both sides, and oldest first: two names that differ only in
    // case are one application, and there is at most one row in practice.
    return toLicense((await db.unsafe(
      `SELECT id, user_id, application, license_key FROM licenses WHERE user_id = $1 AND lower(application) = lower($2) ORDER BY id ASC LIMIT 1`,
      [ownerId, application],
    ))?.[0])
  },
  async countOwned(ownerId) {
    const row = (await db.unsafe(`SELECT COUNT(*) AS total FROM licenses WHERE user_id = $1`, [ownerId]))?.[0] as { total?: number | string | bigint } | undefined
    return Number(row?.total ?? 0)
  },
  async create(license) {
    // Neither column is fillable on the model, so the row is written here,
    // the one place that issues a licence.
    await db.unsafe(
      `INSERT INTO licenses (user_id, application, license_key, created_at) VALUES ($1, $2, $3, $4)`,
      [license.ownerId, license.application, license.key, utcNow()],
    )
    const created = toLicense((await db.unsafe(`SELECT id, user_id, application, license_key FROM licenses WHERE license_key = $1 LIMIT 1`, [license.key]))?.[0])
    if (!created)
      throw new Error('The licence was not stored.')
    return created
  },
}

/** Every licence an account holds, oldest first. For the account page. */
export async function licensesOwnedBy(ownerId: number): Promise<AppLicense[]> {
  const rows = await db.unsafe(`SELECT id, user_id, application, license_key FROM licenses WHERE user_id = $1 ORDER BY id ASC`, [ownerId]) as Record<string, unknown>[] | undefined
  return (rows ?? []).map(row => toLicense(row)!).filter(Boolean)
}

/** The account's plan, as the user row holds it (app/Models/User.ts). */
export async function tierOf(ownerId: number): Promise<string | null> {
  const row = (await db.unsafe(`SELECT plan FROM users WHERE id = $1`, [ownerId]))?.[0] as { plan?: string | null } | undefined
  return row?.plan ?? null
}

let service: HqService<HqUser> | undefined

/**
 * The service, built on first use rather than at module load: the code store
 * spells its placeholders per dialect, and which database this process is on
 * is only settled once the app's own config has been layered in.
 */
export function hq(): HqService<HqUser> {
  service ??= createHqService(createReportshqAdapter({
    licenses: sqlLicenseStore,
    codes: sqlConnectCodeStore(db, { dialect: config.database?.default === 'postgres' ? 'postgres' : config.database?.default === 'mysql' ? 'mysql' : 'sqlite' }),
    origin: appOrigin,
    tierOf,
  }))
  return service
}

export interface PendingApproval {
  /** The application name the caller asked to connect. Chosen by the caller, not by this account. */
  app: string
  /** True when this account already holds a licence for an application of that name. Approving hands that same licence over. */
  existing: boolean
  /** Why this account cannot license another application, when it cannot. */
  refusal: string | null
}

/**
 * What the approve page shows a signed-in person about a pending code. `null`
 * for an unknown, expired or already approved one.
 */
export async function describeApproval(code: string, userId: number): Promise<PendingApproval | null> {
  const described = await hq().describeConnect(code)
  if (!described)
    return null
  const existing = await sqlLicenseStore.findOwnedByApplication(userId, described.app) !== null
  return {
    app: described.app,
    existing,
    refusal: existing ? null : applicationLimitMessage(await tierOf(userId), await sqlLicenseStore.countOwned(userId)),
  }
}
