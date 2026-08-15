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
import { addBlock, createReport, publishReport } from './reports'

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
  options: { now?: Date } = {},
): Promise<ProvisionResult> {
  const created: string[] = []
  const skipped: string[] = []

  const settings = (await db.unsafe(
    `SELECT auto_reports_enabled FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [projectId],
  ))?.[0] as { auto_reports_enabled: number | boolean } | undefined

  if (!settings)
    return { created, skipped }

  // A project can turn this off, and that decision is respected before any
  // work is done rather than after.
  if (!settings.auto_reports_enabled)
    return { created, skipped: TEMPLATES.map(template => template.key) }

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

  return { created, skipped }
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
