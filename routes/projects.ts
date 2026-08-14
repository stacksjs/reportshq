import type { EnhancedRequest } from '@stacksjs/bun-router'
import { response, route } from '@stacksjs/router'
import { eventNamesFor, eventsFor } from '../app/Events/query'
import { accessFor, canAdminister, isOwner, projectsFor } from '../app/Support/access'
import {
  acceptInvite,
  createProject,
  inviteToProject,
  membersOf,
  pendingInvitesFor,
  removeMember,
  revokeInvite,
  rotateIngestKey,
} from '../app/Support/projects'

/**
 * Owner-scoped project routes.
 *
 * The Project model deliberately does not carry `useApi`: the generated CRUD is
 * not scoped to the requesting user, so `index` would list every project on the
 * instance and `show` would read any of them by id. Everything below resolves
 * permission through app/Support/access.ts first.
 *
 * Two conventions hold throughout:
 *
 * A caller who may not see a project gets 404, not 403. Telling a stranger
 * "forbidden" confirms the id exists, which is the one bit they did not have.
 *
 * The ingest key is only ever returned to someone who may administer the
 * project. It is a write credential, and a member who can read reports has no
 * reason to hold the ability to write events into them.
 */

/**
 * The signed-in account, normalised.
 *
 * The framework types `user.id` as `string | number` because different drivers
 * hand it back differently; everything downstream compares it against an
 * integer column, so the coercion happens once, here, rather than at each call
 * site where it would eventually be forgotten.
 */
function currentUser(request: EnhancedRequest): { id: number, email?: string } | null {
  const user = request.user
  const id = Number(user?.id ?? 0)
  return Number.isFinite(id) && id > 0 ? { id, email: user?.email ? String(user.email) : undefined } : null
}

/** The same answer for "no such project" and "not yours". */
function notFound(): ReturnType<typeof response.json> {
  return response.json({ message: 'Project not found.' }, 404)
}

function unauthenticated(): ReturnType<typeof response.json> {
  return response.json({ message: 'Sign in to continue.' }, 401)
}

route.get('/', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const projects = await projectsFor(user)

  // Listing never carries ingest keys. A list is the one place they would be
  // read most casually and needed least.
  return response.json({
    projects: projects.map(project => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      timezone: project.timezone,
      role: project.role,
      auto_reports_enabled: !!project.auto_reports_enabled,
      first_event_at: project.first_event_at,
      created_at: project.created_at,
    })),
  })
})

route.post('/', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  try {
    const project = await createProject(user, {
      name: String(request.input('name') ?? ''),
      timezone: request.input('timezone') ? String(request.input('timezone')) : undefined,
    })

    // The key is returned exactly once here, on creation, because this is the
    // moment the integration snippet is copied. Afterwards it takes an
    // administer-level read to see it again.
    return response.json({ project, ingest_key: project.ingest_key }, 201)
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 422)
  }
})

route.get('/{id}', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  const access = await accessFor(user, id)
  if (!access)
    return notFound()

  const project = (await projectsFor(user)).find(row => Number(row.id) === id)
  if (!project)
    return notFound()

  const body: Record<string, unknown> = {
    id: project.id,
    name: project.name,
    slug: project.slug,
    timezone: project.timezone,
    role: access.role,
    auto_reports_enabled: !!project.auto_reports_enabled,
    first_event_at: project.first_event_at,
    created_at: project.created_at,
  }

  if (await canAdminister(user, id))
    body.ingest_key = project.ingest_key

  return response.json({ project: body })
})

/**
 * The raw event stream, for confirming an integration works.
 *
 * Any member may read it: someone who can see a project's reports can already
 * see the numbers these events produce, so withholding the rows they came from
 * would obscure debugging without protecting anything.
 */
route.get('/{id}/events', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  if (!(await accessFor(user, id)))
    return notFound()

  // `query` is a record, and a repeated parameter arrives as an array. Take
  // the first occurrence rather than stringifying the array into a filter that
  // matches nothing.
  const param = (name: string): string | undefined => {
    const value = request.query[name]
    const first = Array.isArray(value) ? value[0] : value
    return first === undefined || first === '' ? undefined : String(first)
  }

  const page = await eventsFor(id, {
    name: param('name'),
    from: param('from'),
    to: param('to'),
    userKey: param('user_key'),
    before: param('before') ? Number(param('before')) : undefined,
    limit: param('limit') ? Number(param('limit')) : undefined,
  })

  return response.json({
    events: page.events,
    // Named `next_cursor` rather than `next_page`: it is an opaque value to
    // pass back as `before`, not a number to increment.
    next_cursor: page.nextCursor,
  })
})

/** The names seen in this project, most frequent first. Drives the filter UI. */
route.get('/{id}/event-names', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  if (!(await accessFor(user, id)))
    return notFound()

  return response.json({ names: await eventNamesFor(id) })
})

route.post('/{id}/rotate-key', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  if (!(await accessFor(user, id)))
    return notFound()

  try {
    const key = await rotateIngestKey(user, id)
    return response.json({ ingest_key: key })
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 403)
  }
})

route.get('/{id}/members', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  if (!(await accessFor(user, id)))
    return notFound()

  // Pending invites are administrative detail: a member sees who is on the
  // project, an admin sees who has been asked.
  const invites = (await canAdminister(user, id)) ? await pendingInvitesFor(id) : []

  return response.json({ members: await membersOf(id), invites })
})

route.post('/{id}/invites', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  if (!(await accessFor(user, id)))
    return notFound()

  const role = String(request.input('role') ?? 'member')

  try {
    const invite = await inviteToProject(
      user,
      id,
      String(request.input('email') ?? ''),
      role === 'admin' ? 'admin' : 'member',
    )

    // The token goes back to the caller so the UI can show a copyable link
    // before the email arrives, and so an invite still works when mail is not
    // configured at all (a self-hosted install with no SMTP).
    return response.json({ invite }, 201)
  }
  catch (error) {
    const message = (error as Error).message
    return response.json({ message }, message.includes('owner or admin') ? 403 : 422)
  }
})

route.delete('/{id}/invites/{inviteId}', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  if (!(await accessFor(user, id)))
    return notFound()

  try {
    await revokeInvite(user, Number(request.param('inviteId')))
    return response.json({ revoked: true })
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 403)
  }
})

route.delete('/{id}/members/{userId}', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  if (!(await accessFor(user, id)))
    return notFound()

  try {
    await removeMember(user, id, Number(request.param('userId')))
    return response.json({ removed: true })
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 403)
  }
})

/**
 * Accepting is deliberately not nested under a project id: the person holding
 * the token cannot see the project yet, and putting its id in the URL would
 * leak one before they have accepted anything.
 */
route.post('/accept', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  try {
    const result = await acceptInvite(user, String(request.input('token') ?? ''))
    return response.json(result)
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 422)
  }
})

route.delete('/{id}', async (request: EnhancedRequest) => {
  const user = currentUser(request)
  if (!user)
    return unauthenticated()

  const id = Number(request.param('id'))
  if (!(await accessFor(user, id)))
    return notFound()

  if (!(await isOwner(user, id)))
    return response.json({ message: 'Only the project owner can delete a project.' }, 403)

  const { db } = await import('@stacksjs/database')
  // Soft delete: the events and reports behind it stay addressable while the
  // retention job works through them, and access.ts already treats a deleted
  // project as gone for every reader.
  await db.unsafe(`UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [id])

  return response.json({ deleted: true })
})
