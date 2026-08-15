import { db } from '@stacksjs/database'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { planFor } from '../Billing/limits'

/**
 * Deleting raw events past their plan's retention window.
 *
 * Rollups are deliberately left alone. A report over a range older than the
 * retention window still shows correct totals, because the daily aggregates
 * outlive the rows they were built from; what goes away is the ability to drill
 * into individual events. That is the promise made in docs/limits.md, and it is
 * the difference between "your old data is summarised" and "your old data is
 * gone", which are very different things to tell a customer.
 *
 * Deleted in batches, and counted. A single unbounded DELETE over a busy
 * project would hold a write lock long enough to make ingest time out, and this
 * job exists to save space rather than to cause an outage.
 *
 * A downgrade prunes on the next run rather than immediately, which is what the
 * downgrade warning in the interface promises.
 */

/** Rows removed per statement. Small enough not to hold a lock, large enough to finish. */
export const BATCH = 5000

/** Most batches per project per run, so one enormous project cannot starve the rest. */
export const MAX_BATCHES = 40

export interface PruneResult {
  projectId: number
  tier: string
  retentionDays: number
  deleted: number
  /** True when the cap was hit and rows remain for the next run. */
  more: boolean
}

/**
 * Prune one project.
 *
 * `dryRun` counts without deleting, which is how this gets verified against
 * real data before it is trusted with it.
 */
export async function pruneProject(
  projectId: number,
  tier: string,
  options: { dryRun?: boolean, now?: Date } = {},
): Promise<PruneResult> {
  const plan = planFor(tier)
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - plan.retentionDays * 86_400_000).toISOString()

  if (options.dryRun) {
    const rows = await db.unsafe(
      `SELECT COUNT(*) AS n FROM events WHERE project_id = $1 AND occurred_at < $2`,
      [projectId, cutoff],
    ) as Array<{ n: number }>

    return {
      projectId,
      tier: plan.tier,
      retentionDays: plan.retentionDays,
      deleted: Number(rows[0]?.n ?? 0),
      more: false,
    }
  }

  let deleted = 0
  let batches = 0

  while (batches < MAX_BATCHES) {
    // Bounded by id rather than by a LIMIT on the DELETE, which SQLite only
    // supports when compiled for it. Selecting the ids first is portable and
    // keeps each statement short.
    const doomed = await db.unsafe(
      `SELECT id FROM events WHERE project_id = $1 AND occurred_at < $2 LIMIT $3`,
      [projectId, cutoff, BATCH],
    ) as Array<{ id: number }>

    if (doomed.length === 0)
      break

    await db.unsafe(
      `DELETE FROM events WHERE id IN (${doomed.map((_, index) => `$${index + 1}`).join(', ')})`,
      doomed.map(row => row.id),
    )

    deleted += doomed.length
    batches++

    if (doomed.length < BATCH)
      break
  }

  return {
    projectId,
    tier: plan.tier,
    retentionDays: plan.retentionDays,
    deleted,
    more: batches >= MAX_BATCHES,
  }
}

/** Every project with its owner's tier, so each is pruned to its own window. */
export async function projectsToPrune(): Promise<Array<{ id: number, tier: string }>> {
  const rows = await db.unsafe(
    // Soft-deleted projects are included on purpose: a project somebody removed
    // is exactly the one whose events nobody needs any more.
    `SELECT p.id AS id, u.plan AS plan
       FROM projects p JOIN users u ON u.id = p.owner_id`,
  ) as Array<{ id: number, plan: string }>

  return rows.map(row => ({ id: Number(row.id), tier: String(row.plan ?? 'free') }))
}

export default new Job({
  name: 'PruneEvents',
  description: 'Delete raw events past their plan retention window',
  queue: 'default',
  tries: 1,
  // Daily, in the quiet hours. Retention is measured in days, so running more
  // often would delete the same rows a few hours earlier at the cost of a scan
  // per project per run.
  rate: Every.Day,

  handle: async () => {
    const projects = await projectsToPrune()
    let total = 0

    for (const project of projects) {
      try {
        const result = await pruneProject(project.id, project.tier)
        total += result.deleted

        // Logged per project, because "we deleted 4 million rows" with no
        // breakdown is not something anybody can check.
        if (result.deleted > 0)
          console.log(`[prune] project ${project.id} (${result.tier}, ${result.retentionDays}d): ${result.deleted} events${result.more ? ', more remain' : ''}`)
      }
      catch (error) {
        // One project's failure must not stop the rest, or a single bad row
        // would stop retention running for every other tenant.
        console.error(`[prune] project ${project.id} failed:`, (error as Error).message)
      }
    }

    if (total > 0)
      console.log(`[prune] ${total} events removed`)

    // Generated export files expire with their download links. Keeping them
    // past the life of the only URL that reaches them would be storing
    // somebody's numbers for no reason anybody could state.
    const { pruneExports } = await import('../Reports/export-store')
    const exports = await pruneExports()

    if (exports > 0)
      console.log(`[prune] ${exports} expired export${exports === 1 ? '' : 's'} removed`)
  },
})
