/**
 * Who can see which project, and what they may do with it.
 *
 * One file owns the predicate. The API routes, the page actions that render the
 * same data, the ingest path and the report engine all ask the same questions
 * here, so they cannot drift on the answer. A second copy of "owner or member"
 * somewhere else is how one surface ends up more permissive than the other.
 *
 * The rule: a project is visible to its owner and to anyone holding an accepted
 * seat on it. Membership is keyed by `user_id`, never by email. Email-keyed
 * membership reads nicely and grants access the moment someone signs up with a
 * matching address, but it turns the email column into an authorisation
 * credential, and any path that lets a user set their own address without
 * verifying it becomes a way into another tenant's data. Invites carry the
 * email; only accepting one writes a seat.
 */
import { db } from '@stacksjs/database'

/** What a member may do. The owner implicitly has every capability. */
export type Role = 'owner' | 'admin' | 'member'

export interface Access {
  projectId: number
  role: Role
  isOwner: boolean
}

function userId(user: unknown): number {
  return Number((user as { id?: number | string } | null)?.id ?? 0)
}

/**
 * The caller's standing on a project, or null when they have none.
 *
 * One query rather than an ownership check followed by a fetch. The two-step
 * form has a time-of-check to time-of-use gap, and it also answers "no such
 * project" and "not yours" differently, which tells a stranger whether an id is
 * real.
 */
export async function accessFor(user: unknown, projectId: number | string): Promise<Access | null> {
  const id = userId(user)
  if (!id)
    return null

  const row = (await db.unsafe(
    `SELECT p.id AS project_id,
            CASE WHEN p.owner_id = $2 THEN CAST('owner' AS TEXT) ELSE CAST(m.role AS TEXT) END AS role
       FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
      WHERE p.id = $1
        AND p.deleted_at IS NULL
        AND (p.owner_id = $2 OR m.id IS NOT NULL)
      LIMIT 1`,
    [Number(projectId), id],
  ))?.[0] as { project_id: number, role: Role } | undefined

  if (!row)
    return null

  return { projectId: Number(row.project_id), role: row.role, isOwner: row.role === 'owner' }
}

/** True when the caller can read the project at all. */
export async function canRead(user: unknown, projectId: number | string): Promise<boolean> {
  return (await accessFor(user, projectId)) !== null
}

/**
 * True when the caller may change project settings, invite people, or remove
 * them. Owners and admins; a member may read and build reports but not reshape
 * who else is in the room.
 */
export async function canAdminister(user: unknown, projectId: number | string): Promise<boolean> {
  const access = await accessFor(user, projectId)
  return access !== null && (access.isOwner || access.role === 'admin')
}

/**
 * True only for the owner. Deleting a project, rotating its ingest key and
 * anything that touches billing stay here: those are account-level
 * consequences, and an admin seat is a collaboration grant, not a mandate over
 * someone else's subscription.
 */
export async function isOwner(user: unknown, projectId: number | string): Promise<boolean> {
  return (await accessFor(user, projectId))?.isOwner === true
}

/** Every project the caller can see, owned or joined, newest first. */
export async function projectsFor(user: unknown): Promise<Array<Record<string, unknown>>> {
  const id = userId(user)
  if (!id)
    return []

  return await db.unsafe(
    `SELECT p.*, CASE WHEN p.owner_id = $1 THEN CAST('owner' AS TEXT) ELSE CAST(m.role AS TEXT) END AS role
       FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
      WHERE p.deleted_at IS NULL
        AND (p.owner_id = $1 OR m.id IS NOT NULL)
      ORDER BY p.created_at DESC`,
    [id],
  ) as Array<Record<string, unknown>>
}

/**
 * The project a write-only ingest key belongs to, or null.
 *
 * Separate from every function above because it answers a different question
 * with a different credential: this one identifies a project, not a person, and
 * grants exactly one capability. It must never be used to authorise a read.
 */
export async function projectForIngestKey(key: string): Promise<Record<string, unknown> | null> {
  const trimmed = String(key ?? '').trim()
  if (!trimmed)
    return null

  const row = (await db.unsafe(
    `SELECT * FROM projects WHERE ingest_key = $1 AND deleted_at IS NULL LIMIT 1`,
    [trimmed],
  ))?.[0]

  return row ?? null
}
