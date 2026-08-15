import type { EnhancedRequest } from '@stacksjs/bun-router'
import { response, route } from '@stacksjs/router'
import {
  addBlock,
  blocksOf,
  createReport,
  nextFreeRow,
  publishReport,
  removeBlock,
  reportBySlug,
  saveRevision,
  updateBlocks,
} from '../app/Reports/reports'
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

  try {
    const block = await addBlock(context.reportId, {
      kind: kind as never,
      title: payload.title ? String(payload.title) : undefined,
      // Placed under whatever is already there. Dropping a new block at 0,0
      // covers existing work, and a builder that hides what you have made the
      // moment you add to it teaches people not to add to it.
      layout: { x: 0, y: await nextFreeRow(context.reportId), w: width, h: height },
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
    await updateBlocks(context.reportId, updates as never)
    await saveRevision(context.reportId, context.user)

    return response.json({ blocks: await blocksOf(context.reportId) })
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

  return response.json({ removed: true })
}).skipCsrf()

route.post('/publish', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const context = await editableReport(request, payload)
  if (!context)
    return notFound()

  await publishReport(context.reportId, context.user)

  return response.json({ published: true })
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
