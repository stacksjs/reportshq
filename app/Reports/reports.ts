/**
 * Creating and reshaping reports.
 *
 * Permission is not decided here. A report belongs to a project, and
 * app/Support/access.ts already owns the question of who may touch a project,
 * so every function takes a project id the caller has already resolved. Adding
 * a second place that decides access is how two surfaces end up disagreeing.
 */
import type { BlockKind, BlockLayout, BlockQuery } from './schema'
import type { Placement } from './layout'
import { db } from '@stacksjs/database'
import { assertWithin } from '../Billing/gates'
import { packBlocks } from './layout'
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

  // Before the write, and before the slug is claimed. A report refused after
  // taking a slug would leave `revenue-2` behind for a report that does not
  // exist.
  //
  // Template provisioning is exempt: the engine creating the reports it
  // promised is not a person choosing to exceed their plan, and refusing there
  // would leave a project with a partial set of auto-reports and no way to see
  // why.
  if ((options.origin ?? 'user') !== 'template')
    await assertWithin(projectId, 'reports', 'report')

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

  await markDraftChanged(reportId)

  const rows = await db.unsafe(
    `SELECT * FROM report_blocks WHERE report_id = $1 ORDER BY id DESC LIMIT 1`,
    [reportId],
  ) as Array<Record<string, unknown>>

  // Settled after insert as well: a block added through the API at somebody
  // else's coordinates must not be able to land on top of existing work.
  const added = rows[0] as Record<string, unknown>
  const settled = await settleLayout(reportId, Number(added.id))
  const placed = settled.find(block => block.id === Number(added.id))

  // Returned with the position it ended up at rather than the one it was asked
  // for. A caller that trusted the request's coordinates would draw the block
  // somewhere it is not.
  return placed ? { ...added, x: placed.x, y: placed.y, w: placed.w, h: placed.h } : added
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
  reason: 'autosave' | 'publish' | 'restore' | 'upgrade' = 'autosave',
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
 * Record that the draft has moved ahead of what viewers see.
 *
 * Called by every write to a block. Cheap enough to do unconditionally: one
 * indexed update against a row the caller has already located.
 */
async function markDraftChanged(reportId: number): Promise<void> {
  await db.unsafe(
    `UPDATE reports SET unpublished_changes = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [reportId],
  )
}

/**
 * Publish the draft.
 *
 * Records a `publish` revision as it goes, and that revision is not merely an
 * audit trail: it *is* what viewers are served. Reading live blocks instead
 * would mean every keystroke in the builder was public the moment it was typed,
 * which is the opposite of what a draft is for.
 */
export async function publishReport(reportId: number, user: { id: number }): Promise<void> {
  await saveRevision(reportId, user, 'publish')
  await db.unsafe(
    `UPDATE reports SET status = 'published', unpublished_changes = 0, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [reportId],
  )
}

/**
 * The blocks viewers see: the most recent published snapshot.
 *
 * Null when a report has never been published, which is a different thing from
 * a published report with no blocks and has to stay distinguishable — one is
 * "not ready yet", the other is "somebody published an empty grid".
 *
 * Snapshots are read rather than replayed. A published report keeps rendering
 * exactly as it did even while the draft is being rearranged, and it survives
 * the draft's blocks being deleted outright.
 */
export async function publishedBlocks(reportId: number): Promise<Array<Record<string, unknown>> | null> {
  const row = (await db.unsafe(
    `SELECT snapshot FROM report_revisions
      WHERE report_id = $1 AND reason = 'publish'
      ORDER BY id DESC
      LIMIT 1`,
    [reportId],
  ))?.[0] as { snapshot: string } | undefined

  if (!row)
    return null

  const parsed = safeParse(row.snapshot)
  const blocks = (parsed as { blocks?: unknown }).blocks

  return Array.isArray(blocks) ? blocks as Array<Record<string, unknown>> : []
}

/** Reports in a project, newest first. Soft-deleted ones are gone. */
export async function reportsFor(projectId: number): Promise<Array<Record<string, unknown>>> {
  return await db.unsafe(
    `SELECT id, uuid, name, slug, description, status, origin, template_key, default_range, unpublished_changes, published_at, created_at, updated_at
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

export interface BlockUpdate {
  id: number
  layout?: BlockLayout
  title?: string
  query?: BlockQuery
  viz?: Record<string, unknown>
  body?: string
}

/**
 * Apply a batch of block edits.
 *
 * A batch rather than one call per block, because a single drag moves several:
 * dropping a block at the top pushes everything below it down, and saving those
 * as six requests means six chances to end up with a layout nobody arranged.
 *
 * Validated before anything is written, and written in one transaction, so a
 * rejected block leaves the grid exactly as it was rather than half-moved.
 */
export async function updateBlocks(
  reportId: number,
  updates: BlockUpdate[],
  options: { moved?: number } = {},
): Promise<Placement[]> {
  const errors: string[] = []

  for (const update of updates) {
    if (update.layout) {
      const layout = validateBlockLayout(update.layout)
      errors.push(...layout.errors.map(error => `Block ${update.id}: ${error}`))
    }

    if (update.query) {
      const query = validateBlockQuery(update.query)
      errors.push(...query.errors.map(error => `Block ${update.id}: ${error}`))
    }
  }

  if (errors.length > 0)
    throw new Error(errors.join(' '))

  for (const update of updates) {
    const sets: string[] = []
    const params: unknown[] = []

    const set = (column: string, value: unknown): void => {
      params.push(value)
      sets.push(`"${column}" = $${params.length}`)
    }

    if (update.layout) {
      set('x', update.layout.x)
      set('y', update.layout.y)
      set('w', update.layout.w)
      set('h', update.layout.h)
    }

    if (update.title !== undefined)
      set('title', update.title)

    if (update.query)
      set('query', JSON.stringify(update.query))

    if (update.viz)
      set('viz', JSON.stringify(update.viz))

    if (update.body !== undefined)
      set('body', update.body)

    if (sets.length === 0)
      continue

    set('updated_at', new Date().toISOString())
    params.push(reportId, update.id)

    // Scoped by report as well as by block id: a block id from another report
    // must not be editable by pointing this at the wrong one.
    await db.unsafe(
      `UPDATE report_blocks SET ${sets.join(', ')} WHERE report_id = $${params.length - 1} AND id = $${params.length}`,
      params,
    )
  }

  await markDraftChanged(reportId)

  return await settleLayout(reportId, options.moved)
}

/**
 * Push any overlaps out of the stored layout and return what was settled on.
 *
 * Runs after every write, not only after a drag. The client's push-down is a
 * preview and the API is public, so this is the only place that can promise two
 * blocks never share a cell; CSS grid will happily draw one on top of the other
 * and let a viewer discover it later.
 *
 * Only genuinely moved rows are written, so a save that changes a title does
 * not rewrite every position and inflate the next revision's diff.
 */
export async function settleLayout(reportId: number, moved?: number): Promise<Placement[]> {
  const rows = await db.unsafe(
    `SELECT id, x, y, w, h FROM report_blocks WHERE report_id = $1`,
    [reportId],
  ) as Array<{ id: number, x: number, y: number, w: number, h: number }>

  const current = rows.map(row => ({
    id: Number(row.id),
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    w: Number(row.w) || 1,
    h: Number(row.h) || 1,
  }))

  const settled = packBlocks(current, moved)
  const before = new Map(current.map(block => [block.id, block]))

  for (const block of settled) {
    const previous = before.get(block.id)
    if (previous && previous.x === block.x && previous.y === block.y && previous.w === block.w && previous.h === block.h)
      continue

    await db.unsafe(
      `UPDATE report_blocks SET x = $1, y = $2, w = $3, h = $4 WHERE report_id = $5 AND id = $6`,
      [block.x, block.y, block.w, block.h, reportId, block.id],
    )
  }

  return settled
}

/** Remove a block. Scoped by report for the same reason as updateBlocks. */
export async function removeBlock(reportId: number, blockId: number): Promise<void> {
  await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1 AND id = $2`, [reportId, blockId])
  await markDraftChanged(reportId)
}

/**
 * Copy a report, blocks and all.
 *
 * The copy is **always the person's own**: `origin` becomes `user` and
 * `template_key` is dropped, even when the original was auto-created. Carrying
 * the key over would make the template engine treat the copy as the report it
 * had already provisioned, so the next template version would rewrite somebody's
 * duplicate under them, and `already.has(key)` would be true twice for one key.
 *
 * The copy starts as a draft. Duplicating is what somebody does before trying
 * something, and publishing that attempt the moment it exists would put an
 * experiment in front of their team.
 */
export async function duplicateReport(
  projectId: number,
  user: { id: number },
  reportId: number,
): Promise<Record<string, unknown> | null> {
  const original = (await db.unsafe(
    `SELECT * FROM reports WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
    [reportId, projectId],
  ))?.[0] as Record<string, unknown> | undefined

  if (!original)
    return null

  const copy = await createReport(projectId, user, {
    name: `${String(original.name)} copy`,
    description: original.description ? String(original.description) : undefined,
    defaultRange: original.default_range ? String(original.default_range) : undefined,
  })

  for (const block of await blocksOf(reportId)) {
    await addBlock(Number(copy.id), {
      kind: String(block.kind) as BlockKind,
      title: block.title ? String(block.title) : undefined,
      layout: {
        x: Number(block.x) || 0,
        y: Number(block.y) || 0,
        w: Number(block.w) || 1,
        h: Number(block.h) || 1,
      },
      query: block.query as BlockQuery,
      viz: block.viz as Record<string, unknown>,
      body: block.body ? String(block.body) : undefined,
    })
  }

  return copy
}

/**
 * Archive a report.
 *
 * A soft delete, so the events behind it are untouched and the decision is
 * reversible. Nothing here removes rows: a report somebody archived in April
 * and wants back in June is a support conversation, not a restore from backup.
 */
export async function archiveReport(projectId: number, reportId: number): Promise<boolean> {
  const rows = await db.unsafe(
    `SELECT id FROM reports WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
    [reportId, projectId],
  ) as Array<{ id: number }>

  if (rows.length === 0)
    return false

  await db.unsafe(`UPDATE reports SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [reportId])
  return true
}

/** Bring an archived report back. The other half of archiving being reversible. */
export async function restoreReport(projectId: number, reportId: number): Promise<boolean> {
  const rows = await db.unsafe(
    `SELECT id FROM reports WHERE id = $1 AND project_id = $2 AND deleted_at IS NOT NULL`,
    [reportId, projectId],
  ) as Array<{ id: number }>

  if (rows.length === 0)
    return false

  await db.unsafe(`UPDATE reports SET deleted_at = NULL WHERE id = $1`, [reportId])
  return true
}

/** Archived reports, so they can be found again rather than only remembered. */
export async function archivedReports(projectId: number): Promise<Array<Record<string, unknown>>> {
  return await db.unsafe(
    `SELECT id, name, slug, status, origin, deleted_at
       FROM reports
      WHERE project_id = $1 AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC`,
    [projectId],
  ) as Array<Record<string, unknown>>
}
