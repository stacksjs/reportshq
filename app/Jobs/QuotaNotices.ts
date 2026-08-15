import { db } from '@stacksjs/database'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { allowanceFor, planFor } from '../Billing/limits'
import { markNotified, monthKey } from '../Billing/usage'
import { sendQuotaWarning } from '../Mail/QuotaWarning'

/**
 * Telling somebody about their quota while they can still do something.
 *
 * Scheduled rather than sent from the ingest path. Ingest is the one request
 * that must stay cheap, and an email is a network call to a mail server: a
 * customer's write should never wait on our ability to send them a warning
 * about it.
 *
 * Two thresholds, each sent at most once per project per month. The counter
 * enforces that rather than this job: `notified_at_percent` only ever moves up,
 * so an account hovering around 80% gets one email rather than one per run.
 * A nag storm is how somebody learns to filter us into a folder they never
 * open, which is exactly where the message about their data stopping should
 * not be.
 */

/** The thresholds worth an email, highest first so the more urgent one wins. */
export const THRESHOLDS = [100, 80]

export interface NoticeCandidate {
  projectId: number
  projectName: string
  timezone: string
  ownerEmail: string
  tier: string
  used: number
  notifiedAtPercent: number
}

/**
 * Projects that have used enough of their quota to be worth telling.
 *
 * One query rather than one per project: this runs over every tenant, and a
 * per-project round trip would make the job's cost scale with the customer
 * list rather than with the number of people who need an email.
 */
export async function noticeCandidates(at: Date = new Date()): Promise<NoticeCandidate[]> {
  const rows = await db.unsafe(
    `SELECT p.id AS project_id, p.name AS project_name, p.timezone AS timezone,
            u.email AS owner_email, u.plan AS plan,
            c.events AS events, c.month AS month, c.notified_at_percent AS notified
       FROM usage_counters c
       JOIN projects p ON p.id = c.project_id
       JOIN users u ON u.id = p.owner_id
      WHERE p.deleted_at IS NULL AND c.events > 0`,
  ) as Array<{
    project_id: number
    project_name: string
    timezone: string
    owner_email: string
    plan: string
    events: number
    month: string
    notified: number
  }>

  const candidates: NoticeCandidate[] = []

  for (const row of rows) {
    const timezone = String(row.timezone ?? 'UTC')

    // Only the month currently running. A counter from March is history, and
    // emailing somebody in June about it would be baffling.
    if (String(row.month) !== monthKey(timezone, at))
      continue

    candidates.push({
      projectId: Number(row.project_id),
      projectName: String(row.project_name),
      timezone,
      ownerEmail: String(row.owner_email ?? ''),
      tier: planFor(row.plan).tier,
      used: Number(row.events ?? 0),
      notifiedAtPercent: Number(row.notified ?? 0),
    })
  }

  return candidates
}

/**
 * The threshold this project has crossed and not yet been told about, if any.
 *
 * Returns the highest crossed threshold, so a project that jumps from 40% to
 * 105% in one batch gets the "you have used it" email rather than the "you are
 * approaching it" one. Sending both, or sending the wrong one, would be worse
 * than sending nothing.
 */
export function thresholdFor(candidate: NoticeCandidate): number | null {
  const allowance = allowanceFor(candidate.tier, 'events')
  if (allowance <= 0)
    return null

  const percent = (candidate.used / allowance) * 100

  for (const threshold of THRESHOLDS) {
    if (percent >= threshold && candidate.notifiedAtPercent < threshold)
      return threshold
  }

  return null
}

/** Send the notices that are due. Returns how many went. */
export async function sendDueNotices(at: Date = new Date()): Promise<number> {
  const candidates = await noticeCandidates(at)
  let sent = 0

  for (const candidate of candidates) {
    const threshold = thresholdFor(candidate)
    if (threshold === null || !candidate.ownerEmail)
      continue

    try {
      await sendQuotaWarning({
        to: candidate.ownerEmail,
        projectName: candidate.projectName,
        projectUrl: `https://reportshq.org/project?id=${candidate.projectId}`,
        tier: candidate.tier,
        used: candidate.used,
        percent: threshold,
      })

      // Marked after the send, not before. Marking first would lose the email
      // on any failure and never try again, which for the 100% notice means
      // somebody's collection stops with no warning at all.
      await markNotified(candidate.projectId, candidate.timezone, threshold, at)
      sent++
    }
    catch (error) {
      // One project's failure must not stop the rest. Not marked, so the next
      // run tries again.
      console.error(`[quota] project ${candidate.projectId} notice failed:`, (error as Error).message)
    }
  }

  return sent
}

export default new Job({
  name: 'QuotaNotices',
  description: 'Email projects approaching or past their monthly event quota',
  queue: 'default',
  tries: 1,
  // Hourly. A quota warning is useful within the hour and pointless within the
  // minute, and this reads every counter each time it runs.
  rate: Every.Hour,

  handle: async () => {
    const sent = await sendDueNotices()

    if (sent > 0)
      console.log(`[quota] sent ${sent} notice${sent === 1 ? '' : 's'}`)
  },
})
