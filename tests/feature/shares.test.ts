/**
 * Public share links.
 *
 * The most exposed surface in the product: opened by people with no account, no
 * session and no relationship to the project. Most of these tests are about
 * what a token must **not** buy, because that is the part that cannot be
 * checked by looking at the page.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { LimitReached } from '../../app/Billing/gates'
import { PLANS } from '../../app/Billing/limits'
import { addBlock, createReport, publishReport } from '../../app/Reports/reports'
import { createShare, recordView, revokeShare, rotateShare, shareByToken, sharesFor } from '../../app/Reports/shares'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number
let reportId: number
let draftId: number

beforeAll(async () => {
  const email = `shares-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'pro', CURRENT_TIMESTAMP)`,
    ['shares owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }

  projectId = Number((await createProject(owner, { name: `Shares ${stamp}`, timezone: 'UTC' })).id)

  reportId = Number((await createReport(projectId, owner, { name: `Shared ${stamp}` })).id)
  await addBlock(reportId, {
    kind: 'big_number',
    title: 'Revenue',
    layout: { x: 0, y: 0, w: 3, h: 3 },
    query: { events: [], measure: 'count', filters: [] },
  })
  await publishReport(reportId, owner)

  draftId = Number((await createReport(projectId, owner, { name: `Unpublished ${stamp}` })).id)
})

afterAll(async () => {
  await db.unsafe(`DELETE FROM report_shares WHERE report_id IN ($1, $2)`, [reportId, draftId])
  for (const id of [reportId, draftId]) {
    await db.unsafe(`DELETE FROM report_revisions WHERE report_id = $1`, [id])
    await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1`, [id])
  }
  await db.unsafe(`DELETE FROM reports WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

beforeEach(async () => {
  await db.unsafe(`DELETE FROM report_shares WHERE report_id IN ($1, $2)`, [reportId, draftId])
  await db.unsafe(`UPDATE users SET plan = 'pro' WHERE id = $1`, [owner.id])
})

describe('creating a share', () => {
  test('a published report can be shared', async () => {
    const share = await createShare(projectId, reportId, owner)

    expect(String(share.token).length).toBeGreaterThan(30)
    expect(await shareByToken(String(share.token))).not.toBeNull()
  })

  test('an unpublished report cannot be', async () => {
    // A draft is by definition something nobody has decided to show anyone,
    // and a share link is the most public thing in the product.
    expect(createShare(projectId, draftId, owner)).rejects.toThrow(/Publish this report/)
  })

  test('a report from another project cannot be', async () => {
    expect(createShare(999_999, reportId, owner)).rejects.toThrow(/not found/i)
  })

  test('tokens are long and unique', async () => {
    const first = await createShare(projectId, reportId, owner)
    const second = await createShare(projectId, reportId, owner)

    expect(first.token).not.toBe(second.token)
    // 128 bits is not a number anybody guesses; this asserts we did not
    // shorten it to something friendlier at some point.
    expect(String(first.token).length).toBeGreaterThanOrEqual(32)
  })

  test('branding cannot be removed by asking on a plan that does not include it', async () => {
    await db.unsafe(`UPDATE users SET plan = 'free' WHERE id = $1`, [owner.id])

    const share = await createShare(projectId, reportId, owner, { showBranding: false })

    // Otherwise a Pro feature is a matter of sending a different JSON body.
    expect(Boolean(share.show_branding)).toBeTrue()
  })

  test('branding can be removed where the plan includes it', async () => {
    const share = await createShare(projectId, reportId, owner, { showBranding: false })
    expect(Boolean(share.show_branding)).toBeFalse()
  })

  test('sharing is refused past the plan\'s link allowance', async () => {
    await db.unsafe(`UPDATE users SET plan = 'free' WHERE id = $1`, [owner.id])

    await createShare(projectId, reportId, owner)

    // Free carries one link.
    const second = createShare(projectId, reportId, owner)
    expect(second).rejects.toThrow(LimitReached)
    expect(second).rejects.toThrow(new RegExp(`covers ${PLANS.free.shares} share link`))
  })
})

describe('resolving a token', () => {
  test('an unknown token resolves to nothing', async () => {
    expect(await shareByToken('not-a-real-token')).toBeNull()
    expect(await shareByToken('')).toBeNull()
  })

  test('an absurdly long token is refused rather than queried', async () => {
    expect(await shareByToken('x'.repeat(500))).toBeNull()
  })

  test('a revoked link stops working on the next request', async () => {
    const share = await createShare(projectId, reportId, owner)
    expect(await shareByToken(String(share.token))).not.toBeNull()

    await revokeShare(projectId, Number(share.id))

    // Immediately, not after a cache expires.
    expect(await shareByToken(String(share.token))).toBeNull()
  })

  test('an expired link stops working', async () => {
    const share = await createShare(projectId, reportId, owner, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    expect(await shareByToken(String(share.token))).toBeNull()
  })

  test('a link with an expiry in the future still works', async () => {
    const share = await createShare(projectId, reportId, owner, {
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })

    expect(await shareByToken(String(share.token))).not.toBeNull()
  })

  test('unpublishing the report kills its links', async () => {
    // Pulling a report back into draft is withdrawing it, and the link should
    // agree without anybody having to remember to revoke it.
    const share = await createShare(projectId, reportId, owner)
    await db.unsafe(`UPDATE reports SET status = 'draft' WHERE id = $1`, [reportId])

    expect(await shareByToken(String(share.token))).toBeNull()

    await db.unsafe(`UPDATE reports SET status = 'published' WHERE id = $1`, [reportId])
  })

  test('deleting the report kills its links', async () => {
    const share = await createShare(projectId, reportId, owner)
    await db.unsafe(`UPDATE reports SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [reportId])

    expect(await shareByToken(String(share.token))).toBeNull()

    await db.unsafe(`UPDATE reports SET deleted_at = NULL WHERE id = $1`, [reportId])
  })

  test('deleting the project kills its links', async () => {
    const share = await createShare(projectId, reportId, owner)
    await db.unsafe(`UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [projectId])

    expect(await shareByToken(String(share.token))).toBeNull()

    await db.unsafe(`UPDATE projects SET deleted_at = NULL WHERE id = $1`, [projectId])
  })
})

describe('what a token must not expose', () => {
  test('the resolved share carries nothing about the project but what it must', async () => {
    const share = await createShare(projectId, reportId, owner)
    const resolved = await shareByToken(String(share.token))!

    // The whole security model in one assertion: a flat, known set of fields.
    // A caller handed the project row would eventually render something from
    // it, and the ingest key lives on that row.
    expect(Object.keys(resolved!).sort()).toEqual([
      'defaultRange',
      'projectId',
      'reportDescription',
      'reportId',
      'reportName',
      'shareId',
      'showBranding',
      'timezone',
    ])
  })

  test('no ingest key, project name, or owner reaches the resolved shape', async () => {
    const share = await createShare(projectId, reportId, owner)
    const resolved = await shareByToken(String(share.token))

    const serialised = JSON.stringify(resolved)
    const project = (await db.unsafe(`SELECT name, ingest_key FROM projects WHERE id = $1`, [projectId]))?.[0] as { name: string, ingest_key: string }

    expect(serialised).not.toContain(project.ingest_key)
    expect(serialised).not.toContain('rhq_')
    expect(serialised).not.toContain(project.name)
    expect(serialised).not.toContain(String(owner.id === 0 ? 'x' : `"ownerId"`))
  })
})

describe('managing shares', () => {
  test('rotating changes the token and breaks the old link', async () => {
    const share = await createShare(projectId, reportId, owner)
    const original = String(share.token)

    const rotated = await rotateShare(projectId, Number(share.id))

    expect(rotated).not.toBe(original)
    expect(await shareByToken(original)).toBeNull()
    expect(await shareByToken(String(rotated))).not.toBeNull()
  })

  test('another project cannot revoke or rotate a link', async () => {
    const share = await createShare(projectId, reportId, owner)

    expect(await revokeShare(999_999, Number(share.id))).toBeFalse()
    expect(await rotateShare(999_999, Number(share.id))).toBeNull()
    // Still live.
    expect(await shareByToken(String(share.token))).not.toBeNull()
  })

  test('revoking something already revoked reports that it did nothing', async () => {
    const share = await createShare(projectId, reportId, owner)

    expect(await revokeShare(projectId, Number(share.id))).toBeTrue()
    expect(await revokeShare(projectId, Number(share.id))).toBeFalse()
  })

  test('the list shows revoked links too, so a withdrawal stays answerable', async () => {
    const share = await createShare(projectId, reportId, owner)
    await revokeShare(projectId, Number(share.id))

    const listed = await sharesFor(reportId)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.revoked_at).toBeTruthy()
  })

  test('views are counted', async () => {
    const share = await createShare(projectId, reportId, owner)

    await recordView(Number(share.id))
    await recordView(Number(share.id))

    const rows = await db.unsafe(`SELECT view_count FROM report_shares WHERE id = $1`, [share.id]) as Array<{ view_count: number }>
    expect(Number(rows[0]?.view_count)).toBe(2)
  })

  test('counting a view that cannot be counted does not throw', async () => {
    // Never worth failing somebody's page load over.
    expect(recordView(999_999)).resolves.toBeUndefined()
  })
})
