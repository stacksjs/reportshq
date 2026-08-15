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
import { LimitReached, limitResponse } from '../app/Billing/gates'
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
