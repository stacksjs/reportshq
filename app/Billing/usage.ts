/**
 * Reading and moving the meters.
 *
 * Two kinds of number live here and they behave differently.
 *
 * **Events are counted, not measured.** A monthly counter is incremented as
 * writes are accepted, because the ingest path cannot afford a `COUNT(*)` and
 * because the count has to survive retention: a project that sent four million
 * events in March and had them pruned in June still used four million events in
 * March, and its bill should say so.
 *
 * **Everything else is measured live.** Projects, reports, members and shares
 * are small numbers over indexed columns, and a counter for each would be four
 * more things that can drift from the rows they claim to describe.
 */
import type { Meter, Tier, Usage } from './limits'
import { db } from '@stacksjs/database'
import { allowanceFor, ingestVerdict, planFor, usageOf } from './limits'

/**
 * The calendar month a moment falls in, for a project.
 *
 * In the project's own timezone, so a month boundary means the same thing to
 * the customer as it does to the invoice. A project in Auckland whose month
 * rolled over eleven hours ago should not be billed against a month that, as
 * far as anybody there is concerned, ended yesterday.
 */
export function monthKey(timezone: string, at: Date = new Date()): string {
  try {
    // `en-CA` gives YYYY-MM-DD, which slices to a month key without parsing.
    const local = at.toLocaleDateString('en-CA', { timeZone: timezone || 'UTC' })
    return local.slice(0, 7)
  }
  catch {
    // An unknown zone is a data problem, not a reason to refuse a write.
    return at.toISOString().slice(0, 7)
  }
}

/** The account tier a project bills against: its owner's. */
export async function tierForProject(projectId: number): Promise<Tier> {
  const rows = await db.unsafe(
    `SELECT u.plan AS plan
       FROM projects p JOIN users u ON u.id = p.owner_id
      WHERE p.id = $1`,
    [projectId],
  ) as Array<{ plan: string }>

  return planFor(rows[0]?.plan).tier
}

export interface Counter {
  events: number
  rejected: number
  notifiedAtPercent: number
}

/** This month's counter, or zeroes when nothing has been written yet. */
export async function counterFor(projectId: number, timezone: string, at?: Date): Promise<Counter> {
  const month = monthKey(timezone, at)

  const rows = await db.unsafe(
    `SELECT events, rejected, notified_at_percent FROM usage_counters WHERE project_id = $1 AND month = $2`,
    [projectId, month],
  ) as Array<{ events: number, rejected: number, notified_at_percent: number }>

  const row = rows[0]

  return {
    events: Number(row?.events ?? 0),
    rejected: Number(row?.rejected ?? 0),
    notifiedAtPercent: Number(row?.notified_at_percent ?? 0),
  }
}

/**
 * Add to this month's counters.
 *
 * Written as an upsert on the unique `(project_id, month)` index rather than a
 * read followed by a write. Two ingest requests for the same project land at
 * the same moment routinely, and a read-modify-write would lose one of them
 * every time it happened, which is exactly the sort of undercount nobody
 * notices until an invoice is queried.
 */
export async function recordUsage(
  projectId: number,
  timezone: string,
  counts: { events?: number, rejected?: number },
  at?: Date,
): Promise<void> {
  const month = monthKey(timezone, at)
  const events = Math.max(0, Math.trunc(counts.events ?? 0))
  const rejected = Math.max(0, Math.trunc(counts.rejected ?? 0))

  if (events === 0 && rejected === 0)
    return

  await db.unsafe(
    `INSERT INTO usage_counters (project_id, month, events, rejected, notified_at_percent, created_at)
     VALUES ($1, $2, $3, $4, 0, CURRENT_TIMESTAMP)
     ON CONFLICT (project_id, month)
     DO UPDATE SET
       events = usage_counters.events + $3,
       rejected = usage_counters.rejected + $4,
       updated_at = CURRENT_TIMESTAMP`,
    [projectId, month, events, rejected],
  )
}

/** Remember that a threshold has been announced, so it is not announced twice. */
export async function markNotified(projectId: number, timezone: string, percent: number, at?: Date): Promise<void> {
  await db.unsafe(
    `UPDATE usage_counters SET notified_at_percent = $1, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = $2 AND month = $3 AND notified_at_percent < $1`,
    [Math.trunc(percent), projectId, monthKey(timezone, at)],
  )
}

/** Live counts for the meters that are cheap to measure. */
async function liveCount(meter: Meter, projectId: number, ownerId: number): Promise<number> {
  switch (meter) {
    case 'projects': {
      const rows = await db.unsafe(
        `SELECT COUNT(*) AS n FROM projects WHERE owner_id = $1 AND deleted_at IS NULL`,
        [ownerId],
      ) as Array<{ n: number }>
      return Number(rows[0]?.n ?? 0)
    }
    case 'reports': {
      const rows = await db.unsafe(
        `SELECT COUNT(*) AS n FROM reports WHERE project_id = $1 AND deleted_at IS NULL`,
        [projectId],
      ) as Array<{ n: number }>
      return Number(rows[0]?.n ?? 0)
    }
    case 'members': {
      // The owner holds no seat row, so they are counted as the +1 rather than
      // being missed. A "members: 1" plan that in fact allows an owner plus one
      // other person would be a limit nobody could reason about.
      const rows = await db.unsafe(
        `SELECT COUNT(*) AS n FROM project_members WHERE project_id = $1`,
        [projectId],
      ) as Array<{ n: number }>
      return Number(rows[0]?.n ?? 0) + 1
    }
    case 'shares': {
      const rows = await db.unsafe(
        `SELECT COUNT(*) AS n FROM report_shares s
           JOIN reports r ON r.id = s.report_id
          WHERE r.project_id = $1 AND s.revoked_at IS NULL`,
        [projectId],
      ) as Array<{ n: number }>
      return Number(rows[0]?.n ?? 0)
    }
    default:
      return 0
  }
}

/**
 * Usage of one meter for a project.
 *
 * Events come from the counter; everything else is measured. The caller gets
 * the same `Usage` shape either way, so a gate does not need to know which kind
 * of number it is looking at.
 */
export async function usageFor(projectId: number, meter: Meter): Promise<Usage> {
  const rows = await db.unsafe(
    `SELECT p.owner_id AS owner_id, p.timezone AS timezone, u.plan AS plan
       FROM projects p JOIN users u ON u.id = p.owner_id
      WHERE p.id = $1`,
    [projectId],
  ) as Array<{ owner_id: number, timezone: string, plan: string }>

  const row = rows[0]
  if (!row)
    return usageOf('free', meter, 0)

  const tier = planFor(row.plan).tier

  if (meter === 'events') {
    const counter = await counterFor(projectId, String(row.timezone ?? 'UTC'))
    return usageOf(tier, 'events', counter.events)
  }

  return usageOf(tier, meter, await liveCount(meter, projectId, Number(row.owner_id)))
}

export interface IngestAllowance {
  verdict: 'accept' | 'grace' | 'reject'
  tier: Tier
  used: number
  allowance: number
  /** Seconds until the quota resets, for a Retry-After on a refusal. */
  resetsIn: number
}

/**
 * Whether a project may write, and how close it is.
 *
 * Read before a batch is stored, so a refusal costs one indexed lookup rather
 * than a parse and an insert. The verdict carries the numbers with it, because
 * every caller that refuses a write also wants to explain it.
 */
export async function ingestAllowanceFor(projectId: number, timezone: string, at: Date = new Date()): Promise<IngestAllowance> {
  const tier = await tierForProject(projectId)
  const counter = await counterFor(projectId, timezone, at)

  return {
    verdict: ingestVerdict(tier, counter.events),
    tier,
    used: counter.events,
    allowance: allowanceFor(tier, 'events'),
    resetsIn: secondsUntilNextMonth(timezone, at),
  }
}

/**
 * Seconds until the meter resets.
 *
 * Computed in the project's timezone for the same reason the month key is: a
 * Retry-After that expires eleven hours before or after the quota actually
 * resets sends somebody back to a wall they were told they had cleared.
 */
export function secondsUntilNextMonth(timezone: string, at: Date = new Date()): number {
  const local = (() => {
    try {
      return at.toLocaleString('en-CA', { timeZone: timezone || 'UTC', hour12: false })
    }
    catch {
      return at.toISOString().replace('T', ' ').slice(0, 19)
    }
  })()

  const [datePart] = local.split(/[,\s]+/)
  const [year, month] = String(datePart ?? '').split('-').map(Number)

  if (!year || !month)
    return 3600

  // The first instant of the next month, treated as UTC. The result is used as
  // a duration, so a few hours of zone offset is immaterial next to a month.
  const next = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1)
  const nowish = Date.UTC(year, month - 1, Number(String(local).slice(8, 10)) || 1)

  return Math.max(60, Math.round((next - nowish) / 1000))
}
