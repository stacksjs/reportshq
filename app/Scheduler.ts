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

  // Dump the database nightly, keeping a week.
  //
  // `buddy deploy` already takes one immediately before it migrates, which
  // covers a migration that did something nobody meant. It does not cover the
  // day nobody deployed, and this is an analytics product: the event stream is
  // the thing customers cannot reconstruct.
  //
  // 02:40 rather than on the hour, and before PruneEvents at 03:20, so a night's
  // dump is taken while the rows retention is about to delete are still there.
  //
  // Deliberately not offsite. It survives a bad migration or a bad query; it
  // does not survive losing the box, and pretending otherwise would be worse
  // than having no backup, because somebody would rely on it.
  schedule
    .command(`bun node_modules/@stacksjs/buddy/dist/cli.js db:backup --out ${process.env.BACKUP_DIR || 'storage/backups/database'} --retain 7`)
    .daily()
    .at('02:40')
    .setTimeZone('UTC')
}

process.on('SIGINT', () => {
  schedule.gracefulShutdown().then(() => process.exit(0))
})
