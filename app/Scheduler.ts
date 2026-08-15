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

  // Email the scheduled reports that are due. Hourly, because a schedule's
  // finest granularity is an hour and each is compared in its own timezone;
  // last_run_at is what keeps a re-run from sending twice.
  schedule
    .job('DeliverReports')
    .hourly()
    .setTimeZone('UTC')

  // Tell people about their quota while they can still act on it. Hourly: a
  // warning is useful within the hour and pointless within the minute, and it
  // reads every counter each run.
  schedule
    .job('QuotaNotices')
    .hourly()
    .setTimeZone('UTC')

  // Delete raw events past their plan's retention window. Daily and in the
  // quiet hours: retention is measured in days, so running more often would
  // remove the same rows a few hours earlier at the cost of a scan per project
  // per run. Rollups are left alone, so old ranges still total correctly.
  schedule
    .job('PruneEvents')
    .daily()
    .at('03:20')
    .setTimeZone('UTC')

  // Run a custom action every five minutes
  // schedule.action('CleanupTempFiles').everyFiveMinutes()

  // Run a shell command daily at midnight
  // schedule.command('echo "Daily maintenance complete"').daily()
}

process.on('SIGINT', () => {
  schedule.gracefulShutdown().then(() => process.exit(0))
})
