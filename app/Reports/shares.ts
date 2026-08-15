/**
 * Public, read-only links to one published report.
 *
 * A share token is opened by people with no account, which is the point, so it
 * carries the narrowest authority the product has: **one report's published
 * snapshot, and nothing around it.** Not the project, not its other reports,
 * not its members, and never its ingest key. Everything in this file is written
 * to make that true by construction rather than by remembering to check.
 *
 * Revoking sets a timestamp rather than deleting the row, so "this was shared
 * and then withdrawn" stays answerable. A deleted row makes a link that used to
 * work indistinguishable from one that never existed, which is the wrong answer
 * to give somebody asking why their bookmark broke.
 */
import { db } from '@stacksjs/database'
import { assertCan, assertWithin } from '../Billing/gates'
import { can } from '../Billing/limits'

export interface ShareInput {
  label?: string
  /** ISO timestamp. Absent means it does not expire on its own. */
  expiresAt?: string
  /** Pro can drop the footer. Anything else is forced back on. */
  showBranding?: boolean
}

/** A token that is not worth guessing: 128 bits, url safe. */
function newToken(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '') + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Create a share for a published report.
 *
 * Only published. A draft is by definition something nobody has decided to show
 * anyone, and a share link is the most public thing in the product; letting one
 * point at unpublished work is how a half-finished chart ends up in somebody's
 * board pack.
 */
export async function createShare(
  projectId: number,
  reportId: number,
  user: { id: number },
  input: ShareInput = {},
): Promise<Record<string, unknown>> {
  const rows = await db.unsafe(
    `SELECT id, status FROM reports WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
    [reportId, projectId],
  ) as Array<{ id: number, status: string }>

  const report = rows[0]
  if (!report)
    throw new Error('Report not found.')

  if (String(report.status) !== 'published')
    throw new Error('Publish this report before sharing it.')

  await assertCan(projectId, 'shares', 'Sharing a report')
  await assertWithin(projectId, 'shares', 'share link')

  // Branding is only removable where the plan allows it. Taking the flag from
  // the caller and trusting it would make a Pro feature a matter of sending a
  // different JSON body.
  const unbranded = input.showBranding === false && await allowsUnbranded(projectId)
  const token = newToken()

  await db.unsafe(
    `INSERT INTO report_shares (report_id, token, label, expires_at, show_branding, view_count, created_by_id, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, CURRENT_TIMESTAMP)`,
    [reportId, token, input.label ?? null, input.expiresAt ?? null, !unbranded, Number(user.id)],
  )

  const created = (await db.unsafe(`SELECT * FROM report_shares WHERE token = $1`, [token]))?.[0]
  return created as Record<string, unknown>
}

async function allowsUnbranded(projectId: number): Promise<boolean> {
  const rows = await db.unsafe(
    `SELECT u.plan AS plan FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [projectId],
  ) as Array<{ plan: string }>

  return can(rows[0]?.plan, 'unbranded')
}

export interface ResolvedShare {
  shareId: number
  reportId: number
  projectId: number
  reportName: string
  reportDescription: string
  defaultRange: string
  timezone: string
  showBranding: boolean
}

/**
 * Resolve a token to the one thing it may see.
 *
 * The single entry point for the public pages, and deliberately the only place
 * a token becomes a report. It returns a flat, minimal shape rather than the
 * rows it read: a caller handed the project row would eventually render
 * something from it, and the ingest key lives on that row.
 *
 * Null for revoked, expired, deleted or unpublished. A revoked link and a
 * link that never existed give the same answer, because telling them apart
 * tells somebody whether they once had access.
 */
export async function shareByToken(token: string): Promise<ResolvedShare | null> {
  const clean = String(token ?? '').trim()
  if (!clean || clean.length > 80)
    return null

  const rows = await db.unsafe(
    `SELECT s.id AS share_id, s.expires_at AS expires_at, s.revoked_at AS revoked_at,
            s.show_branding AS show_branding,
            r.id AS report_id, r.project_id AS project_id, r.name AS report_name,
            r.description AS report_description, r.status AS status,
            r.default_range AS default_range, r.deleted_at AS report_deleted,
            p.timezone AS timezone, p.deleted_at AS project_deleted
       FROM report_shares s
       JOIN reports r ON r.id = s.report_id
       JOIN projects p ON p.id = r.project_id
      WHERE s.token = $1`,
    [clean],
  ) as Array<Record<string, unknown>>

  const row = rows[0]
  if (!row)
    return null

  if (row.revoked_at)
    return null

  if (row.report_deleted || row.project_deleted)
    return null

  // A share of something since unpublished stops working. Somebody pulling a
  // report back into draft is withdrawing it, and the link should agree.
  if (String(row.status) !== 'published')
    return null

  if (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now())
    return null

  return {
    shareId: Number(row.share_id),
    reportId: Number(row.report_id),
    projectId: Number(row.project_id),
    reportName: String(row.report_name ?? ''),
    reportDescription: row.report_description ? String(row.report_description) : '',
    defaultRange: String(row.default_range ?? 'last_30_days'),
    timezone: String(row.timezone ?? 'UTC'),
    showBranding: Boolean(row.show_branding),
  }
}

/**
 * Note that somebody looked.
 *
 * Best effort and never awaited on the render path: a counter is not worth a
 * millisecond of somebody else's page load, and a failure to count is not a
 * reason to fail to show the report.
 */
export async function recordView(shareId: number): Promise<void> {
  try {
    await db.unsafe(
      `UPDATE report_shares SET view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [shareId],
    )
  }
  catch {
    // Deliberately swallowed. See above.
  }
}

/** Live shares for a report, for the management UI. */
export async function sharesFor(reportId: number): Promise<Array<Record<string, unknown>>> {
  return await db.unsafe(
    `SELECT id, token, label, expires_at, revoked_at, view_count, last_viewed_at, show_branding, created_at
       FROM report_shares
      WHERE report_id = $1
      ORDER BY created_at DESC`,
    [reportId],
  ) as Array<Record<string, unknown>>
}

/**
 * Revoke a link.
 *
 * Scoped by project as well as by id, so a share id from another tenant
 * resolves to nothing. Takes effect on the next request: `shareByToken` reads
 * `revoked_at` every time rather than caching the answer.
 */
export async function revokeShare(projectId: number, shareId: number): Promise<boolean> {
  const rows = await db.unsafe(
    `SELECT s.id AS id FROM report_shares s
       JOIN reports r ON r.id = s.report_id
      WHERE s.id = $1 AND r.project_id = $2 AND s.revoked_at IS NULL`,
    [shareId, projectId],
  ) as Array<{ id: number }>

  if (rows.length === 0)
    return false

  await db.unsafe(`UPDATE report_shares SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1`, [shareId])
  return true
}

/**
 * Rotate a link's token.
 *
 * The old URL stops working immediately, which is the point: rotating is what
 * somebody does when a link has gone somewhere it should not have.
 */
export async function rotateShare(projectId: number, shareId: number): Promise<string | null> {
  const rows = await db.unsafe(
    `SELECT s.id AS id FROM report_shares s
       JOIN reports r ON r.id = s.report_id
      WHERE s.id = $1 AND r.project_id = $2 AND s.revoked_at IS NULL`,
    [shareId, projectId],
  ) as Array<{ id: number }>

  if (rows.length === 0)
    return null

  const token = newToken()
  await db.unsafe(
    `UPDATE report_shares SET token = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [token, shareId],
  )

  return token
}
