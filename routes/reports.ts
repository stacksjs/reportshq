import type { EnhancedRequest } from '@stacksjs/bun-router'
import { response, route } from '@stacksjs/router'
import { firstFreeRow } from '../app/Reports/layout'
import {
  addBlock,
  archiveReport,
  blocksOf,
  createReport,
  duplicateReport,
  restoreReport,
  publishReport,
  removeBlock,
  reportBySlug,
  saveRevision,
  settleLayout,
  updateBlocks,
} from '../app/Reports/reports'
import { assertCan, LimitReached, limitResponse } from '../app/Billing/gates'
import { db } from '@stacksjs/database'
import { assertRecipientsAllowed, parseRecipients } from '../app/Reports/schedules'
import { createShare, revokeShare, rotateShare, sharesFor } from '../app/Reports/shares'
import { accessFor } from '../app/Support/access'
import { requestUser } from '../app/Support/session'

/**
 * The builder's write surface.
 *
 * Registered behind `auth` at the registry level, and every handler resolves
 * the project first: being signed in says nothing about whose report this is.
 * A report is always reached through its project, never by a bare report id,
 * so there is no path where an id from another tenant resolves to anything.
 */

/**
 * The JSON body, read once per request.
 *
 * `request.input()` does not surface JSON body fields on this path, so a
 * handler relying on it saw an empty project and slug and answered "not found"
 * for a report that was right there. Parsing explicitly, as the ingest route
 * already does, is the difference between a builder that saves and one that
 * silently refuses every change.
 */
async function body(request: EnhancedRequest): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text()
    if (!raw)
      return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

/** See app/Support/session.ts: the middleware stamps `_authenticatedUser`. */
function currentUser(request: EnhancedRequest): { id: number } | null {
  return requestUser(request)
}

function notFound(): ReturnType<typeof response.json> {
  return response.json({ message: 'Report not found.' }, 404)
}

/** Resolve a report the caller may edit, or null. One place, one rule. */
async function editableReport(request: EnhancedRequest, payload: Record<string, unknown>): Promise<{ user: { id: number }, reportId: number, projectId: number } | null> {
  const user = currentUser(request)
  if (!user)
    return null

  const projectId = Number(payload.project ?? 0)
  const slug = String(payload.slug ?? '')

  if (!projectId || !slug)
    return null

  // A member may build reports; only administering the project is restricted.
  if (!(await accessFor(user, projectId)))
    return null

  const report = await reportBySlug(projectId, slug)
  if (!report)
    return null

  return { user, reportId: Number(report.id), projectId }
}

route.post('/blocks', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const kind = String(payload.kind ?? 'line')
  const width = Number(payload.w ?? 6)
  const height = Number(payload.h ?? 4)

  // The first gap it actually fits in, rather than always the bottom. Adding a
  // big number to a report whose top row has space should put it in that space;
  // sending it to the end means every new block starts with a drag.
  const existing = (await blocksOf(context.reportId)).map(block => ({
    id: Number(block.id),
    x: Number(block.x) || 0,
    y: Number(block.y) || 0,
    w: Number(block.w) || 1,
    h: Number(block.h) || 1,
  }))
  const spot = firstFreeRow(existing, width, height)

  try {
    const block = await addBlock(context.reportId, {
      kind: kind as never,
      title: payload.title ? String(payload.title) : undefined,
      layout: { x: spot.x, y: spot.y, w: width, h: height },
      query: (payload.query as never) ?? { events: [], measure: 'count', filters: [], grain: 'day' },
      body: payload.body ? String(payload.body) : undefined,
    })

    await saveRevision(context.reportId, context.user)

    return response.json({ block }, 201)
  }
  catch (error) {
    // The message names the field, so the config panel can point at it.
    return response.json({ message: (error as Error).message }, 422)
  }
}).skipCsrf()

/**
 * Save a batch of block edits.
 *
 * A batch because one drag moves several blocks: dropping a block at the top
 * pushes everything below it down, and saving those separately means several
 * chances to end up with a layout nobody arranged.
 */
route.post('/blocks/save', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const updates = payload.blocks
  if (!Array.isArray(updates))
    return response.json({ message: 'Expected a blocks array.' }, 422)

  try {
    // `moved` is the block the person was holding, so it keeps the position
    // they chose and everything else gives way. Without it the dragged block is
    // as likely to be pushed as to push, and it does not end up where it was
    // dropped.
    const layout = await updateBlocks(context.reportId, updates as never, {
      moved: payload.moved ? Number(payload.moved) : undefined,
    })
    await saveRevision(context.reportId, context.user)

    // The settled layout goes back with the response. The client's push-down is
    // a preview; this is the answer, and it adopts it.
    return response.json({ layout, blocks: await blocksOf(context.reportId) })
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 422)
  }
}).skipCsrf()

route.post('/blocks/remove', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const blockId = Number(payload.id ?? 0)
  if (!blockId)
    return response.json({ message: 'Which block?' }, 422)

  // A revision first, so removing a block is undoable rather than final.
  await saveRevision(context.reportId, context.user)
  await removeBlock(context.reportId, blockId)

  return response.json({ removed: true, layout: await settleLayout(context.reportId) })
}).skipCsrf()

route.post('/publish', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  await publishReport(context.reportId, context.user)

  return response.json({ published: true })
}).skipCsrf()

/**
 * Copy a report.
 *
 * Takes the source by slug like everything else here, so a report is always
 * reached through its project and an id from another tenant resolves to
 * nothing.
 */
route.post('/duplicate', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  try {
    const copy = await duplicateReport(context.projectId, context.user, context.reportId)
    if (!copy)
      return notFound()

    return response.json({ report: copy }, 201)
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 422)
  }
}).skipCsrf()

route.post('/archive', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  return response.json({ archived: await archiveReport(context.projectId, context.reportId) })
}).skipCsrf()

/**
 * Bring an archived report back.
 *
 * Resolved by id rather than through `editableReport`, because that helper
 * looks a report up by slug and deliberately ignores archived ones. Project
 * access is still checked first, and the id is scoped to the project inside
 * `restoreReport`, so nothing widens.
 */
route.post('/restore', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const user = currentUser(request)
  if (!user)
    return notFound()

  const projectId = Number(payload.project ?? 0)
  const reportId = Number(payload.id ?? 0)

  if (!projectId || !reportId || !(await accessFor(user, projectId)))
    return notFound()

  return response.json({ restored: await restoreReport(projectId, reportId) })
}).skipCsrf()

/**
 * The share links on a report.
 *
 * Read through the report, like everything else here, so a share id from
 * another tenant never resolves.
 */
route.post('/shares', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  return response.json({ shares: await sharesFor(context.reportId) })
}).skipCsrf()

route.post('/shares/create', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  try {
    const share = await createShare(context.projectId, context.reportId, context.user, {
      label: payload.label ? String(payload.label) : undefined,
      expiresAt: payload.expires_at ? String(payload.expires_at) : undefined,
      showBranding: payload.show_branding === false ? false : undefined,
    })

    return response.json({ share }, 201)
  }
  catch (error) {
    // A plan limit answers 402 with the tier that would lift it, rather than
    // being flattened into the same 422 as a malformed request.
    if (error instanceof LimitReached) {
      const { body: limitBody, status } = limitResponse(error)
      return response.json(limitBody, status)
    }

    return response.json({ message: (error as Error).message }, 422)
  }
}).skipCsrf()

route.post('/shares/revoke', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const shareId = Number(payload.id ?? 0)
  if (!shareId)
    return response.json({ message: 'Which link?' }, 422)

  return response.json({ revoked: await revokeShare(context.projectId, shareId) })
}).skipCsrf()

route.post('/shares/rotate', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const shareId = Number(payload.id ?? 0)
  if (!shareId)
    return response.json({ message: 'Which link?' }, 422)

  const token = await rotateShare(context.projectId, shareId)
  if (!token)
    return notFound()

  // The old URL stops working immediately, which is the point of rotating.
  return response.json({ token })
}).skipCsrf()

/**
 * Scheduled delivery for a report.
 *
 * Recipients are checked against project membership on every write, not only
 * on create: an address added by editing a schedule would otherwise skip the
 * check entirely, which is the whole of the open-relay problem.
 */
route.post('/schedules', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const rows = await db.unsafe(
    `SELECT id, cadence, hour, day_of_week, day_of_month, timezone, recipients, format,
            is_active, last_run_at, last_status
       FROM report_schedules WHERE report_id = $1 ORDER BY created_at DESC`,
    [context.reportId],
  )

  return response.json({ schedules: rows })
}).skipCsrf()

route.post('/schedules/create', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const cadence = String(payload.cadence ?? 'weekly')
  if (!['daily', 'weekly', 'monthly'].includes(cadence))
    return response.json({ message: 'Cadence must be daily, weekly or monthly.' }, 422)

  const hour = Math.max(0, Math.min(23, Math.trunc(Number(payload.hour ?? 8)) || 0))
  const format = String(payload.format ?? 'link')
  if (!['link', 'csv', 'xlsx'].includes(format))
    return response.json({ message: 'Format must be link, csv or xlsx.' }, 422)

  const recipients = parseRecipients(payload.recipients)

  try {
    await assertCan(context.projectId, 'schedules', 'Scheduled delivery')
    await assertRecipientsAllowed(context.projectId, recipients)
  }
  catch (error) {
    if (error instanceof LimitReached) {
      const { body: limitBody, status } = limitResponse(error)
      return response.json(limitBody, status)
    }

    return response.json({ message: (error as Error).message }, 422)
  }

  // The project's zone, not the browser's. A schedule means eight o'clock
  // where the project lives, and a laptop in another country should not
  // silently reschedule everybody else's report.
  const project = (await db.unsafe(`SELECT timezone FROM projects WHERE id = $1`, [context.projectId]))?.[0] as { timezone?: string } | undefined

  await db.unsafe(
    `INSERT INTO report_schedules (report_id, cadence, hour, day_of_week, day_of_month, timezone, recipients, format, is_active, created_by_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, CURRENT_TIMESTAMP)`,
    [
      context.reportId,
      cadence,
      hour,
      cadence === 'weekly' ? Math.max(0, Math.min(6, Math.trunc(Number(payload.day_of_week ?? 1)) || 0)) : null,
      // Capped at 28 so a monthly schedule cannot pick a day February does not
      // have and silently never run.
      cadence === 'monthly' ? Math.max(1, Math.min(28, Math.trunc(Number(payload.day_of_month ?? 1)) || 1)) : null,
      String(project?.timezone ?? 'UTC'),
      JSON.stringify(recipients),
      format,
      context.user.id,
    ],
  )

  return response.json({ created: true }, 201)
}).skipCsrf()

route.post('/schedules/toggle', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const scheduleId = Number(payload.id ?? 0)
  if (!scheduleId)
    return response.json({ message: 'Which schedule?' }, 422)

  // Scoped by report as well as by id, so a schedule from another tenant is
  // not reachable by guessing a number.
  await db.unsafe(
    `UPDATE report_schedules SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND report_id = $2`,
    [scheduleId, context.reportId],
  )

  return response.json({ toggled: true })
}).skipCsrf()

route.post('/schedules/remove', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  const scheduleId = Number(payload.id ?? 0)
  if (!scheduleId)
    return response.json({ message: 'Which schedule?' }, 422)

  await db.unsafe(`DELETE FROM report_schedules WHERE id = $1 AND report_id = $2`, [scheduleId, context.reportId])

  return response.json({ removed: true })
}).skipCsrf()

route.post('/create', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return response.json({ message: 'Sign in to continue.' }, 401)

  const payload = await body(request)
  const projectId = Number(payload.project ?? 0)
  if (!projectId || !(await accessFor(user, projectId)))
    return response.json({ message: 'Project not found.' }, 404)

  try {
    const report = await createReport(projectId, user, {
      name: String(payload.name ?? ''),
      description: payload.description ? String(payload.description) : undefined,
    })

    return response.json({ report }, 201)
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 422)
  }
}).skipCsrf()
