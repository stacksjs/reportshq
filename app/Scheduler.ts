import process from 'node:process'
import { schedule } from '@stacksjs/scheduler'

/**
 * **Scheduler**
 *
 * Define your scheduled tasks here. Jobs, actions, and shell commands
 * can all be scheduled with a fluent, expressive API.
 *
 * @see https://docs.stacksjs.com/scheduling
 */
export default function () {
  // Keep the daily event rollups current. Every ten minutes rather than
  // hourly because a report opened at :59 should not be reading numbers that
  // stop an hour ago, and a rebuild is one indexed scan per project-day.
  //
  // Ten rather than fifteen because the fluent scheduler has no
  // `everyFifteenMinutes`, despite `Every.FifteenMinutes` existing in the cron
  // enum. Ten is the nearest interval it does offer, and erring shorter is the
  // right direction for data freshness.
  //
  // UTC deliberately: the job rebuilds each project in that project's own
  // timezone, so the schedule itself has no reason to prefer one.
  // Create the reports a project has earned. Scheduled rather than run from
  // the ingest path: ingest is the one request that must stay cheap, and a
  // report appearing a few minutes after the first order reads exactly as well
  // as one appearing 200ms after it.
  schedule
    .job('ProvisionReports')
    .everyTenMinutes()
    .setTimeZone('UTC')

  schedule
    .job('RebuildRollups')
    .everyTenMinutes()
    .setTimeZone('UTC')

  // Run a custom action every five minutes
  // schedule.action('CleanupTempFiles').everyFiveMinutes()

  // Run a shell command daily at midnight
  // schedule.command('echo "Daily maintenance complete"').daily()
}

process.on('SIGINT', () => {
  schedule.gracefulShutdown().then(() => process.exit(0))
})
