/**
 * The authorisation matrix, against a real database.
 *
 * Every read in this product funnels through app/Support/access.ts, so a
 * mistake here is a cross-tenant data leak rather than a bug. The cases below
 * are the ones that actually go wrong: a stranger reading by id, a member
 * doing an admin's job, an owner losing their own project because they hold no
 * seat row, a soft-deleted project still answering, and an ingest key being
 * accepted as proof of identity for a read.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { setAutoReports } from '../../app/Support/projects'
import { accessFor, canAdminister, canRead, isOwner, projectForIngestKey, projectsFor } from '../../app/Support/access'

interface Fixture {
  owner: { id: number }
  admin: { id: number }
  member: { id: number }
  stranger: { id: number }
  project: { id: number, ingest_key: string }
  otherProject: { id: number }
  deletedProject: { id: number }
}

let f: Fixture

/** Unique per run so a re-run does not collide on the unique email index. */
const stamp = Date.now()

async function makeUser(label: string): Promise<{ id: number }> {
  const email = `${label}-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    [label, email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  return { id: Number(row.id) }
}

async function makeProject(name: string, ownerId: number, deleted = false): Promise<{ id: number, ingest_key: string }> {
  const key = `rhq_${stamp}${Math.random().toString(16).slice(2, 10)}`
  await db.unsafe(
    `INSERT INTO projects (name, slug, ingest_key, owner_id, timezone, created_at, deleted_at)
     VALUES ($1, $2, $3, $4, 'UTC', CURRENT_TIMESTAMP, $5)`,
    [name, name.toLowerCase(), key, ownerId, deleted ? new Date().toISOString() : null],
  )
  const row = (await db.unsafe(`SELECT id, ingest_key FROM projects WHERE ingest_key = $1`, [key]))?.[0] as { id: number, ingest_key: string }
  return { id: Number(row.id), ingest_key: row.ingest_key }
}

async function addMember(projectId: number, userId: number, role: 'admin' | 'member'): Promise<void> {
  await db.unsafe(
    `INSERT INTO project_members (project_id, user_id, email, role, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [projectId, userId, `member-${userId}@reportshq.test`, role],
  )
}

beforeAll(async () => {
  const owner = await makeUser('owner')
  const admin = await makeUser('admin')
  const member = await makeUser('member')
  const stranger = await makeUser('stranger')

  const project = await makeProject(`Access ${stamp}`, owner.id)
  const otherProject = await makeProject(`Other ${stamp}`, stranger.id)
  const deletedProject = await makeProject(`Deleted ${stamp}`, owner.id, true)

  await addMember(project.id, admin.id, 'admin')
  await addMember(project.id, member.id, 'member')

  f = { owner, admin, member, stranger, project, otherProject, deletedProject }
})

afterAll(async () => {
  for (const id of [f.project.id, f.otherProject.id, f.deletedProject.id])
    await db.unsafe(`DELETE FROM project_members WHERE project_id = $1`, [id])
  await db.unsafe(`DELETE FROM projects WHERE name LIKE $1`, [`%${stamp}`])
  await db.unsafe(`DELETE FROM users WHERE email LIKE $1`, [`%-${stamp}@reportshq.test`])
})

/** Whether the project currently builds reports on its own. */
async function autoReports(projectId: number): Promise<boolean> {
  const row = (await db.unsafe(`SELECT auto_reports_enabled FROM projects WHERE id = $1`, [projectId]))?.[0] as { auto_reports_enabled: number | boolean } | undefined
  return Boolean(row?.auto_reports_enabled)
}

describe('reading a project', () => {
  test('the owner can read it', async () => {
    expect(await canRead(f.owner, f.project.id)).toBeTrue()
  })

  test('an admin and a member can read it', async () => {
    expect(await canRead(f.admin, f.project.id)).toBeTrue()
    expect(await canRead(f.member, f.project.id)).toBeTrue()
  })

  test('a stranger cannot, even knowing the id', async () => {
    expect(await canRead(f.stranger, f.project.id)).toBeFalse()
    expect(await accessFor(f.stranger, f.project.id)).toBeNull()
  })

  test('an unauthenticated caller cannot', async () => {
    expect(await canRead(null, f.project.id)).toBeFalse()
    expect(await canRead({}, f.project.id)).toBeFalse()
    expect(await canRead({ id: 0 }, f.project.id)).toBeFalse()
  })

  test('a soft-deleted project reads as gone, even to its owner', async () => {
    // Otherwise "delete" means "hidden from the list but still readable by id",
    // which is not what anyone pressing delete believes it means.
    expect(await canRead(f.owner, f.deletedProject.id)).toBeFalse()
  })

  test('a project id that does not exist is refused, not thrown', async () => {
    expect(await canRead(f.owner, 999999)).toBeFalse()
  })
})

describe('roles', () => {
  test('the owner is reported as owner without holding a seat row', async () => {
    // The owner is projects.owner_id, never a project_members row. A check
    // written only against the seat table locks owners out of their own work.
    const seats = await db.unsafe(
      `SELECT COUNT(*) AS n FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [f.project.id, f.owner.id],
    ) as Array<{ n: number }>

    expect(Number(seats[0]?.n)).toBe(0)

    const access = await accessFor(f.owner, f.project.id)
    expect(access?.role).toBe('owner')
    expect(access?.isOwner).toBeTrue()
  })

  test('an admin may administer, a member may not', async () => {
    expect(await canAdminister(f.admin, f.project.id)).toBeTrue()
    expect(await canAdminister(f.member, f.project.id)).toBeFalse()
  })

  test('only the owner is the owner', async () => {
    expect(await isOwner(f.owner, f.project.id)).toBeTrue()
    expect(await isOwner(f.admin, f.project.id)).toBeFalse()
    expect(await isOwner(f.member, f.project.id)).toBeFalse()
    expect(await isOwner(f.stranger, f.project.id)).toBeFalse()
  })

  test('a seat on one project grants nothing on another', async () => {
    expect(await canRead(f.member, f.otherProject.id)).toBeFalse()
    expect(await canAdminister(f.admin, f.otherProject.id)).toBeFalse()
  })
})

describe('listing projects', () => {
  test('owned and joined projects are both listed, once each', async () => {
    const forOwner = await projectsFor(f.owner)
    const ids = forOwner.map(row => Number(row.id))

    expect(ids).toContain(f.project.id)
    expect(ids.filter(id => id === f.project.id)).toHaveLength(1)

    const forMember = (await projectsFor(f.member)).map(row => Number(row.id))
    expect(forMember).toContain(f.project.id)
    expect(forMember).not.toContain(f.otherProject.id)
  })

  test('soft-deleted projects are not listed', async () => {
    const ids = (await projectsFor(f.owner)).map(row => Number(row.id))
    expect(ids).not.toContain(f.deletedProject.id)
  })

  test('the role travels with each row', async () => {
    const row = (await projectsFor(f.admin)).find(entry => Number(entry.id) === f.project.id)
    expect(row?.role).toBe('admin')
  })

  test('an unauthenticated caller gets an empty list, not everything', async () => {
    expect(await projectsFor(null)).toHaveLength(0)
  })
})

describe('ingest keys', () => {
  test('a valid key resolves to its project', async () => {
    const project = await projectForIngestKey(f.project.ingest_key)
    expect(Number(project?.id)).toBe(f.project.id)
  })

  test('surrounding whitespace is tolerated, because headers carry it', async () => {
    const project = await projectForIngestKey(`  ${f.project.ingest_key}\n`)
    expect(Number(project?.id)).toBe(f.project.id)
  })

  test('an unknown, empty or partial key resolves to nothing', async () => {
    expect(await projectForIngestKey('rhq_not_a_real_key')).toBeNull()
    expect(await projectForIngestKey('')).toBeNull()
    expect(await projectForIngestKey('   ')).toBeNull()
    expect(await projectForIngestKey(f.project.ingest_key.slice(0, 12))).toBeNull()
  })

  test('a soft-deleted project stops accepting its key', async () => {
    const deleted = (await db.unsafe(`SELECT ingest_key FROM projects WHERE id = $1`, [f.deletedProject.id]))?.[0] as { ingest_key: string }
    expect(await projectForIngestKey(deleted.ingest_key)).toBeNull()
  })

  test('keys are unique across projects', async () => {
    // The database, not the application, is what guarantees this: a duplicate
    // key would mean two tenants writing into one project.
    //
    // Awaited inside the assertion rather than handed to `.rejects` as a bare
    // call: db.unsafe returns a lazy thenable, so `.rejects` would receive the
    // un-executed query object and pass without ever touching the database.
    let failed = false
    try {
      await db.unsafe(
        `INSERT INTO projects (name, ingest_key, owner_id, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [`Dup ${stamp}`, f.project.ingest_key, f.owner.id],
      )
    }
    catch {
      failed = true
    }

    expect(failed).toBeTrue()
  })
})

describe('project settings', () => {
  test('an owner can turn automatic reports off and on', async () => {
    await setAutoReports(f.owner, f.project.id, false)
    expect(await autoReports(f.project.id)).toBeFalse()

    await setAutoReports(f.owner, f.project.id, true)
    expect(await autoReports(f.project.id)).toBeTrue()
  })

  test('an admin can too', async () => {
    await setAutoReports(f.admin, f.project.id, false)
    expect(await autoReports(f.project.id)).toBeFalse()
    await setAutoReports(f.owner, f.project.id, true)
  })

  test('a member cannot', async () => {
    // A member reads reports. Deciding whether the product creates them is
    // administration.
    expect(setAutoReports(f.member, f.project.id, false)).rejects.toThrow()
    expect(await autoReports(f.project.id)).toBeTrue()
  })

  test('a stranger cannot, and the project is untouched', async () => {
    expect(setAutoReports(f.stranger, f.project.id, false)).rejects.toThrow()
    expect(await autoReports(f.project.id)).toBeTrue()
  })
})
