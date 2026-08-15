/**
 * Plan limits and metering.
 *
 * Two properties matter more than the arithmetic and are why most of these
 * exist. A limit must **fail soft** - being over a quota is a billing
 * conversation, not an outage - and nothing may be **dropped without being
 * counted**, or the meter and the database end up disagreeing with no way to
 * explain the gap to whoever is looking at an invoice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import {
  allowanceFor,
  can,
  GRACE_FRACTION,
  ingestCeiling,
  ingestVerdict,
  nextTierFor,
  planFor,
  PLANS,
  TIERS,
  tierWith,
  usageOf,
} from '../../app/Billing/limits'
import { counterFor, ingestAllowanceFor, markNotified, monthKey, recordUsage, secondsUntilNextMonth, usageFor } from '../../app/Billing/usage'
import { assertCan, LimitReached, limitResponse } from '../../app/Billing/gates'
import { createReport } from '../../app/Reports/reports'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number

beforeAll(async () => {
  const email = `limits-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'free', CURRENT_TIMESTAMP)`,
    ['limits owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }

  projectId = Number((await createProject(owner, { name: `Limits ${stamp}`, timezone: 'UTC' })).id)
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

beforeEach(async () => {
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`UPDATE users SET plan = 'free' WHERE id = $1`, [owner.id])
})

describe('the plan matrix', () => {
  test('every tier is defined and ordered by generosity', () => {
    // The pricing page reads this same table, so a tier that is cheaper and
    // more generous than the one above it would be published as such.
    for (let index = 1; index < TIERS.length; index++) {
      const lower = PLANS[TIERS[index - 1]!]
      const higher = PLANS[TIERS[index]!]

      expect(higher.price).toBeGreaterThan(lower.price)
      expect(higher.events).toBeGreaterThan(lower.events)
      expect(higher.retentionDays).toBeGreaterThanOrEqual(lower.retentionDays)
      expect(higher.capabilities.length).toBeGreaterThanOrEqual(lower.capabilities.length)
    }
  })

  test('a higher tier never loses a capability a lower one had', () => {
    // Somebody upgrading must never find something they could do before is now
    // gone. That would be a refund conversation.
    for (let index = 1; index < TIERS.length; index++) {
      for (const capability of PLANS[TIERS[index - 1]!].capabilities)
        expect(PLANS[TIERS[index]!].capabilities).toContain(capability)
    }
  })

  test('an unknown or missing plan reads as free rather than throwing', () => {
    // A limit check runs on the ingest path. It cannot be the thing that
    // breaks because a plan column held something unexpected.
    expect(planFor(undefined).tier).toBe('free')
    expect(planFor('enterprise').tier).toBe('free')
    expect(planFor(null).tier).toBe('free')
  })

  test('capabilities are gated by tier', () => {
    expect(can('free', 'shares')).toBeTrue()
    expect(can('free', 'schedules')).toBeFalse()
    expect(can('hobby', 'schedules')).toBeTrue()
    expect(can('hobby', 'xlsx')).toBeFalse()
    expect(can('pro', 'xlsx')).toBeTrue()
    expect(can('pro', 'unbranded')).toBeTrue()
  })

  test('a refusal can name the tier that would lift it', () => {
    // "You have hit the Free limit" is a dead end. "Hobby carries 500,000" is
    // a next step.
    expect(nextTierFor('free', 'events')?.tier).toBe('hobby')
    expect(nextTierFor('pro', 'events')).toBeNull()
    expect(tierWith('xlsx')?.tier).toBe('pro')
    expect(tierWith('shares')?.tier).toBe('free')
  })
})

describe('usage arithmetic', () => {
  test('reports the shape a gate, a meter and an email each need', () => {
    const usage = usageOf('free', 'events', 40_000)

    expect(usage.allowance).toBe(PLANS.free.events)
    expect(usage.remaining).toBe(10_000)
    expect(usage.fraction).toBeCloseTo(0.8, 5)
    expect(usage.nearLimit).toBeTrue()
    expect(usage.atLimit).toBeFalse()
  })

  test('never reports negative headroom', () => {
    const usage = usageOf('free', 'events', PLANS.free.events * 2)

    expect(usage.remaining).toBe(0)
    expect(usage.atLimit).toBeTrue()
    expect(usage.fraction).toBeGreaterThan(1)
  })

  test('nonsense usage is treated as zero rather than throwing', () => {
    expect(usageOf('free', 'events', Number.NaN).used).toBe(0)
    expect(usageOf('free', 'events', -5).used).toBe(0)
  })
})

describe('the ingest verdict', () => {
  const allowance = PLANS.free.events
  const ceiling = ingestCeiling('free')

  test('below the quota, at it, and inside the grace band', () => {
    // The three cases the whole policy turns on.
    expect(ingestVerdict('free', allowance - 1)).toBe('accept')
    expect(ingestVerdict('free', allowance)).toBe('grace')
    expect(ingestVerdict('free', ceiling - 1)).toBe('grace')
  })

  test('past the grace band it refuses', () => {
    expect(ingestVerdict('free', ceiling)).toBe('reject')
    expect(ingestVerdict('free', ceiling + 1000)).toBe('reject')
  })

  test('the grace band is the documented fraction of the allowance', () => {
    expect(ceiling).toBe(Math.floor(allowance * (1 + GRACE_FRACTION)))
  })

  test('a larger plan carries a proportionally larger band', () => {
    expect(ingestVerdict('pro', allowance + 1)).toBe('accept')
  })
})

describe('metering', () => {
  test('a project with no writes reads as zero rather than missing', async () => {
    const counter = await counterFor(projectId, 'UTC')

    expect(counter.events).toBe(0)
    expect(counter.rejected).toBe(0)
  })

  test('usage accumulates across calls', async () => {
    await recordUsage(projectId, 'UTC', { events: 10 })
    await recordUsage(projectId, 'UTC', { events: 5 })

    expect((await counterFor(projectId, 'UTC')).events).toBe(15)
  })

  test('refusals are counted, not forgotten', async () => {
    // Otherwise the meter and the database disagree and nobody can explain the
    // gap to a customer asking where their events went.
    await recordUsage(projectId, 'UTC', { rejected: 7 })

    expect((await counterFor(projectId, 'UTC')).rejected).toBe(7)
  })

  test('recording nothing writes nothing', async () => {
    await recordUsage(projectId, 'UTC', { events: 0, rejected: 0 })

    const rows = await db.unsafe(
      `SELECT COUNT(*) AS n FROM usage_counters WHERE project_id = $1`,
      [projectId],
    ) as Array<{ n: number }>

    expect(Number(rows[0]?.n)).toBe(0)
  })

  test('concurrent writes do not lose each other', async () => {
    // A read-modify-write would drop one of these every time two ingest
    // requests for the same project landed together, which is routine. The
    // upsert is what makes the count survive it.
    await Promise.all(Array.from({ length: 20 }, () => recordUsage(projectId, 'UTC', { events: 1 })))

    expect((await counterFor(projectId, 'UTC')).events).toBe(20)
  })

  test('a new month starts from zero', async () => {
    const now = new Date('2026-03-15T12:00:00.000Z')
    const nextMonth = new Date('2026-04-01T00:30:00.000Z')

    await recordUsage(projectId, 'UTC', { events: 100 }, now)

    expect((await counterFor(projectId, 'UTC', now)).events).toBe(100)
    expect((await counterFor(projectId, 'UTC', nextMonth)).events).toBe(0)
  })

  test('the month is the project\'s, not the server\'s', async () => {
    // 11:00 UTC on the last day of March is already April in Auckland. Billing
    // a customer against a month that ended yesterday where they live is the
    // kind of thing that reads as a bug in the invoice.
    const moment = new Date('2026-03-31T11:30:00.000Z')

    expect(monthKey('UTC', moment)).toBe('2026-03')
    expect(monthKey('Pacific/Auckland', moment)).toBe('2026-04')
  })

  test('an unknown timezone falls back rather than refusing a write', () => {
    expect(monthKey('Not/AZone', new Date('2026-03-15T00:00:00.000Z'))).toBe('2026-03')
  })

  test('a notification threshold is remembered, and never lowered', async () => {
    await recordUsage(projectId, 'UTC', { events: 1 })

    await markNotified(projectId, 'UTC', 80)
    expect((await counterFor(projectId, 'UTC')).notifiedAtPercent).toBe(80)

    await markNotified(projectId, 'UTC', 100)
    expect((await counterFor(projectId, 'UTC')).notifiedAtPercent).toBe(100)

    // A later 80% must not re-arm the warning and start a nag storm.
    await markNotified(projectId, 'UTC', 80)
    expect((await counterFor(projectId, 'UTC')).notifiedAtPercent).toBe(100)
  })
})

describe('live meters', () => {
  test('reports are counted from the rows, not a counter', async () => {
    const usage = await usageFor(projectId, 'reports')

    expect(usage.allowance).toBe(PLANS.free.reports)
    expect(usage.used).toBe(0)
  })

  test('the owner counts toward the member allowance', async () => {
    // The owner holds no seat row. A "members: 1" plan that in fact allowed an
    // owner plus one other person would be a limit nobody could reason about.
    const usage = await usageFor(projectId, 'members')

    expect(usage.used).toBe(1)
    expect(usage.atLimit).toBeTrue()
  })

  test('a project that does not exist reads as an empty free plan', async () => {
    const usage = await usageFor(999_999, 'reports')

    expect(usage.used).toBe(0)
    expect(usage.allowance).toBe(PLANS.free.reports)
  })
})

describe('the ingest allowance', () => {
  test('accepts below the quota', async () => {
    await recordUsage(projectId, 'UTC', { events: 10 })
    const allowance = await ingestAllowanceFor(projectId, 'UTC')

    expect(allowance.verdict).toBe('accept')
    expect(allowance.tier).toBe('free')
    expect(allowance.used).toBe(10)
  })

  test('moves into grace at the quota and refuses past the band', async () => {
    await recordUsage(projectId, 'UTC', { events: allowanceFor('free', 'events') })
    expect((await ingestAllowanceFor(projectId, 'UTC')).verdict).toBe('grace')

    await recordUsage(projectId, 'UTC', { events: ingestCeiling('free') })
    expect((await ingestAllowanceFor(projectId, 'UTC')).verdict).toBe('reject')
  })

  test('upgrading unblocks immediately, with no other change', async () => {
    // The acceptance criterion for this issue: the plan column is what every
    // gate reads, so a webhook writing it is the whole of an upgrade.
    await recordUsage(projectId, 'UTC', { events: ingestCeiling('free') })
    expect((await ingestAllowanceFor(projectId, 'UTC')).verdict).toBe('reject')

    await db.unsafe(`UPDATE users SET plan = 'hobby' WHERE id = $1`, [owner.id])

    expect((await ingestAllowanceFor(projectId, 'UTC')).verdict).toBe('accept')
  })

  test('carries a reset time a Retry-After can use', async () => {
    const allowance = await ingestAllowanceFor(projectId, 'UTC')

    expect(allowance.resetsIn).toBeGreaterThan(60)
    // A month at most, so a header can never promise a wait longer than the
    // period it resets on.
    expect(allowance.resetsIn).toBeLessThanOrEqual(32 * 24 * 3600)
  })

  test('the reset is measured in the project\'s own month', () => {
    const mid = new Date('2026-03-15T00:00:00.000Z')

    expect(secondsUntilNextMonth('UTC', mid)).toBeGreaterThan(15 * 24 * 3600)
    expect(secondsUntilNextMonth('UTC', new Date('2026-12-31T00:00:00.000Z'))).toBeLessThanOrEqual(24 * 3600)
  })
})

describe('creation gates', () => {
  test('a free account may create its one project, and not a second', async () => {
    const email = `gate-projects-${stamp}@reportshq.test`
    await db.unsafe(
      `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'free', CURRENT_TIMESTAMP)`,
      ['gate owner', email, 'not-a-real-hash'],
    )
    const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
    const gated = { id: Number(row.id) }

    const first = await createProject(gated, { name: `Gate one ${stamp}` })

    try {
      expect(createProject(gated, { name: `Gate two ${stamp}` })).rejects.toThrow(/covers 1 project/)
    }
    finally {
      await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [first.id])
      await db.unsafe(`DELETE FROM projects WHERE id = $1`, [first.id])
      await db.unsafe(`DELETE FROM users WHERE id = $1`, [gated.id])
    }
  })

  test('the refusal names the tier that would lift it', async () => {
    const email = `gate-message-${stamp}@reportshq.test`
    await db.unsafe(
      `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'free', CURRENT_TIMESTAMP)`,
      ['gate message', email, 'not-a-real-hash'],
    )
    const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
    const gated = { id: Number(row.id) }

    const first = await createProject(gated, { name: `Gate msg ${stamp}` })

    try {
      await createProject(gated, { name: `Gate msg two ${stamp}` })
      throw new Error('expected a refusal')
    }
    catch (error) {
      // "You have reached the Free limit" is a dead end; naming Hobby is a
      // next step, and that difference is the whole point of these messages.
      expect((error as Error).message).toContain('Hobby')
      expect((error as LimitReached).upgradeTo).toBe('hobby')
      expect((error as LimitReached).meter).toBe('projects')
    }
    finally {
      await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [first.id])
      await db.unsafe(`DELETE FROM projects WHERE id = $1`, [first.id])
      await db.unsafe(`DELETE FROM users WHERE id = $1`, [gated.id])
    }
  })

  test('reports are refused at the plan limit, not one report early or late', async () => {
    await db.unsafe(`UPDATE users SET plan = 'free' WHERE id = $1`, [owner.id])

    const allowance = PLANS.free.reports
    const made: number[] = []

    try {
      for (let index = 0; index < allowance; index++)
        made.push(Number((await createReport(projectId, owner, { name: `Gate report ${index} ${stamp}` })).id))

      // The limit-1 case passed above; this is the limit case.
      expect(createReport(projectId, owner, { name: `One too many ${stamp}` })).rejects.toThrow(/covers 5 reports/)
    }
    finally {
      for (const id of made) {
        await db.unsafe(`DELETE FROM report_revisions WHERE report_id = $1`, [id])
        await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1`, [id])
      }
      await db.unsafe(`DELETE FROM reports WHERE project_id = $1`, [projectId])
    }
  })

  test('an auto-created report is never refused by the report limit', async () => {
    // The engine delivering the reports it promised is not somebody choosing
    // to exceed their plan, and refusing there would leave a project with a
    // partial set of auto-reports and no explanation.
    await db.unsafe(`UPDATE users SET plan = 'free' WHERE id = $1`, [owner.id])

    const made: number[] = []
    try {
      for (let index = 0; index < PLANS.free.reports; index++)
        made.push(Number((await createReport(projectId, owner, { name: `Filler ${index} ${stamp}` })).id))

      const auto = await createReport(
        projectId,
        owner,
        { name: `Auto ${stamp}` },
        { origin: 'template', templateKey: 'commerce.overview', templateVersion: 1 },
      )

      expect(auto.id).toBeTruthy()
      made.push(Number(auto.id))
    }
    finally {
      for (const id of made) {
        await db.unsafe(`DELETE FROM report_revisions WHERE report_id = $1`, [id])
        await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1`, [id])
      }
      await db.unsafe(`DELETE FROM reports WHERE project_id = $1`, [projectId])
    }
  })

  test('a refused limit answers 402, not 403', async () => {
    // This is not a permission problem, and a client treating every 403 as
    // "sign in again" would send somebody round a loop that cannot help them.
    const error = new LimitReached('Free covers 1 project.', 'projects', null, 'free', 1, 1, 'hobby')
    const { status, body } = limitResponse(error)

    expect(status).toBe(402)
    expect(body.error).toBe('plan_limit')
    expect(body.upgrade_to).toBe('hobby')
  })

  test('a capability check names the tier that includes it', async () => {
    await db.unsafe(`UPDATE users SET plan = 'free' WHERE id = $1`, [owner.id])

    expect(assertCan(projectId, 'xlsx', 'XLSX export')).rejects.toThrow(/Pro/)
    // And passes where the tier does include it.
    await db.unsafe(`UPDATE users SET plan = 'pro' WHERE id = $1`, [owner.id])
    expect(assertCan(projectId, 'xlsx', 'XLSX export')).resolves.toBeUndefined()
  })
})
