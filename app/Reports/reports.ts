/**
 * Creating and reshaping reports.
 *
 * Permission is not decided here. A report belongs to a project, and
 * app/Support/access.ts already owns the question of who may touch a project,
 * so every function takes a project id the caller has already resolved. Adding
 * a second place that decides access is how two surfaces end up disagreeing.
 */
import type { BlockKind, BlockLayout, BlockQuery } from './schema'
import { db } from '@stacksjs/database'
import { needsQuery, validateBlockLayout, validateBlockQuery } from './schema'

/**
 * How many autosaves a report keeps.
 *
 * Enough to undo a session's worth of mistakes, few enough that the revision
 * table does not outgrow the reports it describes. Publishes are kept beyond
 * this, because "restore what was last live" is a different promise from undo.
 */
export const MAX_AUTOSAVES = 30

export interface ReportInput {
  name: string
  description?: string
  defaultRange?: string
}

export interface BlockInput {
  kind: BlockKind
  title?: string
  layout: BlockLayout
  query?: BlockQuery
  viz?: Record<string, unknown>
  body?: string
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
 * A slug that is free within the project.
 *
 * Uniqueness is per project, not global, so two customers can both have a
 * "revenue" report. Collisions get a numeric suffix rather than a random one,
 * because `revenue-2` is a URL a person can read back to someone.
 */
async function availableSlug(projectId: number, name: string): Promise<string> {
  const base = slugify(name) || 'report'

  const taken = await db.unsafe(
    `SELECT slug FROM reports WHERE project_id = $1 AND slug LIKE $2`,
    [projectId, `${base}%`],
  ) as Array<{ slug: string }>

  const used = new Set(taken.map(row => row.slug))
  if (!used.has(base))
    return base

  for (let suffix = 2; suffix < 500; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate))
      return candidate
  }

  return `${base}-${globalThis.crypto.randomUUID().slice(0, 8)}`
}

export async function createReport(
  projectId: number,
  user: { id: number },
  input: ReportInput,
  options: { origin?: 'user' | 'template', templateKey?: string, templateVersion?: number } = {},
): Promise<Record<string, unknown>> {
  const name = String(input.name ?? '').trim()
  if (!name)
    throw new Error('A report needs a name.')

  const slug = await availableSlug(projectId, name)

  await db.unsafe(
    `INSERT INTO reports (project_id, name, slug, description, status, origin, template_key, template_version, default_range, created_by_id, created_at)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
    [
      projectId,
      name,
      slug,
      input.description ?? null,
      options.origin ?? 'user',
      options.templateKey ?? null,
      options.templateVersion ?? null,
      input.defaultRange ?? 'last_30_days',
      Number(user.id),
    ],
  )

  const row = (await db.unsafe(
    `SELECT * FROM reports WHERE project_id = $1 AND slug = $2`,
    [projectId, slug],
  ))?.[0]

  return row as Record<string, unknown>
}

/**
 * Add a block.
 *
 * Both halves are validated before anything is written, and the errors are
 * joined rather than thrown one at a time: a config panel that reports a
 * second problem only after the first is fixed is worse than one that reports
 * both.
 */
export async function addBlock(reportId: number, input: BlockInput): Promise<Record<string, unknown>> {
  const errors: string[] = []

  const layout = validateBlockLayout(input.layout)
  errors.push(...layout.errors)

  if (needsQuery(input.kind)) {
    const query = validateBlockQuery(input.query)
    errors.push(...query.errors)
  }

  if (errors.length > 0)
    throw new Error(errors.join(' '))

  await db.unsafe(
    `INSERT INTO report_blocks (report_id, kind, title, x, y, w, h, query, viz, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
    [
      reportId,
      input.kind,
      input.title ?? null,
      input.layout.x,
      input.layout.y,
      input.layout.w,
      input.layout.h,
      input.query ? JSON.stringify(input.query) : '{}',
      JSON.stringify(input.viz ?? {}),
      input.body ?? null,
    ],
  )

  const rows = await db.unsafe(
    `SELECT * FROM report_blocks WHERE report_id = $1 ORDER BY id DESC LIMIT 1`,
    [reportId],
  ) as Array<Record<string, unknown>>

  return rows[0] as Record<string, unknown>
}

export async function blocksOf(reportId: number): Promise<Array<Record<string, unknown>>> {
  const rows = await db.unsafe(
    // Reading order is the order a screen reader and a keyboard traverse the
    // grid, so it is top to bottom, then left to right, rather than by id.
    `SELECT * FROM report_blocks WHERE report_id = $1 ORDER BY y, x, id`,
    [reportId],
  ) as Array<Record<string, unknown>>

  return rows.map(row => ({
    ...row,
    query: safeParse(row.query),
    viz: safeParse(row.viz),
  }))
}

function safeParse(value: unknown): Record<string, unknown> {
  if (!value)
    return {}
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

/**
 * Snapshot the current layout.
 *
 * Autosaves are pruned to the most recent MAX_AUTOSAVES; publishes and
 * restores are kept, because they are the points a person actually wants to
 * return to, and there are few of them.
 */
export async function saveRevision(
  reportId: number,
  user: { id: number },
  reason: 'autosave' | 'publish' | 'restore' = 'autosave',
): Promise<void> {
  const blocks = await blocksOf(reportId)

  await db.unsafe(
    `INSERT INTO report_revisions (report_id, snapshot, reason, created_by_id, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [reportId, JSON.stringify({ blocks }), reason, Number(user.id)],
  )

  if (reason !== 'autosave')
    return

  // Prune by id rather than by timestamp: several autosaves can land in the
  // same second, and CURRENT_TIMESTAMP would order them arbitrarily.
  const stale = await db.unsafe(
    `SELECT id FROM report_revisions
      WHERE report_id = $1 AND reason = 'autosave'
      ORDER BY id DESC
      LIMIT -1 OFFSET $2`,
    [reportId, MAX_AUTOSAVES],
  ) as Array<{ id: number }>

  for (const row of stale)
    await db.unsafe(`DELETE FROM report_revisions WHERE id = $1`, [row.id])
}

/**
 * Publish the draft.
 *
 * Records a `publish` revision as it goes, so what viewers saw at a given time
 * is recoverable rather than only inferable from the current state.
 */
export async function publishReport(reportId: number, user: { id: number }): Promise<void> {
  await saveRevision(reportId, user, 'publish')
  await db.unsafe(
    `UPDATE reports SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [reportId],
  )
}

/** Reports in a project, newest first. Soft-deleted ones are gone. */
export async function reportsFor(projectId: number): Promise<Array<Record<string, unknown>>> {
  return await db.unsafe(
    `SELECT id, uuid, name, slug, description, status, origin, template_key, default_range, created_at, updated_at
       FROM reports
      WHERE project_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [projectId],
  ) as Array<Record<string, unknown>>
}

/**
 * A report by slug, within a project.
 *
 * Scoped by project on purpose: a slug is only unique inside one, so looking
 * one up without the project is a cross-tenant read waiting to happen.
 */
export async function reportBySlug(projectId: number, slug: string): Promise<Record<string, unknown> | null> {
  const row = (await db.unsafe(
    `SELECT * FROM reports WHERE project_id = $1 AND slug = $2 AND deleted_at IS NULL LIMIT 1`,
    [projectId, slug],
  ))?.[0]

  return row ?? null
}
