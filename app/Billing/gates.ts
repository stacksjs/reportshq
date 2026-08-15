/**
 * Refusing something because of a plan, in a way somebody can act on.
 *
 * The message is the feature. "You have reached the Free limit" is a dead end;
 * "Free covers 5 reports. Hobby covers 25." is a next step, and it is the only
 * difference between a limit that sells an upgrade and one that reads as the
 * product being broken.
 *
 * Every gate throws a `LimitReached`, which carries the numbers as well as the
 * sentence, so an interface can render a panel and an API can return a body
 * without either of them re-deriving what happened.
 */
import type { Capability, Meter, Tier } from './limits'
import { db } from '@stacksjs/database'
import { allowanceFor, can, nextTierFor, planFor, tierWith } from './limits'
import { usageFor } from './usage'

export class LimitReached extends Error {
  constructor(
    message: string,
    readonly meter: Meter | null,
    readonly capability: Capability | null,
    readonly tier: Tier,
    readonly used: number,
    readonly allowance: number,
    readonly upgradeTo: Tier | null,
  ) {
    super(message)
    this.name = 'LimitReached'
  }
}

/** Plural-aware, because "1 reports" is the sort of thing people notice. */
function count(n: number, singular: string): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? singular : `${singular}s`}`
}

/**
 * Refuse when a meter is at its allowance.
 *
 * Checked before the write rather than after, so nothing half-exists: a report
 * that was created and then refused would need cleaning up, and the cleanup is
 * the part that goes wrong.
 */
export async function assertWithin(projectId: number, meter: Meter, noun: string): Promise<void> {
  const usage = await usageFor(projectId, meter)

  if (!usage.atLimit)
    return

  const tier = await tierOfProject(projectId)
  const next = nextTierFor(tier, meter)

  const upgrade = next
    ? ` ${next.name} covers ${count(allowanceFor(next.tier, meter), noun)}.`
    : ''

  throw new LimitReached(
    `${planFor(tier).name} covers ${count(usage.allowance, noun)}.${upgrade}`,
    meter,
    null,
    tier,
    usage.used,
    usage.allowance,
    next?.tier ?? null,
  )
}

/** Refuse when a tier does not include a capability at all. */
export async function assertCan(projectId: number, capability: Capability, noun: string): Promise<void> {
  const tier = await tierOfProject(projectId)

  if (can(tier, capability))
    return

  const needed = tierWith(capability)

  throw new LimitReached(
    needed
      ? `${noun} is part of ${needed.name}.`
      : `${noun} is not available on this plan.`,
    null,
    capability,
    tier,
    0,
    0,
    needed?.tier ?? null,
  )
}

/**
 * The account allowance for a person about to create their first project.
 *
 * Projects are counted per account, not per project, so this one cannot go
 * through `usageFor`, which resolves a tier from a project that does not exist
 * yet.
 */
export async function assertCanCreateProject(user: { id: number }): Promise<void> {
  const rows = await db.unsafe(`SELECT plan FROM users WHERE id = $1`, [Number(user.id)]) as Array<{ plan: string }>
  const tier = planFor(rows[0]?.plan).tier

  const owned = await db.unsafe(
    `SELECT COUNT(*) AS n FROM projects WHERE owner_id = $1 AND deleted_at IS NULL`,
    [Number(user.id)],
  ) as Array<{ n: number }>

  const used = Number(owned[0]?.n ?? 0)
  const allowance = allowanceFor(tier, 'projects')

  if (used < allowance)
    return

  const next = nextTierFor(tier, 'projects')

  throw new LimitReached(
    `${planFor(tier).name} covers ${count(allowance, 'project')}.${next ? ` ${next.name} covers ${count(allowanceFor(next.tier, 'projects'), 'project')}.` : ''}`,
    'projects',
    null,
    tier,
    used,
    allowance,
    next?.tier ?? null,
  )
}

async function tierOfProject(projectId: number): Promise<Tier> {
  const rows = await db.unsafe(
    `SELECT u.plan AS plan FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [projectId],
  ) as Array<{ plan: string }>

  return planFor(rows[0]?.plan).tier
}

/**
 * The body an API returns for a refused limit.
 *
 * `402 Payment Required` rather than `403`: this is not a permission problem,
 * and a client that treats every 403 as "sign in again" would send somebody
 * round a loop that cannot help them.
 */
export function limitResponse(error: LimitReached): { body: Record<string, unknown>, status: 402 } {
  return {
    status: 402,
    body: {
      error: 'plan_limit',
      message: error.message,
      meter: error.meter,
      capability: error.capability,
      plan: error.tier,
      used: error.used,
      allowance: error.allowance,
      upgrade_to: error.upgradeTo,
    },
  }
}
