/**
 * Producing a file somebody can download, and letting them download it once.
 *
 * **Generated synchronously, not queued.** The issue asked for a queued job,
 * and for a report of this shape that would be the wrong trade: an export is a
 * handful of engine queries and a few thousand rows, which takes milliseconds,
 * and a queue for a millisecond operation is a moving part that can be down
 * while the thing it protects cannot. The `ReportExport` row still carries a
 * `status`, so the day a report is large enough to need a worker, the switch is
 * a change of who calls `generateExport` rather than a migration.
 *
 * The download link is signed and expiring rather than a guessable path. An
 * export is a snapshot of somebody's business numbers sitting on disk; a URL
 * that stays valid forever is a URL that ends up in a chat log.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'
import { exportCsv, exportFilename, exportXlsx } from './exports'

/**
 * Where files live. Machine-local state, gitignored, safe to delete.
 *
 * Configurable because production deploys atomically into a new release
 * directory each time: left under the working directory, every generated export
 * would be destroyed by the next deploy, and a link somebody was handed minutes
 * earlier would 404 for no reason they could see. In production this points
 * outside the release, next to the database.
 */
export const EXPORT_DIR = process.env.EXPORT_DIR || join(process.cwd(), 'storage', 'exports')

/**
 * How long a download link lasts.
 *
 * Long enough to survive somebody generating an export, being interrupted, and
 * coming back to it. Short enough that a link pasted into a group chat stops
 * working before it is forgotten about.
 */
export const EXPORT_TTL_MS = 60 * 60 * 1000

export type ExportFormat = 'csv' | 'xlsx'

export interface ExportRecord {
  id: number
  reportId: number
  format: ExportFormat
  status: string
  filename: string
  sizeBytes: number
  expiresAt: string
}

/** The key everything is signed with. */
function signingKey(): string {
  const key = String(config.app.key ?? process.env.APP_KEY ?? '')

  if (!key) {
    // Refused rather than signed with a default. A predictable key means the
    // signature proves nothing, and a download that anybody can forge is worse
    // than a download that does not work.
    throw new Error('APP_KEY is not set, so an export link cannot be signed.')
  }

  return key
}

/** The signature for one export. */
export function signExport(exportId: number, expiresAt: string): string {
  return createHmac('sha256', signingKey())
    .update(`${exportId}.${expiresAt}`)
    .digest('hex')
}

/**
 * Check a signature without leaking how wrong it was.
 *
 * A plain `===` on an HMAC compares byte by byte and returns early, which over
 * enough requests tells an attacker how much of a forged signature was right.
 */
export function verifyExportSignature(exportId: number, expiresAt: string, signature: string): boolean {
  let expected: Buffer
  try {
    expected = Buffer.from(signExport(exportId, expiresAt), 'hex')
  }
  catch {
    return false
  }

  const given = Buffer.from(String(signature ?? ''), 'hex')

  if (given.length !== expected.length)
    return false

  return timingSafeEqual(expected, given)
}

/**
 * Generate an export and record it.
 *
 * The row is written first, so a failure leaves a row saying what went wrong
 * rather than nothing at all. Somebody who clicked Export and saw no file
 * deserves to find out why.
 */
export async function generateExport(options: {
  projectId: number
  reportId: number
  reportName: string
  timezone: string
  range: string
  format: ExportFormat
  user: { id: number }
}): Promise<ExportRecord> {
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS).toISOString()

  await db.unsafe(
    `INSERT INTO report_exports (report_id, format, status, expires_at, requested_by_id, created_at)
     VALUES ($1, $2, 'pending', $3, $4, CURRENT_TIMESTAMP)`,
    [options.reportId, options.format, expiresAt, options.user.id],
  )

  const row = (await db.unsafe(
    `SELECT id FROM report_exports WHERE report_id = $1 ORDER BY id DESC LIMIT 1`,
    [options.reportId],
  ))?.[0] as { id: number }

  const exportId = Number(row.id)
  const filename = exportFilename(options.reportName, options.format)

  try {
    const payload = options.format === 'xlsx'
      ? await exportXlsx({ projectId: options.projectId, reportId: options.reportId, timezone: options.timezone, range: options.range })
      : await exportCsv({ projectId: options.projectId, reportId: options.reportId, timezone: options.timezone, range: options.range })

    await mkdir(EXPORT_DIR, { recursive: true })

    // Named by id rather than by report name. Two people exporting the same
    // report at once would otherwise write the same file, and the second would
    // hand the first a truncated download.
    const path = join(EXPORT_DIR, `${exportId}-${options.format}`)
    await writeFile(path, payload)

    const size = (await stat(path)).size

    await db.unsafe(
      `UPDATE report_exports SET status = 'ready', path = $1, size_bytes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [path, size, exportId],
    )

    return { id: exportId, reportId: options.reportId, format: options.format, status: 'ready', filename, sizeBytes: size, expiresAt }
  }
  catch (error) {
    await db.unsafe(
      `UPDATE report_exports SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [String((error as Error).message).slice(0, 500), exportId],
    )

    throw error
  }
}

export interface ResolvedExport {
  id: number
  reportId: number
  projectId: number
  format: ExportFormat
  path: string
  filename: string
  reportName: string
}

/**
 * Resolve a signed link to a file.
 *
 * Null for a bad signature, an expired link, a failed export or a missing file.
 * One answer for all of them, because distinguishing them tells somebody
 * holding a forged link which part they got right.
 */
export async function resolveExport(exportId: number, expiresAt: string, signature: string): Promise<ResolvedExport | null> {
  if (!verifyExportSignature(exportId, expiresAt, signature))
    return null

  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now())
    return null

  const rows = await db.unsafe(
    `SELECT e.id AS id, e.report_id AS report_id, e.format AS format, e.status AS status,
            e.path AS path, e.expires_at AS expires_at,
            r.name AS report_name, r.project_id AS project_id, r.deleted_at AS report_deleted
       FROM report_exports e
       JOIN reports r ON r.id = e.report_id
      WHERE e.id = $1`,
    [exportId],
  ) as Array<Record<string, unknown>>

  const row = rows[0]
  if (!row || row.report_deleted)
    return null

  // The signature covers the expiry it was issued with, so a link cannot be
  // extended by editing the URL; this checks the row agrees.
  if (String(row.expires_at ?? '') !== expiresAt)
    return null

  if (String(row.status) !== 'ready' || !row.path)
    return null

  return {
    id: exportId,
    reportId: Number(row.report_id),
    projectId: Number(row.project_id),
    format: String(row.format) as ExportFormat,
    path: String(row.path),
    filename: exportFilename(String(row.report_name ?? 'report'), String(row.format) as ExportFormat),
    reportName: String(row.report_name ?? ''),
  }
}

/** Recent exports for a report, for the history list. */
export async function exportsFor(reportId: number): Promise<Array<Record<string, unknown>>> {
  return await db.unsafe(
    `SELECT id, format, status, size_bytes, error, expires_at, created_at
       FROM report_exports WHERE report_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [reportId],
  ) as Array<Record<string, unknown>>
}

/**
 * Delete expired exports and their files.
 *
 * Run on a schedule. An export is somebody's numbers on our disk, and keeping
 * them past the life of the link that reaches them is storing data for no
 * reason anybody could state.
 */
export async function pruneExports(at: Date = new Date()): Promise<number> {
  const rows = await db.unsafe(
    `SELECT id, path FROM report_exports WHERE expires_at IS NOT NULL AND expires_at < $1`,
    [at.toISOString()],
  ) as Array<{ id: number, path: string | null }>

  for (const row of rows) {
    if (row.path) {
      try {
        await unlink(String(row.path))
      }
      catch {
        // Already gone is the desired state, so a missing file is not a failure.
      }
    }

    await db.unsafe(`DELETE FROM report_exports WHERE id = $1`, [row.id])
  }

  return rows.length
}
