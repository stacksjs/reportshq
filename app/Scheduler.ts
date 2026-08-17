import type { Schedule } from '@stacksjs/scheduler'

/**
 * Scheduled work.
 *
 * Empty, and that is the point. Every job that used to run here belonged to
 * the hosted pipeline: rolling up events, provisioning reports from templates,
 * pruning past a retention window, mailing schedules, counting usage against a
 * quota. None of it exists now, because the reports run inside the customer's
 * own application and its own scheduler runs `reportshq:send`.
 *
 * What is left on this side is an account and a licence, and neither needs a
 * cron.
 */
export default function (schedule: Schedule): void {
  // Nothing to schedule.
  void schedule
}
