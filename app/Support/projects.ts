/**
 * Creating and reshaping projects, and the invite lifecycle.
 *
 * Kept beside app/Support/access.ts so the two halves of tenancy live together:
 * that file answers "may they?", this one performs the change once the answer
 * is yes. Callers are responsible for asking first; every function here that
 * needs permission takes the acting user and re-checks, because a helper that
 * trusts its caller is a helper that eventually gets called from somewhere new.
 */
import { db } from '@stacksjs/database'
import { canAdminister, isOwner } from './access'

/** How long an unaccepted invite stays usable. */
export const INVITE_TTL_DAYS = 7

export interface CreateProjectInput {
  name: string
  timezone?: string
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120)
}

/**
 * A fresh, unguessable write credential.
 *
 * 128 bits from the platform CSPRNG. Prefixed so a leaked key is identifiable
 * on sight, in a log line or a paste, without having to look it up.
 */
export function newIngestKey(): string {
  return `rhq_${globalThis.crypto.randomUUID().replace(/-/g, '')}`
}

export function newInviteToken(): string {
  return `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`.replace(/-/g, '')
}

/** Email as it is stored and compared: trimmed and lowercased, once, here. */
export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase()
}

export async function createProject(user: { id: number }, input: CreateProjectInput): Promise<Record<string, unknown>> {
  const name = String(input.name ?? '').trim()
  if (!name)
    throw new Error('A project needs a name.')

  const key = newIngestKey()

  await db.unsafe(
    `INSERT INTO projects (name, slug, ingest_key, owner_id, timezone, auto_reports_enabled, created_at)
     VALUES ($1, $2, $3, $4, $5, 1, CURRENT_TIMESTAMP)`,
    [name, slugify(name), key, Number(user.id), input.timezone ?? 'UTC'],
  )

  const row = (await db.unsafe(`SELECT * FROM projects WHERE ingest_key = $1`, [key]))?.[0]
  return row as Record<string, unknown>
}

/**
 * Replace the write credential.
 *
 * Owner only. Rotating is how a leaked key is dealt with, and it takes effect
 * on the next request: everything still sending the old one starts getting 401s
 * immediately, which is the point. The UI is responsible for saying so before
 * the button is pressed.
 */
export async function rotateIngestKey(user: { id: number }, projectId: number): Promise<string> {
  if (!(await isOwner(user, projectId)))
    throw new Error('Only the project owner can rotate the ingest key.')

  const key = newIngestKey()
  await db.unsafe(`UPDATE projects SET ingest_key = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [key, projectId])
  return key
}

export interface InviteResult {
  token: string
  email: string
  role: 'admin' | 'member'
  expiresAt: string
}

/**
 * Invite an email address to a project.
 *
 * Re-inviting an address that already has a pending invite refreshes that
 * invite rather than adding a second one: two live tokens for one seat means
 * revoking the invite you can see does not revoke the one you cannot.
 */
export async function inviteToProject(
  user: { id: number },
  projectId: number,
  email: string,
  role: 'admin' | 'member' = 'member',
): Promise<InviteResult> {
  if (!(await canAdminister(user, projectId)))
    throw new Error('Only an owner or admin can invite people to a project.')

  const address = normalizeEmail(email)
  if (!address.includes('@'))
    throw new Error('That does not look like an email address.')

  const alreadyAMember = (await db.unsafe(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND lower(email) = $2 LIMIT 1`,
    [projectId, address],
  ))?.[0]

  if (alreadyAMember)
    throw new Error('That person is already on this project.')

  const token = newInviteToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const pending = (await db.unsafe(
    `SELECT id FROM project_invites
      WHERE project_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL
      LIMIT 1`,
    [projectId, address],
  ))?.[0] as { id: number } | undefined

  if (pending) {
    await db.unsafe(
      `UPDATE project_invites SET token = $1, role = $2, expires_at = $3, invited_by_id = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $5`,
      [token, role, expiresAt, Number(user.id), pending.id],
    )
  }
  else {
    await db.unsafe(
      `INSERT INTO project_invites (project_id, email, role, token, invited_by_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [projectId, address, role, token, Number(user.id), expiresAt],
    )
  }

  return { token, email: address, role, expiresAt }
}

/** Withdraw a pending invite. The token stops working immediately. */
export async function revokeInvite(user: { id: number }, inviteId: number): Promise<void> {
  const invite = (await db.unsafe(`SELECT project_id FROM project_invites WHERE id = $1`, [inviteId]))?.[0] as { project_id: number } | undefined
  if (!invite)
    throw new Error('That invite no longer exists.')

  if (!(await canAdminister(user, invite.project_id)))
    throw new Error('Only an owner or admin can revoke an invite.')

  await db.unsafe(
    `UPDATE project_invites SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND accepted_at IS NULL`,
    [inviteId],
  )
}

export interface AcceptResult {
  projectId: number
  role: 'admin' | 'member'
}

/**
 * Turn a token into a seat.
 *
 * Every reason to refuse returns the same message. A caller holding a token
 * should not be able to tell "already used" from "revoked" from "never
 * existed": those answers describe other people's projects.
 *
 * The accepting user's address does not have to match the invited one. The
 * token was delivered to that address, and forwarding an invite is a normal
 * thing to do; requiring a match would also mean trusting the account's email
 * field, which is exactly what the membership model avoids.
 */
export async function acceptInvite(user: { id: number, email?: string }, token: string): Promise<AcceptResult> {
  const value = String(token ?? '').trim()
  const refuse = (): never => {
    throw new Error('That invitation is not valid any more.')
  }

  if (!value)
    return refuse()

  const invite = (await db.unsafe(
    `SELECT i.id, i.project_id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.invited_by_id
       FROM project_invites i
       JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
      WHERE i.token = $1
      LIMIT 1`,
    [value],
  ))?.[0] as {
    id: number
    project_id: number
    email: string
    role: 'admin' | 'member'
    expires_at: string | null
    accepted_at: string | null
    revoked_at: string | null
    invited_by_id: number | null
  } | undefined

  if (!invite || invite.accepted_at || invite.revoked_at)
    return refuse()

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now())
    return refuse()

  const existing = (await db.unsafe(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [invite.project_id, Number(user.id)],
  ))?.[0]

  if (!existing) {
    await db.unsafe(
      `INSERT INTO project_members (project_id, user_id, email, role, invited_by_id, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [invite.project_id, Number(user.id), normalizeEmail(user.email ?? invite.email), invite.role, invite.invited_by_id],
    )
  }

  await db.unsafe(
    `UPDATE project_invites SET accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [invite.id],
  )

  return { projectId: invite.project_id, role: invite.role }
}

/**
 * Remove someone from a project.
 *
 * Owners and admins may remove a member; anyone may remove themselves. The
 * owner is not a seat and cannot be removed at all - transferring or deleting
 * the project is the way out of that, and neither belongs behind a "remove
 * member" button.
 */
export async function removeMember(user: { id: number }, projectId: number, memberUserId: number): Promise<void> {
  const removingSelf = Number(user.id) === Number(memberUserId)

  if (!removingSelf && !(await canAdminister(user, projectId)))
    throw new Error('Only an owner or admin can remove someone from a project.')

  const owner = (await db.unsafe(`SELECT owner_id FROM projects WHERE id = $1`, [projectId]))?.[0] as { owner_id: number } | undefined
  if (owner && Number(owner.owner_id) === Number(memberUserId))
    throw new Error('The project owner cannot be removed. Transfer or delete the project instead.')

  await db.unsafe(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [projectId, memberUserId])
}

/**
 * Turn automatic report creation on or off for a project.
 *
 * Lives here rather than in the route for the same reason every other write
 * does: permission is decided in one place. An allowlisted setting rather than
 * a general project update, because the projects row also holds the ingest key
 * and the owner, and a generic updater is one typo away from letting a member
 * rewrite either.
 */
export async function setAutoReports(user: { id: number }, projectId: number, enabled: boolean): Promise<void> {
  if (!(await canAdminister(user, projectId)))
    throw new Error('Only an owner or admin can change a project\'s settings.')

  await db.unsafe(
    `UPDATE projects SET auto_reports_enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND deleted_at IS NULL`,
    [enabled ? 1 : 0, projectId],
  )
}

/** Everyone with access, owner first, for the members screen. */
export async function membersOf(projectId: number): Promise<Array<Record<string, unknown>>> {
  return await db.unsafe(
    `SELECT u.id AS user_id, u.name, u.email, 'owner' AS role, p.created_at AS joined_at
       FROM projects p JOIN users u ON u.id = p.owner_id
      WHERE p.id = $1
      UNION ALL
     SELECT m.user_id, u.name, m.email, m.role, m.created_at AS joined_at
       FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = $1
      ORDER BY joined_at`,
    [projectId],
  ) as Array<Record<string, unknown>>
}

/** Pending invites for the members screen. Accepted and revoked ones are history. */
export async function pendingInvitesFor(projectId: number): Promise<Array<Record<string, unknown>>> {
  return await db.unsafe(
    `SELECT id, email, role, expires_at, created_at
       FROM project_invites
      WHERE project_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [projectId],
  ) as Array<Record<string, unknown>>
}
