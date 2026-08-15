/**
 * Reports that build themselves.
 *
 * A template is a report definition keyed on event names. When a project starts
 * sending events a template recognises, the report is provisioned with real
 * numbers already in it. That is the product's central promise: integrate a
 * conventional app and the reports appear.
 *
 * Every block here is written against the taxonomy in docs/events.md, so a
 * template and the SDKs that feed it cannot drift: if a template needs a
 * property, the taxonomy has to document it first.
 */
import type { BlockInput } from './reports'
import { db } from '@stacksjs/database'
import { addBlock, createReport, publishReport, saveRevision } from './reports'

export interface ReportTemplate {
  /** Stable identity. Never renamed: it is how a provisioned report is matched. */
  key: string
  /** Bumped when the blocks change in a way an existing report should learn about. */
  version: number
  name: string
  description: string
  /**
   * Event names that must have been seen before this is offered.
   *
   * All of them, not any: a Commerce overview built from orders alone would
   * show four empty blocks and read as broken rather than as waiting.
   */
  requires: string[]
  blocks: BlockInput[]
}

/** A big number, since every template opens with a row of them. */
function metric(title: string, x: number, query: BlockInput['query'], compare = true): BlockInput {
  return {
    kind: 'big_number',
    title,
    layout: { x, y: 0, w: 3, h: 2 },
    query: { ...query!, compare },
  }
}

export const TEMPLATES: ReportTemplate[] = [
  {
    key: 'commerce.overview',
    version: 1,
    name: 'Commerce overview',
    description: 'Revenue, orders and refunds across the period, and where checkout leaks.',
    requires: ['commerce.order.created'],
    blocks: [
      metric('Revenue', 0, { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [] }),
      metric('Orders', 3, { events: ['commerce.order.created'], measure: 'count', filters: [] }),
      {
        kind: 'big_number',
        title: 'Average order',
        layout: { x: 6, y: 0, w: 3, h: 2 },
        query: { events: ['commerce.order.created'], measure: 'avg', field: 'value', filters: [] },
      },
      metric('Refunded', 9, { events: ['commerce.order.refunded'], measure: 'sum', field: 'value', filters: [] }),
      {
        kind: 'area',
        title: 'Revenue per day',
        layout: { x: 0, y: 2, w: 8, h: 5 },
        query: { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [], grain: 'day', compare: true },
      },
      {
        kind: 'donut',
        title: 'Orders by plan',
        layout: { x: 8, y: 2, w: 4, h: 5 },
        query: { events: ['commerce.order.created'], measure: 'count', dimension: 'properties.plan', filters: [], limit: 4 },
      },
      {
        kind: 'funnel',
        title: 'Browse to order',
        layout: { x: 0, y: 7, w: 12, h: 4 },
        query: {
          events: [],
          measure: 'count',
          filters: [],
          steps: ['commerce.product.viewed', 'commerce.checkout.started', 'commerce.order.created'],
        },
      },
      {
        kind: 'text',
        layout: { x: 0, y: 11, w: 12, h: 1 },
        // The one sentence that stops the most misreadings of this report.
        body: 'Revenue counts orders created. Refunds are shown separately rather than netted off, so a refunded order still appears on the day it was placed.',
      },
    ],
  },

  {
    key: 'customers',
    version: 1,
    name: 'Customers',
    description: 'Who is buying, how many come back, and where they came from.',
    requires: ['commerce.order.created'],
    blocks: [
      metric('Buying customers', 0, { events: ['commerce.order.created'], measure: 'count_unique', filters: [] }),
      metric('Orders', 3, { events: ['commerce.order.created'], measure: 'count', filters: [] }),
      {
        kind: 'big_number',
        title: 'Revenue per customer',
        layout: { x: 6, y: 0, w: 3, h: 2 },
        query: { events: ['commerce.order.created'], measure: 'avg', field: 'value', filters: [] },
      },
      {
        kind: 'bar',
        title: 'Buying customers per day',
        layout: { x: 0, y: 2, w: 8, h: 5 },
        query: { events: ['commerce.order.created'], measure: 'count_unique', filters: [], grain: 'day' },
      },
      {
        kind: 'table',
        title: 'Orders by plan',
        layout: { x: 8, y: 2, w: 4, h: 5 },
        query: { events: ['commerce.order.created'], measure: 'count', dimension: 'properties.plan', filters: [], limit: 5 },
      },
    ],
  },

  {
    key: 'users',
    version: 1,
    name: 'Users',
    description: 'Signups, active users and how they arrive.',
    requires: ['user.registered'],
    blocks: [
      metric('New users', 0, { events: ['user.registered'], measure: 'count', filters: [] }),
      metric('Active users', 3, { events: ['user.login'], measure: 'count_unique', filters: [] }),
      {
        kind: 'bar',
        title: 'Signups per day',
        layout: { x: 0, y: 2, w: 8, h: 5 },
        query: { events: ['user.registered'], measure: 'count', filters: [], grain: 'day', compare: true },
      },
      {
        kind: 'table',
        title: 'Signups by source',
        layout: { x: 8, y: 2, w: 4, h: 5 },
        query: { events: ['user.registered'], measure: 'count', dimension: 'properties.source', filters: [], limit: 5 },
      },
      {
        kind: 'text',
        layout: { x: 0, y: 7, w: 12, h: 1 },
        body: 'Active users counts distinct user keys, so one person signing in twice counts once. Send a stable internal id as user_key for this to mean anything.',
      },
    ],
  },

  {
    key: 'content',
    version: 1,
    name: 'Content',
    description: 'What was published, and what was read.',
    requires: ['cms.post.published'],
    blocks: [
      metric('Published', 0, { events: ['cms.post.published'], measure: 'count', filters: [] }),
      metric('Views', 3, { events: ['cms.post.viewed'], measure: 'count', filters: [] }),
      {
        kind: 'line',
        title: 'Views per day',
        layout: { x: 0, y: 2, w: 8, h: 5 },
        query: { events: ['cms.post.viewed'], measure: 'count', filters: [], grain: 'day' },
      },
      {
        kind: 'table',
        title: 'Most read',
        layout: { x: 8, y: 2, w: 4, h: 5 },
        query: { events: ['cms.post.viewed'], measure: 'count', dimension: 'properties.post_id', filters: [], limit: 5 },
      },
    ],
  },
]

export interface ProvisionResult {
  created: string[]
  skipped: string[]
  /** Template keys whose existing report was rewritten onto a newer version. */
  upgraded: string[]
}

/**
 * Has a person edited this report?
 *
 * The engine may only rewrite reports nobody has touched, so this is the
 * question everything about upgrades turns on, and it is answered from the
 * revision log rather than from timestamps. `autosave` and `restore` are
 * written only by the builder, in response to somebody moving, configuring or
 * reverting something. `publish` is written by provisioning, and `upgrade` by
 * the engine itself, so neither counts as a human touching the report.
 *
 * Counting revisions instead would be wrong the moment the engine wrote its
 * own: the first upgrade would make the report look edited and every later one
 * would be refused.
 */
async function editedByHand(reportId: number): Promise<boolean> {
  const rows = await db.unsafe(
    `SELECT COUNT(*) AS touched FROM report_revisions
      WHERE report_id = $1 AND reason IN ('autosave', 'restore')`,
    [reportId],
  ) as Array<{ touched: number }>

  return Number(rows[0]?.touched ?? 0) > 0
}

export interface UpgradeCandidate {
  reportId: number
  key: string
  name: string
  from: number
  to: number
  /** False when somebody has edited the report, which makes it theirs. */
  automatic: boolean
}

/**
 * Reports sitting on an older version of their template.
 *
 * Read-only, and it reports the edited ones too. A person whose report was
 * excluded from an improvement should be able to find out that it was, rather
 * than wondering why their Commerce overview looks different from a colleague's.
 */
export async function upgradableReports(projectId: number): Promise<UpgradeCandidate[]> {
  const rows = await db.unsafe(
    `SELECT id, name, template_key, template_version FROM reports
      WHERE project_id = $1 AND template_key IS NOT NULL AND deleted_at IS NULL`,
    [projectId],
  ) as Array<{ id: number, name: string, template_key: string, template_version: number | null }>

  const candidates: UpgradeCandidate[] = []

  for (const row of rows) {
    const template = TEMPLATES.find(entry => entry.key === row.template_key)
    if (!template)
      continue

    const from = Number(row.template_version ?? 0)
    if (from >= template.version)
      continue

    candidates.push({
      reportId: Number(row.id),
      key: template.key,
      name: row.name,
      from,
      to: template.version,
      automatic: !(await editedByHand(Number(row.id))),
    })
  }

  return candidates
}

/**
 * Rewrite one report onto the current version of its template.
 *
 * A revision is written **before** the blocks are replaced, so the previous
 * layout stays restorable. That matters even for an untouched report: the
 * upgrade is the engine's judgement, not the person's, and an automatic change
 * that cannot be undone is a change nobody asked to be permanent.
 *
 * `force` is what an explicit "upgrade anyway" button passes. Without it an
 * edited report is left alone and the caller is told why, because overwriting
 * somebody's arrangement to deliver an improvement they did not ask for is the
 * product arguing with them again.
 */
export async function upgradeTemplateReport(
  reportId: number,
  user: { id: number },
  options: { force?: boolean } = {},
): Promise<{ upgraded: boolean, reason?: 'unknown-template' | 'up-to-date' | 'edited' }> {
  const row = (await db.unsafe(
    `SELECT id, template_key, template_version FROM reports WHERE id = $1 AND deleted_at IS NULL`,
    [reportId],
  ))?.[0] as { id: number, template_key: string | null, template_version: number | null } | undefined

  const template = TEMPLATES.find(entry => entry.key === row?.template_key)
  if (!row || !template)
    return { upgraded: false, reason: 'unknown-template' }

  if (Number(row.template_version ?? 0) >= template.version)
    return { upgraded: false, reason: 'up-to-date' }

  if (!options.force && await editedByHand(reportId))
    return { upgraded: false, reason: 'edited' }

  await saveRevision(reportId, user, 'upgrade')

  // Replaced wholesale rather than diffed. A template's blocks are defined as a
  // set, and matching old blocks to new ones by title or position would guess
  // at an intent the template never expressed; the revision above is what makes
  // the destructive version safe.
  await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1`, [reportId])

  for (const block of template.blocks)
    await addBlock(reportId, block)

  await db.unsafe(
    `UPDATE reports SET template_version = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [template.version, reportId],
  )

  return { upgraded: true }
}

/**
 * Provision every template a project now qualifies for.
 *
 * Idempotent, and permanently so. The check looks for a report carrying the
 * template key **including soft-deleted ones**, so a template that has already
 * been offered is never offered again. Somebody who deletes the Commerce
 * overview has said they do not want it; re-creating it on the next order would
 * be the product arguing with them.
 *
 * That also means `reports.template_key` is the ledger, and there is no second
 * table to keep in step with it.
 */
export async function provisionTemplates(
  projectId: number,
  user: { id: number },
): Promise<ProvisionResult> {
  const created: string[] = []
  const skipped: string[] = []
  const upgraded: string[] = []

  const settings = (await db.unsafe(
    `SELECT auto_reports_enabled FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [projectId],
  ))?.[0] as { auto_reports_enabled: number | boolean } | undefined

  if (!settings)
    return { created, skipped, upgraded }

  // A project can turn this off, and that decision is respected before any
  // work is done rather than after.
  if (!settings.auto_reports_enabled)
    return { created, skipped: TEMPLATES.map(template => template.key), upgraded }

  const seen = new Set(
    ((await db.unsafe(
      `SELECT DISTINCT name FROM events WHERE project_id = $1`,
      [projectId],
    )) as Array<{ name: string }>).map(row => row.name),
  )

  const already = new Set(
    ((await db.unsafe(
      // Deliberately not filtering deleted_at: a deleted template report still
      // counts as offered.
      `SELECT template_key FROM reports WHERE project_id = $1 AND template_key IS NOT NULL`,
      [projectId],
    )) as Array<{ template_key: string }>).map(row => row.template_key),
  )

  // Reports already provisioned may be sitting on an older template. An
  // untouched one is brought forward here, which is the only way a template
  // improvement ever reaches a customer who is not looking for it; an edited
  // one is left alone and surfaces through upgradableReports() instead.
  for (const candidate of await upgradableReports(projectId)) {
    if (!candidate.automatic)
      continue

    const result = await upgradeTemplateReport(candidate.reportId, user)
    if (result.upgraded)
      upgraded.push(candidate.key)
  }

  for (const template of TEMPLATES) {
    if (already.has(template.key)) {
      skipped.push(template.key)
      continue
    }

    if (!template.requires.every(name => seen.has(name))) {
      skipped.push(template.key)
      continue
    }

    const report = await createReport(
      projectId,
      user,
      { name: template.name, description: template.description },
      { origin: 'template', templateKey: template.key, templateVersion: template.version },
    )

    for (const block of template.blocks)
      await addBlock(Number(report.id), block)

    // Published immediately. A report that appeared on its own and then asked
    // to be published would be a chore the person did not ask for, and the
    // whole point is that it is ready when they look.
    await publishReport(Number(report.id), user)

    created.push(template.key)
  }

  return { created, skipped, upgraded }
}

/** Which templates a project would get, without creating anything. */
export async function availableTemplates(projectId: number): Promise<string[]> {
  const seen = new Set(
    ((await db.unsafe(
      `SELECT DISTINCT name FROM events WHERE project_id = $1`,
      [projectId],
    )) as Array<{ name: string }>).map(row => row.name),
  )

  return TEMPLATES.filter(template => template.requires.every(name => seen.has(name))).map(template => template.key)
}
