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
