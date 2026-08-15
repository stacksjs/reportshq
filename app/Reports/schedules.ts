/**
 * Deciding which scheduled reports are due.
 *
 * The whole difficulty here is that "daily at 8" means eight o'clock where the
 * person is, and the job asking the question runs in UTC. A schedule stored as
 * a UTC hour would drift by an hour twice a year, and the report somebody reads
 * with their morning coffee would start arriving at seven, then at nine, and
 * nobody would file that as a bug because it is not obviously wrong enough.
 *
 * So the hour is stored with its zone and compared in that zone, using the
 * runtime's own timezone database. Nothing here does arithmetic on offsets.
 */
import { db } from '@stacksjs/database'

export type Cadence = 'daily' | 'weekly' | 'monthly'

export interface DueSchedule {
  id: number
  reportId: number
  projectId: number
  reportName: string
  reportSlug: string
  cadence: Cadence
  hour: number
  /** 0 is Sunday. Only read for a weekly cadence. */
  dayOfWeek: number
  /** 1 to 28. Only read for a monthly cadence. */
  dayOfMonth: number
  timezone: string
  recipients: string[]
  format: string
  lastRunAt: string | null
}

/** The wall-clock parts of a moment, in a given zone. */
export function localParts(timezone: string, at: Date): { year: number, month: number, day: number, hour: number, weekday: number } {
  const zone = timezone || 'UTC'

  const read = (options: Intl.DateTimeFormatOptions): string => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).format(at)
    }
    catch {
      // An unknown zone is a data problem, not a reason to stop delivering
      // every other schedule on the instance.
      return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(at)
    }
  }

  const [month, day, year] = read({ year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').map(Number)
  const hour = Number(read({ hour: '2-digit', hour12: false }).replace(/\D/g, ''))
  const weekdayName = read({ weekday: 'short' })

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return {
    year: year ?? 1970,
    month: month ?? 1,
    day: day ?? 1,
    // 24 at midnight in some locales; normalised so a comparison against an
    // hour column cannot silently never match.
    hour: hour === 24 ? 0 : hour,
    weekday: Math.max(0, weekdays.indexOf(weekdayName.slice(0, 3))),
  }
}

/**
 * Was the configured hour skipped entirely by a spring-forward?
 *
 * On the day a clock jumps forward, one local hour does not happen: in New York
 * on 2026-03-08 the time goes 01:59:59 to 03:00:00, and no instant that day has
 * a local hour of 2. A schedule set to 02:00 therefore matched nothing, and its
 * daily report was silently skipped once a year - no error, no retry, just a
 * missing email that arrives again the next morning as though nothing happened.
 *
 * The rule is narrow on purpose. Only the hour immediately after the configured
 * one can stand in for it, and only when the configured hour genuinely did not
 * occur. A blanket "run if we are past the hour" would also fire a newly created
 * 02:00 schedule at four in the afternoon, which is a worse surprise than the
 * problem it fixes.
 */
function skippedBySpringForward(timezone: string, hour: number, at: Date, localHour: number): boolean {
  if (localHour !== (hour + 1) % 24)
    return false

  // If the configured hour did happen, a scan during it was the right moment
  // and this one is simply late.
  return localParts(timezone, new Date(at.getTime() - 3_600_000)).hour !== hour
}

/**
 * Whether a schedule should run now.
 *
 * Two conditions, both necessary. The local hour has to match, and the schedule
 * must not already have run in this period. The second is what makes an hourly
 * scan safe: the job can run as often as it likes and a daily report still
 * arrives once.
 */
export function isDue(schedule: {
  cadence: string
  hour: number
  dayOfWeek?: number
  dayOfMonth?: number
  timezone: string
  lastRunAt: string | null
}, at: Date = new Date()): boolean {
  const local = localParts(schedule.timezone, at)

  if (local.hour !== Number(schedule.hour)
    && !skippedBySpringForward(schedule.timezone, Number(schedule.hour), at, local.hour)) {
    return false
  }

  // The day the schedule asked for, defaulting to Monday and the first of the
  // month. Both are columns on the model, so a weekly report can land on the
  // day its readers actually meet.
  if (schedule.cadence === 'weekly' && local.weekday !== (schedule.dayOfWeek ?? 1))
    return false

  // Capped at 28 when stored, so a monthly schedule cannot pick a day that
  // does not exist in February and silently never run.
  if (schedule.cadence === 'monthly' && local.day !== (schedule.dayOfMonth ?? 1))
    return false

  if (!schedule.lastRunAt)
    return true

  const last = new Date(schedule.lastRunAt)
  if (Number.isNaN(last.getTime()))
    return true

  const lastLocal = localParts(schedule.timezone, last)

  // Same local day means it already went. Comparing dates rather than
  // subtracting hours is what makes this survive daylight saving: on the day a
  // clock goes back, 08:00 happens twice, and "more than 23 hours ago" would
  // send the report a second time.
  if (schedule.cadence === 'daily')
    return !(lastLocal.year === local.year && lastLocal.month === local.month && lastLocal.day === local.day)

  if (schedule.cadence === 'weekly') {
    const days = Math.floor((at.getTime() - last.getTime()) / 86_400_000)
    return days >= 6
  }

  return !(lastLocal.year === local.year && lastLocal.month === local.month)
}

/** Every active schedule, with what delivery needs. */
export async function activeSchedules(): Promise<DueSchedule[]> {
  const rows = await db.unsafe(
    `SELECT s.id AS id, s.report_id AS report_id, s.cadence AS cadence, s.hour AS hour,
            s.day_of_week AS day_of_week, s.day_of_month AS day_of_month,
            s.timezone AS timezone, s.recipients AS recipients, s.format AS format,
            s.last_run_at AS last_run_at,
            r.name AS report_name, r.slug AS report_slug, r.project_id AS project_id
       FROM report_schedules s
       JOIN reports r ON r.id = s.report_id
      WHERE s.is_active = TRUE
        AND r.deleted_at IS NULL
        AND r.status = 'published'`,
  ) as Array<Record<string, unknown>>

  return rows.map(row => ({
    id: Number(row.id),
    reportId: Number(row.report_id),
    projectId: Number(row.project_id),
    reportName: String(row.report_name ?? ''),
    reportSlug: String(row.report_slug ?? ''),
    cadence: String(row.cadence ?? 'daily') as Cadence,
    hour: Number(row.hour ?? 8),
    dayOfWeek: row.day_of_week === null || row.day_of_week === undefined ? 1 : Number(row.day_of_week),
    dayOfMonth: row.day_of_month === null || row.day_of_month === undefined ? 1 : Number(row.day_of_month),
    timezone: String(row.timezone ?? 'UTC'),
    recipients: parseRecipients(row.recipients),
    format: String(row.format ?? 'summary'),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
  }))
}

/**
 * Recipients, however they were stored.
 *
 * A JSON array is the intended shape, but a comma-separated string is what a
 * form posts when nobody was looking, and refusing to deliver a report because
 * of that would be a poor trade.
 */
export function parseRecipients(value: unknown): string[] {
  // Only things that look like addresses. A stray fragment that survives here
  // is handed to a mail server as a recipient, and a schedule that fails on
  // every run because of one bad entry delivers nothing to the good ones.
  const addresses = (entries: unknown[]): string[] =>
    entries.map(entry => String(entry).trim()).filter(entry => entry.includes('@'))

  if (Array.isArray(value))
    return addresses(value)

  const text = String(value ?? '').trim()
  if (!text)
    return []

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? addresses(parsed) : []
    }
    catch {
      return []
    }
  }

  return addresses(text.split(','))
}

/** Schedules due right now. */
export async function dueSchedules(at: Date = new Date()): Promise<DueSchedule[]> {
  return (await activeSchedules()).filter(schedule => isDue(schedule, at))
}

/** Record the outcome, on the schedule itself rather than in a log nobody reads. */
export async function recordRun(scheduleId: number, status: string, at: Date = new Date()): Promise<void> {
  await db.unsafe(
    `UPDATE report_schedules SET last_run_at = $1, last_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
    [at.toISOString(), status.slice(0, 200), scheduleId],
  )
}

/**
 * The addresses a project may send a report to.
 *
 * Membership, and nothing else. A scheduled report is us sending mail to an
 * arbitrary address on somebody's instruction, which is the definition of an
 * open relay if the address is unconstrained: anyone with a free account could
 * point a daily schedule at a stranger and have our server deliver it, with our
 * domain's reputation behind it.
 *
 * Members are already people who can open the report in the app, so mailing it
 * to them tells them nothing they could not already read.
 */
export async function allowedRecipients(projectId: number): Promise<Set<string>> {
  const rows = await db.unsafe(
    `SELECT u.email AS email
       FROM projects p JOIN users u ON u.id = p.owner_id
      WHERE p.id = $1
      UNION
     SELECT m.email AS email
       FROM project_members m
      WHERE m.project_id = $1`,
    [projectId],
  ) as Array<{ email: string }>

  return new Set(rows.map(row => String(row.email ?? '').trim().toLowerCase()).filter(Boolean))
}

/**
 * Refuse a recipient list containing anybody who is not on the project.
 *
 * Names the addresses it refused. "Some recipients are not allowed" leaves
 * somebody guessing which of six addresses to remove.
 */
export async function assertRecipientsAllowed(projectId: number, recipients: string[]): Promise<void> {
  if (recipients.length === 0)
    throw new Error('A schedule needs at least one recipient.')

  const allowed = await allowedRecipients(projectId)
  const strangers = recipients.filter(address => !allowed.has(address.trim().toLowerCase()))

  if (strangers.length > 0) {
    throw new Error(
      `Only people on this project can receive it. Invite them first, or remove ${strangers.join(', ')}.`,
    )
  }
}
