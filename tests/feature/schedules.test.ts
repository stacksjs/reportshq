/**
 * Scheduled delivery and exports.
 *
 * The scheduling half is almost entirely about timezones, because that is where
 * it goes wrong in ways nobody reports: a report that starts arriving an hour
 * early after a clock change is annoying rather than obviously broken, so it
 * gets tolerated instead of fixed.
 *
 * The export half asserts the file parses back to the numbers that went in.
 * A spreadsheet that opens is not the same as a spreadsheet that is right.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { rangeFor } from '../../app/Jobs/DeliverReports'
import { storeEvents } from '../../app/Events/ingest'
import { exportsFor, generateExport, pruneExports, resolveExport, signExport } from '../../app/Reports/export-store'
import { EXPORT_HEADINGS, exportContent, exportCsv, exportFilename, exportXlsx } from '../../app/Reports/exports'
import { addBlock, createReport, publishReport } from '../../app/Reports/reports'
import { activeSchedules, allowedRecipients, assertRecipientsAllowed, isDue, localParts, parseRecipients, recordRun } from '../../app/Reports/schedules'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number
let reportId: number

const yesterday = new Date(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) + 'T12:00:00.000Z').toISOString()

beforeAll(async () => {
  const email = `schedules-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'pro', CURRENT_TIMESTAMP)`,
    ['schedules owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }

  projectId = Number((await createProject(owner, { name: `Schedules ${stamp}`, timezone: 'UTC' })).id)

  await storeEvents(projectId, [
    { name: 'commerce.order.created', occurred_at: yesterday, value: 40, user_key: 'a' },
    { name: 'commerce.order.created', occurred_at: yesterday, value: 60, user_key: 'b' },
  ])

  reportId = Number((await createReport(projectId, owner, { name: `Exportable ${stamp}` })).id)

  await addBlock(reportId, {
    kind: 'big_number',
    title: 'Revenue',
    layout: { x: 0, y: 0, w: 3, h: 3 },
    query: { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [] },
  })
  await addBlock(reportId, {
    kind: 'line',
    title: 'Orders per day',
    layout: { x: 0, y: 3, w: 8, h: 5 },
    query: { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day' },
  })
  await addBlock(reportId, {
    kind: 'text',
    layout: { x: 0, y: 8, w: 12, h: 1 },
    body: 'A note, which has no numbers in it.',
  })

  await publishReport(reportId, owner)
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM report_schedules WHERE report_id = $1`, [reportId])
  await db.unsafe(`DELETE FROM report_revisions WHERE report_id = $1`, [reportId])
  await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1`, [reportId])
  await db.unsafe(`DELETE FROM reports WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

describe('reading the clock in the right place', () => {
  test('the hour is the local hour, not the server\'s', () => {
    // 22:00 UTC is 15:00 in Los Angeles and 08:00 the next morning in Sydney.
    const moment = new Date('2026-03-10T22:00:00.000Z')

    expect(localParts('UTC', moment).hour).toBe(22)
    expect(localParts('America/Los_Angeles', moment).hour).toBe(15)
    expect(localParts('Australia/Sydney', moment).hour).toBe(9)
  })

  test('an unknown zone falls back rather than stopping every other schedule', () => {
    expect(localParts('Not/AZone', new Date('2026-03-10T22:00:00.000Z')).hour).toBe(22)
  })
})

describe('when a schedule is due', () => {
  const daily = { cadence: 'daily', hour: 8, timezone: 'America/New_York', lastRunAt: null }

  test('due at its own local hour, and not an hour either side', () => {
    // 13:00 UTC is 08:00 in New York during daylight time.
    expect(isDue(daily, new Date('2026-07-01T12:00:00.000Z'))).toBeTrue()
    expect(isDue(daily, new Date('2026-07-01T11:00:00.000Z'))).toBeFalse()
    expect(isDue(daily, new Date('2026-07-01T13:00:00.000Z'))).toBeFalse()
  })

  test('the same local hour still works after the clocks change', () => {
    // New York is UTC-4 in July and UTC-5 in January. A schedule stored as a
    // UTC hour would arrive at seven in the morning half the year, which is the
    // sort of drift nobody files a bug about.
    expect(isDue(daily, new Date('2026-01-15T13:00:00.000Z'))).toBeTrue()
    expect(isDue(daily, new Date('2026-01-15T12:00:00.000Z'))).toBeFalse()
  })

  test('a schedule that already ran today is not due again', () => {
    const ran = { ...daily, lastRunAt: '2026-07-01T12:00:00.000Z' }

    expect(isDue(ran, new Date('2026-07-01T12:00:00.000Z'))).toBeFalse()
    // The next day it is.
    expect(isDue(ran, new Date('2026-07-02T12:00:00.000Z'))).toBeTrue()
  })

  test('an hour that happens twice does not send twice', () => {
    // The clocks go back in New York on 1 November 2026: 01:00 local happens at
    // both 05:00 and 06:00 UTC. Comparing local dates rather than subtracting
    // hours is what makes this safe.
    const overnight = { cadence: 'daily', hour: 1, timezone: 'America/New_York', lastRunAt: '2026-11-01T05:30:00.000Z' }

    expect(isDue(overnight, new Date('2026-11-01T06:30:00.000Z'))).toBeFalse()
  })

  test('weekly lands on the day it asked for', () => {
    const weekly = { cadence: 'weekly', hour: 9, dayOfWeek: 1, timezone: 'UTC', lastRunAt: null }

    // 2026-08-17 is a Monday, 2026-08-18 a Tuesday.
    expect(isDue(weekly, new Date('2026-08-17T09:00:00.000Z'))).toBeTrue()
    expect(isDue(weekly, new Date('2026-08-18T09:00:00.000Z'))).toBeFalse()
  })

  test('weekly can be set to another day', () => {
    const friday = { cadence: 'weekly', hour: 9, dayOfWeek: 5, timezone: 'UTC', lastRunAt: null }

    expect(isDue(friday, new Date('2026-08-21T09:00:00.000Z'))).toBeTrue()
    expect(isDue(friday, new Date('2026-08-17T09:00:00.000Z'))).toBeFalse()
  })

  test('monthly lands on its day and not again that month', () => {
    const monthly = { cadence: 'monthly', hour: 7, dayOfMonth: 1, timezone: 'UTC', lastRunAt: null }

    expect(isDue(monthly, new Date('2026-09-01T07:00:00.000Z'))).toBeTrue()
    expect(isDue(monthly, new Date('2026-09-02T07:00:00.000Z'))).toBeFalse()

    const ran = { ...monthly, lastRunAt: '2026-09-01T07:00:00.000Z' }
    expect(isDue(ran, new Date('2026-09-01T07:00:00.000Z'))).toBeFalse()
    expect(isDue(ran, new Date('2026-10-01T07:00:00.000Z'))).toBeTrue()
  })

  test('an unparseable last run is treated as never run', () => {
    // Better to send one report twice than to stop sending it forever because
    // a timestamp was written badly once.
    expect(isDue({ ...daily, lastRunAt: 'not a date' }, new Date('2026-07-01T12:00:00.000Z'))).toBeTrue()
  })
})

describe('recipients', () => {
  test('a JSON array is the intended shape', () => {
    expect(parseRecipients('["a@example.com","b@example.com"]')).toEqual(['a@example.com', 'b@example.com'])
  })

  test('a comma-separated string still works', () => {
    // What a form posts when nobody was looking. Refusing to deliver over that
    // would be a poor trade.
    expect(parseRecipients('a@example.com, b@example.com')).toEqual(['a@example.com', 'b@example.com'])
  })

  test('nothing is an empty list rather than a crash', () => {
    expect(parseRecipients(null)).toEqual([])
    expect(parseRecipients('')).toEqual([])
  })

  test('anything that is not an address is dropped', () => {
    // A recipient list is a list of addresses. Letting a stray fragment through
    // means handing it to a mail server as a recipient.
    expect(parseRecipients('{not json')).toEqual([])
    expect(parseRecipients('a@example.com, nonsense, b@example.com')).toEqual(['a@example.com', 'b@example.com'])
  })
})

describe('the schedule list', () => {
  let scheduleId: number

  beforeAll(async () => {
    await db.unsafe(
      `INSERT INTO report_schedules (report_id, cadence, hour, timezone, recipients, format, is_active, created_by_id, created_at)
       VALUES ($1, 'daily', 8, 'UTC', $2, 'link', TRUE, $3, CURRENT_TIMESTAMP)`,
      [reportId, JSON.stringify(['reader@example.com']), owner.id],
    )
    const row = (await db.unsafe(`SELECT id FROM report_schedules WHERE report_id = $1`, [reportId]))?.[0] as { id: number }
    scheduleId = Number(row.id)
  })

  test('an active schedule on a published report is listed', async () => {
    const listed = (await activeSchedules()).find(entry => entry.id === scheduleId)

    expect(listed).toBeDefined()
    expect(listed!.recipients).toEqual(['reader@example.com'])
    expect(listed!.reportName).toContain('Exportable')
  })

  test('pausing removes it from the list', async () => {
    await db.unsafe(`UPDATE report_schedules SET is_active = FALSE WHERE id = $1`, [scheduleId])
    expect((await activeSchedules()).map(entry => entry.id)).not.toContain(scheduleId)

    await db.unsafe(`UPDATE report_schedules SET is_active = TRUE WHERE id = $1`, [scheduleId])
  })

  test('unpublishing the report removes it too', async () => {
    // A schedule on a report nobody can see would email numbers from a draft.
    await db.unsafe(`UPDATE reports SET status = 'draft' WHERE id = $1`, [reportId])
    expect((await activeSchedules()).map(entry => entry.id)).not.toContain(scheduleId)

    await db.unsafe(`UPDATE reports SET status = 'published' WHERE id = $1`, [reportId])
  })

  test('the outcome is recorded on the row, including a refusal', async () => {
    await recordRun(scheduleId, 'not available on this plan')

    const row = (await db.unsafe(`SELECT last_status, last_run_at FROM report_schedules WHERE id = $1`, [scheduleId]))?.[0] as { last_status: string, last_run_at: string }

    // So somebody can see why their report did not arrive without reading a log.
    expect(row.last_status).toContain('not available')
    expect(row.last_run_at).toBeTruthy()

    await db.unsafe(`UPDATE report_schedules SET last_run_at = NULL, last_status = NULL WHERE id = $1`, [scheduleId])
  })
})

describe('the range a cadence reports on', () => {
  test('each cadence has a period and a label', () => {
    expect(rangeFor('weekly').range).toBe('last_7_days')
    expect(rangeFor('monthly').range).toBe('last_30_days')
    expect(rangeFor('daily').period).toContain('days')
  })
})

describe('exports', () => {
  const options = () => ({ projectId, reportId, timezone: 'UTC', range: 'last_7_days' })

  test('the sheet has the long-format headings', async () => {
    const content = await exportContent(options())
    expect(content.headings).toEqual(EXPORT_HEADINGS)
  })

  test('the numbers match what the engine returns', async () => {
    const content = await exportContent(options())

    // The seeded events total 100, which is what the viewer shows.
    const revenue = content.data.filter(row => row[0] === 'Revenue')
    expect(revenue.length).toBeGreaterThan(0)
    expect(revenue.reduce((sum, row) => sum + Number(row[3]), 0)).toBe(100)
  })

  test('a note contributes no rows', async () => {
    // Its prose in a column of values would break every formula somebody wrote
    // against the sheet.
    const content = await exportContent(options())
    expect(content.data.some(row => String(row[0]).includes('note'))).toBeFalse()
  })

  test('a time series exports one row per bucket', async () => {
    const content = await exportContent(options())
    const series = content.data.filter(row => row[0] === 'Orders per day')

    expect(series.length).toBeGreaterThan(1)
    expect(String(series[0]![1])).toContain('T')
  })

  test('the CSV parses back to the same numbers', async () => {
    const csv = await exportCsv(options())
    const lines = csv.trim().split('\n')

    expect(lines[0]).toContain('Block')

    const total = lines.slice(1)
      .filter(line => line.startsWith('Revenue'))
      .reduce((sum, line) => sum + Number(line.split(',').pop()), 0)

    expect(total).toBe(100)
  })

  test('the xlsx is a real workbook', async () => {
    const xlsx = await exportXlsx(options())

    expect(xlsx.byteLength).toBeGreaterThan(100)
    // A xlsx is a zip, and every zip starts PK. A file that opens is not the
    // same as a file that is right, but a file that does not open is certainly
    // wrong.
    expect(xlsx[0]).toBe(0x50)
    expect(xlsx[1]).toBe(0x4B)
  })

  test('the filename says what and when', () => {
    const name = exportFilename('Revenue overview', 'xlsx', new Date('2026-08-15T00:00:00.000Z'))
    expect(name).toBe('revenue-overview-2026-08-15.xlsx')
  })

  test('a report with no name still produces a usable filename', () => {
    expect(exportFilename('', 'csv', new Date('2026-08-15T00:00:00.000Z'))).toBe('report-2026-08-15.csv')
  })
})

describe('who may receive a scheduled report', () => {
  test('project members are allowed', async () => {
    const allowed = await allowedRecipients(projectId)
    const ownerEmail = (await db.unsafe(`SELECT email FROM users WHERE id = $1`, [owner.id]))?.[0] as { email: string }

    expect(allowed.has(String(ownerEmail.email).toLowerCase())).toBeTrue()
  })

  test('a stranger is refused, and named', async () => {
    // The whole open-relay problem: without this, anyone with a free account
    // could point a daily schedule at somebody who never asked for it and have
    // our server deliver it, with our domain's reputation behind it.
    expect(assertRecipientsAllowed(projectId, ['stranger@example.com']))
      .rejects.toThrow(/stranger@example\.com/)
  })

  test('one stranger among members refuses the whole list', async () => {
    const ownerEmail = String(((await db.unsafe(`SELECT email FROM users WHERE id = $1`, [owner.id]))?.[0] as { email: string }).email)

    expect(assertRecipientsAllowed(projectId, [ownerEmail, 'stranger@example.com']))
      .rejects.toThrow(/stranger@example\.com/)
  })

  test('an empty list is refused rather than silently delivering to nobody', async () => {
    expect(assertRecipientsAllowed(projectId, [])).rejects.toThrow(/at least one recipient/)
  })

  test('the check is case insensitive', async () => {
    const ownerEmail = String(((await db.unsafe(`SELECT email FROM users WHERE id = $1`, [owner.id]))?.[0] as { email: string }).email)

    // Somebody's phone capitalises the first letter. That is the same person.
    expect(assertRecipientsAllowed(projectId, [ownerEmail.toUpperCase()])).resolves.toBeUndefined()
  })

  test('a project cannot send to another project\'s members', async () => {
    const other = Number((await createProject(owner, { name: `Other recipients ${stamp}`, timezone: 'UTC' })).id)

    try {
      // Membership is per project, so the allowed set must be too.
      const allowed = await allowedRecipients(other)
      expect(allowed.size).toBeGreaterThan(0)
      expect(assertRecipientsAllowed(other, ['nobody@example.com'])).rejects.toThrow()
    }
    finally {
      await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [other])
      await db.unsafe(`DELETE FROM projects WHERE id = $1`, [other])
    }
  })
})

describe('on-demand exports', () => {
  const request = (format: 'csv' | 'xlsx' = 'csv') => generateExport({
    projectId,
    reportId,
    reportName: 'Exportable',
    timezone: 'UTC',
    range: 'last_7_days',
    format,
    user: owner,
  })

  afterAll(async () => {
    await db.unsafe(`DELETE FROM report_exports WHERE report_id = $1`, [reportId])
  })

  test('generating one produces a ready row with a real file', async () => {
    const record = await request()

    expect(record.status).toBe('ready')
    expect(record.sizeBytes).toBeGreaterThan(0)
    expect(record.filename).toEndWith('.csv')
  })

  test('a signed link resolves to the file', async () => {
    const record = await request()
    const resolved = await resolveExport(record.id, record.expiresAt, signExport(record.id, record.expiresAt))

    expect(resolved).not.toBeNull()
    expect(resolved!.reportId).toBe(reportId)
  })

  test('a forged signature resolves to nothing', async () => {
    const record = await request()

    expect(await resolveExport(record.id, record.expiresAt, 'deadbeef')).toBeNull()
    expect(await resolveExport(record.id, record.expiresAt, '')).toBeNull()
  })

  test('the signature is bound to the export it was issued for', async () => {
    const first = await request()
    const second = await request()

    // Otherwise one valid link would open every export on the instance.
    const borrowed = signExport(first.id, first.expiresAt)
    expect(await resolveExport(second.id, second.expiresAt, borrowed)).toBeNull()
  })

  test('the expiry cannot be extended by editing the URL', async () => {
    const record = await request()
    const later = new Date(Date.now() + 86_400_000).toISOString()

    // The signature covers the expiry, so a longer one does not verify.
    expect(await resolveExport(record.id, later, signExport(record.id, record.expiresAt))).toBeNull()
    // And re-signing the later expiry does not match the row.
    expect(await resolveExport(record.id, later, signExport(record.id, later))).toBeNull()
  })

  test('an expired link stops working', async () => {
    const record = await request()
    const past = new Date(Date.now() - 1000).toISOString()

    await db.unsafe(`UPDATE report_exports SET expires_at = $1 WHERE id = $2`, [past, record.id])

    expect(await resolveExport(record.id, past, signExport(record.id, past))).toBeNull()
  })

  test('an export of a deleted report is not downloadable', async () => {
    const record = await request()
    await db.unsafe(`UPDATE reports SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [reportId])

    expect(await resolveExport(record.id, record.expiresAt, signExport(record.id, record.expiresAt))).toBeNull()

    await db.unsafe(`UPDATE reports SET deleted_at = NULL WHERE id = $1`, [reportId])
  })

  test('the history lists recent exports', async () => {
    await request()
    const listed = await exportsFor(reportId)

    expect(listed.length).toBeGreaterThan(0)
    expect(String(listed[0]!.status)).toBe('ready')
  })

  test('pruning removes expired exports and their files', async () => {
    const record = await request()
    await db.unsafe(`UPDATE report_exports SET expires_at = $1 WHERE id = $2`, [new Date(Date.now() - 1000).toISOString(), record.id])

    const removed = await pruneExports()
    expect(removed).toBeGreaterThan(0)

    const rows = await db.unsafe(`SELECT COUNT(*) AS n FROM report_exports WHERE id = $1`, [record.id]) as Array<{ n: number }>
    expect(Number(rows[0]?.n)).toBe(0)
  })
})
