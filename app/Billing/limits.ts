/**
 * The plan matrix, and the only place that knows what a tier allows.
 *
 * Every gate reads this, and so does the pricing page. That is the point: a
 * marketing table maintained separately from enforcement is a promise somebody
 * eventually breaks by editing one of them, and the person who finds out is a
 * customer who paid for a number that turns out not to be true.
 *
 * Two rules run through the whole file.
 *
 * **Limits fail soft.** Being over a quota is a billing conversation, not an
 * outage. Nothing here throws, nothing returns a 500, and the ingest path in
 * particular keeps accepting data through a documented grace band rather than
 * dropping a customer's events the moment they cross a line they cannot see.
 *
 * **Nothing is dropped silently.** Where data is refused, it is refused with a
 * machine-readable reason and counted, so the number in the usage meter and the
 * number in the database always have the same explanation.
 */

export type Tier = 'free' | 'hobby' | 'pro'

/** Things a tier either can or cannot do. */
export type Capability =
  /** Deliver a report on a schedule (#15). */
  | 'schedules'
  /** Export as XLSX rather than CSV (#15). */
  | 'xlsx'
  /** Share a report publicly (#16). */
  | 'shares'
  /** Embed a report in an iframe (#16). */
  | 'embeds'
  /** Remove the "Made with ReportsHQ" footer from a share. */
  | 'unbranded'

/** Things a tier has a countable allowance of. */
export type Meter = 'events' | 'projects' | 'reports' | 'members' | 'shares'

export interface Plan {
  tier: Tier
  name: string
  /** Monthly price in cents. Zero is free, and is shown as free rather than as 0.00. */
  price: number
  /**
   * Price in cents for a year paid up front. Zero on a free plan.
   *
   * Ten months rather than twelve, so a year costs the same as paying monthly
   * and skipping two. The pricing page states the saving by computing it from
   * these two numbers rather than printing a claim beside them, which is how a
   * discount ends up advertised as larger than it is.
   */
  yearlyPrice: number
  /** Events per calendar month, per project. */
  events: number
  /** Projects per account. */
  projects: number
  /** Reports per project. */
  reports: number
  /** Members per project, including the owner. */
  members: number
  /** Live share links per project. */
  shares: number
  /** Days of raw events kept. Rollups outlive this; see docs/limits.md. */
  retentionDays: number
  capabilities: Capability[]
}

/**
 * The matrix.
 *
 * Numbers are deliberately round and deliberately generous at the bottom. A
 * free tier that cannot hold a month of a real hobby project's events teaches
 * people the product does not work, which is a worse outcome than the cost of
 * the rows.
 */
export const PLANS: Record<Tier, Plan> = {
  free: {
    tier: 'free',
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
    events: 50_000,
    projects: 1,
    reports: 5,
    members: 1,
    shares: 1,
    retentionDays: 30,
    capabilities: ['shares'],
  },
  hobby: {
    tier: 'hobby',
    name: 'Hobby',
    price: 900,
    yearlyPrice: 9000,
    events: 500_000,
    projects: 3,
    reports: 25,
    members: 3,
    shares: 10,
    retentionDays: 90,
    capabilities: ['shares', 'embeds', 'schedules'],
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    price: 2900,
    yearlyPrice: 29000,
    events: 5_000_000,
    projects: 25,
    reports: 200,
    members: 25,
    shares: 100,
    retentionDays: 365,
    capabilities: ['shares', 'embeds', 'schedules', 'xlsx', 'unbranded'],
  },
}

export const TIERS: Tier[] = ['free', 'hobby', 'pro']

/**
 * How far past an event quota a project is carried before anything is refused.
 *
 * Ten percent, once. A project that crosses its limit mid-month is usually
 * having a good week, and cutting its data off at exactly 100% means the report
 * that would have shown them the good week is the one with a hole in it. The
 * band is announced in docs/limits.md and in the meter, so it is a stated
 * allowance rather than a surprise that runs out.
 */
export const GRACE_FRACTION = 0.1

/** A plan, from whatever the user row holds. Unknown values read as free. */
export function planFor(tier: unknown): Plan {
  const key = String(tier ?? 'free').toLowerCase() as Tier
  return PLANS[key] ?? PLANS.free
}

/** Whether a tier may do something at all. */
export function can(tier: unknown, capability: Capability): boolean {
  return planFor(tier).capabilities.includes(capability)
}

/** The allowance for a meter on a tier. */
export function allowanceFor(tier: unknown, meter: Meter): number {
  const plan = planFor(tier)

  switch (meter) {
    case 'events':
      return plan.events
    case 'projects':
      return plan.projects
    case 'reports':
      return plan.reports
    case 'members':
      return plan.members
    case 'shares':
      return plan.shares
  }
}

export interface Usage {
  meter: Meter
  used: number
  allowance: number
  /** Remaining before the allowance, never negative. */
  remaining: number
  /** 0 to 1, and beyond 1 when over. */
  fraction: number
  /** At or past the allowance. */
  atLimit: boolean
  /** Past 80%, the point worth telling somebody about. */
  nearLimit: boolean
}

/**
 * Describe usage against an allowance.
 *
 * Returns a shape rather than a boolean because every caller needs a different
 * part of it: a gate needs `atLimit`, a meter needs `fraction`, and an email
 * needs to know whether 80% has just been crossed.
 */
export function usageOf(tier: unknown, meter: Meter, used: number): Usage {
  const allowance = allowanceFor(tier, meter)
  const safeUsed = Math.max(0, Math.trunc(used) || 0)
  const fraction = allowance > 0 ? safeUsed / allowance : 0

  return {
    meter,
    used: safeUsed,
    allowance,
    remaining: Math.max(0, allowance - safeUsed),
    fraction,
    atLimit: safeUsed >= allowance,
    nearLimit: fraction >= 0.8,
  }
}

export type IngestVerdict = 'accept' | 'grace' | 'reject'

/**
 * What to do with a write from a project at this usage.
 *
 * Three answers rather than two, because the middle one is the whole policy:
 * between the quota and the grace band the data is still accepted, and the
 * caller is told so it can say something. Only past the band is anything
 * refused.
 */
export function ingestVerdict(tier: unknown, used: number): IngestVerdict {
  const allowance = allowanceFor(tier, 'events')
  const ceiling = Math.floor(allowance * (1 + GRACE_FRACTION))

  if (used < allowance)
    return 'accept'

  if (used < ceiling)
    return 'grace'

  return 'reject'
}

/** The event ceiling including grace, for the meter and the docs. */
export function ingestCeiling(tier: unknown): number {
  return Math.floor(allowanceFor(tier, 'events') * (1 + GRACE_FRACTION))
}

/**
 * The cheapest tier that would lift a limit.
 *
 * Used to make a refusal actionable: "you have hit the Free limit" is a dead
 * end, and "Hobby carries 500,000" is a next step.
 */
export function nextTierFor(tier: unknown, meter: Meter): Plan | null {
  const current = planFor(tier)
  const index = TIERS.indexOf(current.tier)

  for (const candidate of TIERS.slice(index + 1)) {
    if (allowanceFor(candidate, meter) > allowanceFor(current.tier, meter))
      return PLANS[candidate]
  }

  return null
}

/** The cheapest tier that includes a capability. */
export function tierWith(capability: Capability): Plan | null {
  for (const tier of TIERS) {
    if (PLANS[tier].capabilities.includes(capability))
      return PLANS[tier]
  }

  return null
}
