/**
 * The plan matrix, and the only place that knows what a licence allows.
 *
 * The pricing page reads this rather than restating it, which is the point: a
 * marketing table maintained separately is a promise somebody eventually breaks
 * by editing one of them, and the person who finds out is a customer who paid
 * for a number that turns out not to be true.
 *
 * **Priced per installed application.** Not per event, and not per seat. Per
 * event was the old shape and it died with the hosted pipeline: there is no
 * ingest to count, and metering an application's own database from outside it
 * would mean the reporting tool phoning home about how much its customer sells.
 * Per seat needs the package to know who is signing in, which means reaching
 * into the host application's auth and keeping a count of its staff. Per
 * application is the one unit that is countable from the outside, obvious to
 * the buyer, and that grows with the estate rather than with a good quarter.
 *
 * **Nothing here gates a report.** These numbers describe what a licence
 * covers, not what the software will do. An application over its allowance
 * keeps reporting on its own data exactly as before; the licence notice says
 * what it says and that is the whole enforcement. A reporting tool that blanks
 * a dashboard over a billing state is one nobody can rely on for the dashboard,
 * and an offline licence could not enforce it anyway without the call it
 * refuses to make. See app/../packages/laravel/src/License.php.
 */

export type Tier = 'free' | 'hobby' | 'pro'

/** Things a tier either can or cannot do. */
export type Capability =
  /** Deliver a report on a schedule (#15). */
  | 'schedules'
  /** Export as XLSX rather than CSV (#15). */
  | 'xlsx'
  /** Share a report publicly. */
  | 'shares'
  /** Embed a report in an iframe. */
  | 'embeds'
  /** Remove the "Made with ReportsHQ" footer from a share. */
  | 'unbranded'
  /** Priority support, and a person rather than a queue. */
  | 'support'

/** Things a tier has a countable allowance of. */
export type Meter = 'applications' | 'reports' | 'seats'

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
  /** Installed applications the licence covers. */
  applications: number
  /** Reports per application. Zero means no ceiling. */
  reports: number
  /** People who may be given the licence key, for support rather than enforcement. */
  seats: number
  capabilities: Capability[]
}

/**
 * The matrix.
 *
 * Generous at the bottom on purpose. One application free and unlimited is not
 * a trial: a person running the package on one side project should never meet a
 * wall, because the only thing a wall teaches is that the product does not
 * work. What is being sold higher up is a second application, a third, and the
 * support that comes with running this across an estate.
 */
export const PLANS: Record<Tier, Plan> = {
  free: {
    tier: 'free',
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
    applications: 1,
    // No ceiling. A report costs us nothing: it runs inside the customer's own
    // application, against their own database, on their own machine. Charging
    // by the report would be charging for something we do not provide.
    reports: 0,
    seats: 1,
    capabilities: ['shares'],
  },
  hobby: {
    tier: 'hobby',
    name: 'Hobby',
    price: 900,
    yearlyPrice: 9000,
    applications: 3,
    reports: 0,
    seats: 3,
    capabilities: ['shares', 'schedules', 'xlsx'],
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    price: 4900,
    yearlyPrice: 49000,
    // Ten rather than unlimited, so the number means something. An agency with
    // forty client applications is a conversation worth having rather than a
    // row in a table.
    applications: 10,
    reports: 0,
    seats: 25,
    capabilities: ['shares', 'schedules', 'xlsx', 'embeds', 'unbranded', 'support'],
  },
}

export const TIERS: Tier[] = ['free', 'hobby', 'pro']


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
    case 'applications':
      return plan.applications
    case 'reports':
      return plan.reports
    case 'seats':
      return plan.seats
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
