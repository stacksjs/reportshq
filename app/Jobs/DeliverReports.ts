import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { can } from '../Billing/limits'
import { db } from '@stacksjs/database'
import { exportCsv, exportFilename, exportXlsx } from '../Reports/exports'
import { dueSchedules, recordRun } from '../Reports/schedules'
import { sendReportDelivery } from '../Mail/ReportDelivery'

/**
 * Sending the reports that are due.
 *
 * Hourly, because a schedule's finest granularity is an hour and every schedule
 * is compared in its own timezone. Running more often would find the same
 * schedules and skip them; running less often would miss an hour somewhere in
 * the world.
 *
 * `last_run_at` is what makes a re-run safe. A schedule that already went today
 * is not due again today, so the job can be retried, run twice by accident, or
 * catch up after an outage without anybody receiving the same report twice.
 */

/** The range a cadence reports on. */
export function rangeFor(cadence: string): { range: string, period: string } {
  switch (cadence) {
    case 'weekly':
      return { range: 'last_7_days', period: 'Last 7 days' }
    case 'monthly':
      return { range: 'last_30_days', period: 'Last 30 days' }
    default:
      return { range: 'last_7_days', period: 'Last 7 days' }
  }
}

/** Deliver one schedule. Returns the status recorded against it. */
export async function deliverSchedule(schedule: Awaited<ReturnType<typeof dueSchedules>>[number], at: Date = new Date()): Promise<string> {
  if (schedule.recipients.length === 0)
    return 'no recipients'

  const rows = await db.unsafe(
    `SELECT u.plan AS plan FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [schedule.projectId],
  ) as Array<{ plan: string }>

  const tier = String(rows[0]?.plan ?? 'free')

  // Gated, and soft. A plan that lost its schedules stops sending rather than
  // erroring: the row stays, says why, and starts again if the plan comes back.
  if (!can(tier, 'schedules'))
    return 'not available on this plan'

  const { range, period } = rangeFor(schedule.cadence)
  const attachments: Array<{ filename: string, content: Uint8Array | string, contentType?: string }> = []

  if (schedule.format === 'csv' || schedule.format === 'xlsx') {
    // XLSX is its own tier. Asking for it on a plan without it delivers the
    // report as CSV rather than refusing to deliver at all.
    const wantsXlsx = schedule.format === 'xlsx' && can(tier, 'xlsx')
    const options = {
      projectId: schedule.projectId,
      reportId: schedule.reportId,
      timezone: schedule.timezone,
      range,
    }

    attachments.push(wantsXlsx
      ? {
          filename: exportFilename(schedule.reportName, 'xlsx', at),
          content: await exportXlsx(options),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
      : {
          filename: exportFilename(schedule.reportName, 'csv', at),
          content: await exportCsv(options),
          contentType: 'text/csv',
        })
  }

  await sendReportDelivery({
    to: schedule.recipients,
    projectId: schedule.projectId,
    reportId: schedule.reportId,
    reportName: schedule.reportName,
    reportUrl: `https://reportshq.org/report?project=${schedule.projectId}&slug=${encodeURIComponent(schedule.reportSlug)}`,
    timezone: schedule.timezone,
    range,
    period,
    attachments: attachments.length > 0 ? attachments : undefined,
  })

  return 'sent'
}

export default new Job({
  name: 'DeliverReports',
  description: 'Email the scheduled reports that are due',
  queue: 'default',
  tries: 1,
  rate: Every.Hour,

  handle: async () => {
    const due = await dueSchedules()
    let sent = 0

    for (const schedule of due) {
      try {
        const status = await deliverSchedule(schedule)
        // Recorded whatever happened, including a refusal, so the row explains
        // itself without anybody reading a log.
        await recordRun(schedule.id, status)
        if (status === 'sent')
          sent++
      }
      catch (error) {
        // One schedule's failure must not stop the rest. Recorded on the row
        // so somebody can see why their report did not arrive.
        await recordRun(schedule.id, `failed: ${(error as Error).message}`.slice(0, 200))
        console.error(`[schedules] ${schedule.id} failed:`, (error as Error).message)
      }
    }

    if (sent > 0)
      console.log(`[schedules] delivered ${sent} report${sent === 1 ? '' : 's'}`)
  },
})
