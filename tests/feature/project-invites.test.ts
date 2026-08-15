/**
 * The invite lifecycle: who may send one, what a token is worth, and what
 * happens to it afterwards.
 *
 * An invite is the only way a seat gets created, so the interesting cases are
 * the ones where a token should stop working: expired, revoked, already used,
 * or pointing at a project that has since been deleted. Each of those has to
 * refuse identically, because a caller holding a token must not be able to tell
 * them apart - the differences describe someone else's project.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { canRead } from '../../app/Support/access'
import { acceptInvite, createProject, inviteToProject, membersOf, pendingInvitesFor, removeMember, revokeInvite, rotateIngestKey } from '../../app/Support/projects'

const stamp = Date.now()

interface Person { id: number, email: string }

async function makeUser(label: string): Promise<Person> {
  const email = `${label}-inv-${stamp}@reportshq.test`
  await db.unsafe(
    // On Pro, so a fixture building a dozen reports is testing reports rather
    // than testing the free plan's limits. limits.test.ts sets its own tier.
    `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'pro', CURRENT_TIMESTAMP)`,
    [label, email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  return { id: Number(row.id), email }
}

let owner: Person
let admin: Person
let invitee: Person
let stranger: Person
let projectId: number

beforeAll(async () => {
  owner = await makeUser('owner')
  admin = await makeUser('admin')
  invitee = await makeUser('invitee')
  stranger = await makeUser('stranger')

  const project = await createProject(owner, { name: `Invites ${stamp}` })
  projectId = Number(project.id)

  const adminInvite = await inviteToProject(owner, projectId, admin.email, 'admin')
  await acceptInvite(admin, adminInvite.token)
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM project_invites WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM project_members WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE email LIKE $1`, [`%-inv-${stamp}@reportshq.test`])
})

describe('creating a project', () => {
  test('the creator owns it and can read it', async () => {
    expect(await canRead(owner, projectId)).toBeTrue()
  })

  test('it gets a prefixed, unguessable ingest key', async () => {
    const row = (await db.unsafe(`SELECT ingest_key FROM projects WHERE id = $1`, [projectId]))?.[0] as { ingest_key: string }

    expect(row.ingest_key.startsWith('rhq_')).toBeTrue()
    expect(row.ingest_key.length).toBeGreaterThanOrEqual(36)
  })

  test('a project with no name is refused', async () => {
    await expect(createProject(owner, { name: '   ' })).rejects.toThrow('needs a name')
  })
})

describe('sending an invite', () => {
  test('an owner may invite', async () => {
    const invite = await inviteToProject(owner, projectId, `first-${stamp}@example.com`)
    expect(invite.token.length).toBeGreaterThanOrEqual(32)
    expect(invite.role).toBe('member')
  })

  test('an admin may invite too', async () => {
    const invite = await inviteToProject(admin, projectId, `second-${stamp}@example.com`)
    expect(invite.email).toBe(`second-${stamp}@example.com`)
  })

  test('a stranger may not', async () => {
    await expect(inviteToProject(stranger, projectId, `nope-${stamp}@example.com`))
      .rejects.toThrow('owner or admin')
  })

  test('the address is stored lowercased, so one person cannot hold two invites', async () => {
    const mixed = `Mixed.Case-${stamp}@Example.COM`
    const invite = await inviteToProject(owner, projectId, mixed)

    expect(invite.email).toBe(mixed.toLowerCase())
  })

  test('re-inviting refreshes the pending invite instead of adding a second', async () => {
    const email = `repeat-${stamp}@example.com`
    const first = await inviteToProject(owner, projectId, email)
    const second = await inviteToProject(owner, projectId, email)

    expect(second.token).not.toBe(first.token)

    const rows = await db.unsafe(
      `SELECT id FROM project_invites WHERE project_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [projectId, email],
    ) as unknown[]

    expect(rows).toHaveLength(1)

    // And the superseded token is dead, not merely hidden.
    await expect(acceptInvite(stranger, first.token)).rejects.toThrow('not valid any more')
  })

  test('something that is not an email is refused', async () => {
    await expect(inviteToProject(owner, projectId, 'not-an-email')).rejects.toThrow('email address')
  })
})

describe('accepting an invite', () => {
  test('a valid token grants a seat with the invited role', async () => {
    const invite = await inviteToProject(owner, projectId, invitee.email, 'member')

    expect(await canRead(invitee, projectId)).toBeFalse()

    const result = await acceptInvite(invitee, invite.token)

    expect(result.projectId).toBe(projectId)
    expect(result.role).toBe('member')
    expect(await canRead(invitee, projectId)).toBeTrue()
  })

  test('the same token cannot be used twice', async () => {
    const invite = await inviteToProject(owner, projectId, `once-${stamp}@example.com`)
    await acceptInvite(stranger, invite.token)

    await expect(acceptInvite(stranger, invite.token)).rejects.toThrow('not valid any more')

    await removeMember(owner, projectId, stranger.id)
  })

  test('accepting twice does not create a second seat', async () => {
    const email = `double-${stamp}@example.com`
    const first = await inviteToProject(owner, projectId, email)
    await acceptInvite(stranger, first.token)
    const second = await inviteToProject(owner, projectId, email)
    await acceptInvite(stranger, second.token)

    const seats = await db.unsafe(
      `SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, stranger.id],
    ) as unknown[]

    expect(seats).toHaveLength(1)

    await removeMember(owner, projectId, stranger.id)
  })

  test('an expired token is refused', async () => {
    const invite = await inviteToProject(owner, projectId, `stale-${stamp}@example.com`)
    await db.unsafe(
      `UPDATE project_invites SET expires_at = $1 WHERE token = $2`,
      [new Date(Date.now() - 1000).toISOString(), invite.token],
    )

    await expect(acceptInvite(stranger, invite.token)).rejects.toThrow('not valid any more')
  })

  test('a revoked token is refused', async () => {
    const invite = await inviteToProject(owner, projectId, `revoked-${stamp}@example.com`)
    const row = (await db.unsafe(`SELECT id FROM project_invites WHERE token = $1`, [invite.token]))?.[0] as { id: number }

    await revokeInvite(owner, Number(row.id))

    await expect(acceptInvite(stranger, invite.token)).rejects.toThrow('not valid any more')
  })

  test('an unknown or empty token is refused the same way', async () => {
    await expect(acceptInvite(stranger, 'nonsense')).rejects.toThrow('not valid any more')
    await expect(acceptInvite(stranger, '')).rejects.toThrow('not valid any more')
  })

  test('a member cannot revoke invites', async () => {
    const invite = await inviteToProject(owner, projectId, `guarded-${stamp}@example.com`)
    const row = (await db.unsafe(`SELECT id FROM project_invites WHERE token = $1`, [invite.token]))?.[0] as { id: number }

    await expect(revokeInvite(invitee, Number(row.id))).rejects.toThrow('owner or admin')
  })
})

describe('the members screen', () => {
  test('lists the owner as owner alongside the seats', async () => {
    const members = await membersOf(projectId)
    const roles = members.map(row => row.role)

    expect(roles).toContain('owner')
    expect(roles).toContain('admin')
    expect(members.filter(row => row.role === 'owner')).toHaveLength(1)
  })

  test('shows pending invites, and stops showing them once accepted', async () => {
    const email = `pending-${stamp}@example.com`
    const invite = await inviteToProject(owner, projectId, email)

    expect((await pendingInvitesFor(projectId)).map(row => row.email)).toContain(email)

    await acceptInvite(stranger, invite.token)

    expect((await pendingInvitesFor(projectId)).map(row => row.email)).not.toContain(email)

    await removeMember(owner, projectId, stranger.id)
  })
})

describe('removing people', () => {
  test('an admin can remove a member', async () => {
    expect(await canRead(invitee, projectId)).toBeTrue()
    await removeMember(admin, projectId, invitee.id)
    expect(await canRead(invitee, projectId)).toBeFalse()
  })

  test('a member can remove themselves', async () => {
    const invite = await inviteToProject(owner, projectId, invitee.email)
    await acceptInvite(invitee, invite.token)

    await removeMember(invitee, projectId, invitee.id)
    expect(await canRead(invitee, projectId)).toBeFalse()
  })

  test('a member cannot remove someone else', async () => {
    const invite = await inviteToProject(owner, projectId, invitee.email)
    await acceptInvite(invitee, invite.token)

    await expect(removeMember(invitee, projectId, admin.id)).rejects.toThrow('owner or admin')
    expect(await canRead(admin, projectId)).toBeTrue()
  })

  test('the owner cannot be removed, even by themselves', async () => {
    await expect(removeMember(owner, projectId, owner.id)).rejects.toThrow('owner cannot be removed')
    expect(await canRead(owner, projectId)).toBeTrue()
  })
})

describe('rotating the ingest key', () => {
  test('the owner can rotate, and the old key stops resolving', async () => {
    const before = (await db.unsafe(`SELECT ingest_key FROM projects WHERE id = $1`, [projectId]))?.[0] as { ingest_key: string }

    const rotated = await rotateIngestKey(owner, projectId)

    expect(rotated).not.toBe(before.ingest_key)
    expect(rotated.startsWith('rhq_')).toBeTrue()

    const stale = await db.unsafe(`SELECT id FROM projects WHERE ingest_key = $1`, [before.ingest_key]) as unknown[]
    expect(stale).toHaveLength(0)
  })

  test('an admin cannot rotate it', async () => {
    // Rotating breaks every integration sending events. That is an owner's
    // call, not a collaborator's.
    await expect(rotateIngestKey(admin, projectId)).rejects.toThrow('owner')
  })
})
