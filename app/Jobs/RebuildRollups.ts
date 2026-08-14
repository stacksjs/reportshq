import { db } from '@stacksjs/database'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { rebuildProject } from '../Reports/rollup'

/**
 * Keeps the daily pre-aggregate current.
 *
 * Rebuilds a trailing window per project rather than tracking which days
 * changed. Two reasons, and both are about the data rather than the code being
 * simpler:
 *
 * Events arrive late. An SDK buffers, a mobile client reconnects after a day
 * offline, and a backfill can land events up to 30 days back. A dirty-day
 * ledger would have to be written on the ingest path, which is the one path
 * that must stay cheap, and it would still be wrong for anything that arrived
 * while the ledger was being read.
 *
 * And a rebuild is idempotent and cheap: it is one grouped scan per project-day
 * over an indexed range. Recomputing three days every ten minutes costs
 * less than the bookkeeping to avoid it.
 *
 * Older days are not rebuilt here. A backfill that lands events further back
 * calls `rebuildProject` directly with a wider window, and so does a project
 * whose timezone changed, since `day` is a project-local date and every
 * existing row is bucketed against the old zone.
 */
const WINDOW_DAYS = 3

export default new Job({
  name: 'RebuildRollups',
  description: 'Recompute the daily event rollups for recently active projects',
  queue: 'default',
  tries: 2,
  backoff: 30,
  rate: Every.TenMinutes,

  handle: async () => {
    // Only projects that have seen an event: a rollup for a project with no
    // data is a scan that can only ever produce nothing.
    const projects = await db.unsafe(
      `SELECT id, timezone FROM projects
        WHERE deleted_at IS NULL AND first_event_at IS NOT NULL`,
    ) as Array<{ id: number, timezone: string | null }>

    let rebuilt = 0
    let failed = 0

    for (const project of projects) {
      try {
        rebuilt += await rebuildProject(Number(project.id), WINDOW_DAYS, project.timezone ?? 'UTC')
      }
      catch (error) {
        // One project's failure must not stop the rest: a single corrupt row
        // would otherwise freeze every other tenant's reports at whatever the
        // rollups last said, which is stale data presented as current.
        failed++
        console.error(`[rollups] project ${project.id} failed:`, (error as Error).message)
      }
    }

    console.log(`[rollups] rebuilt ${rebuilt} rows across ${projects.length - failed} projects${failed > 0 ? `, ${failed} failed` : ''}`)
  },
})
