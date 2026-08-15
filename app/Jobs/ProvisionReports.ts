import { db } from '@stacksjs/database'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { provisionTemplates } from '../Reports/templates'

/**
 * Creates the reports a project has earned.
 *
 * Runs on a schedule rather than from the ingest path, deliberately. Ingest is
 * the one request that must stay cheap, and provisioning reads every distinct
 * event name in a project and then writes a report with a dozen blocks; doing
 * that inside a batch would make the first event of a busy morning the slowest.
 *
 * The delay this introduces is the right trade: a report that appears within a
 * few minutes of the first order reads as magic, and one that appears 200ms
 * later reads exactly the same.
 *
 * Provisioning is idempotent and permanent, so running this more often than
 * necessary costs two queries per project and changes nothing.
 */
export default new Job({
  name: 'ProvisionReports',
  description: 'Create auto-generated reports for projects whose events now qualify',
  queue: 'default',
  tries: 2,
  backoff: 30,
  rate: Every.TenMinutes,

  handle: async () => {
    // Only projects that have received something. A project with no events can
    // never qualify, and scanning them is pure cost.
    const projects = await db.unsafe(
      `SELECT id, owner_id FROM projects
        WHERE deleted_at IS NULL AND first_event_at IS NOT NULL AND auto_reports_enabled = 1`,
    ) as Array<{ id: number, owner_id: number }>

    let created = 0
    let upgraded = 0

    for (const project of projects) {
      try {
        const result = await provisionTemplates(Number(project.id), { id: Number(project.owner_id) })
        created += result.created.length
        upgraded += result.upgraded.length

        if (result.created.length > 0)
          console.log(`[templates] project ${project.id}: created ${result.created.join(', ')}`)

        // Logged separately from creation because it is the riskier half: this
        // is the engine rewriting a report that already existed, and if it ever
        // does that to one somebody had arranged, this line is the evidence.
        if (result.upgraded.length > 0)
          console.log(`[templates] project ${project.id}: upgraded ${result.upgraded.join(', ')}`)
      }
      catch (error) {
        // One project's failure must not stop the rest, or a single malformed
        // event name would freeze auto-reports for every other tenant.
        console.error(`[templates] project ${project.id} failed:`, (error as Error).message)
      }
    }

    if (created > 0)
      console.log(`[templates] created ${created} report${created === 1 ? '' : 's'}`)

    if (upgraded > 0)
      console.log(`[templates] upgraded ${upgraded} report${upgraded === 1 ? '' : 's'}`)
  },
})
