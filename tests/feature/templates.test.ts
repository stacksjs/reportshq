/**
 * Auto-created reports.
 *
 * The behaviour that matters is not that a report gets made; it is that it gets
 * made exactly once, that a deleted one stays deleted, and that a template is
 * never offered before the events it needs have arrived. Each of those failing
 * is a product that argues with the person using it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { storeEvents } from '../../app/Events/ingest'
import { runQuery } from '../../app/Reports/engine'
import { addBlock, blocksOf, createReport, publishedBlocks, publishReport, reportsFor, saveRevision, updateBlocks } from '../../app/Reports/reports'
import { availableTemplates, provisionTemplates, TEMPLATES, upgradableReports, upgradeTemplateReport } from '../../app/Reports/templates'
import { validateBlockLayout, validateBlockQuery } from '../../app/Reports/schema'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
const projects: number[] = []

async function project(name: string): Promise<number> {
  const created = await createProject(owner, { name: `${name} ${stamp}`, timezone: 'UTC' })
  projects.push(Number(created.id))
  return Number(created.id)
}

const yesterday = new Date(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) + 'T12:00:00.000Z').toISOString()

beforeAll(async () => {
  const email = `templates-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    ['templates owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }
})

afterAll(async () => {
  for (const id of projects) {
    const reports = await db.unsafe(`SELECT id FROM reports WHERE project_id = $1`, [id]) as Array<{ id: number }>
    for (const report of reports) {
      await db.unsafe(`DELETE FROM report_revisions WHERE report_id = $1`, [report.id])
      await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1`, [report.id])
    }
    await db.unsafe(`DELETE FROM reports WHERE project_id = $1`, [id])
    await db.unsafe(`DELETE FROM rollup_states WHERE project_id = $1`, [id])
    await db.unsafe(`DELETE FROM event_rollups WHERE project_id = $1`, [id])
    await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [id])
  }
  if (projects.length > 0)
    await db.unsafe(`DELETE FROM projects WHERE id IN (${projects.map((_, i) => `$${i + 1}`).join(', ')})`, projects)
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

describe('the templates themselves', () => {
  test('every block would be accepted by the engine', () => {
    // A template ships as JSON in the repository, so nothing validates it at
    // write time the way a builder edit is validated. If one of these is
    // malformed, the first person to find out is a customer whose auto-report
    // renders an error.
    for (const template of TEMPLATES) {
      for (const block of template.blocks) {
        expect(validateBlockLayout(block.layout).valid).toBeTrue()

        if (block.kind !== 'text')
          expect(validateBlockQuery(block.query).valid).toBeTrue()
      }
    }
  })

  test('every block sits inside the grid and none overlap', () => {
    for (const template of TEMPLATES) {
      const occupied = new Set<string>()

      for (const block of template.blocks) {
        const { x, y, w, h } = block.layout
        expect(x + w).toBeLessThanOrEqual(12)

        for (let column = x; column < x + w; column++) {
          for (let row = y; row < y + h; row++) {
            const cell = `${column},${row}`
            // Overlapping blocks in a shipped template would arrive stacked on
            // top of each other, which reads as a broken report rather than a
            // layout to adjust.
            expect(occupied.has(cell)).toBeFalse()
            occupied.add(cell)
          }
        }
      }
    }
  })

  test('keys are unique and stable-looking', () => {
    const keys = TEMPLATES.map(template => template.key)
    expect(new Set(keys).size).toBe(keys.length)

    for (const key of keys)
      expect(key).toMatch(/^[a-z][a-z0-9.]*$/)
  })

  test('every template requires at least one event', () => {
    // A template with no requirements would be created for every project the
    // moment it received anything at all.
    for (const template of TEMPLATES)
      expect(template.requires.length).toBeGreaterThan(0)
  })
})

describe('provisioning', () => {
  test('a project with no events gets nothing', async () => {
    const id = await project('Empty')
    const result = await provisionTemplates(id, owner)

    expect(result.created).toHaveLength(0)
    expect(await reportsFor(id)).toHaveLength(0)
  })

  test('a template appears once its required events arrive', async () => {
    const id = await project('Commerce')

    expect(await availableTemplates(id)).toHaveLength(0)

    await storeEvents(id, [
      { name: 'commerce.order.created', occurred_at: yesterday, value: 40, user_key: 'a', session_key: 's1' },
      { name: 'commerce.order.created', occurred_at: yesterday, value: 60, user_key: 'b', session_key: 's2' },
    ])

    expect(await availableTemplates(id)).toContain('commerce.overview')

    const result = await provisionTemplates(id, owner)
    expect(result.created).toContain('commerce.overview')

    const reports = await reportsFor(id)
    const overview = reports.find(report => report.template_key === 'commerce.overview')
    expect(overview?.origin).toBe('template')
    // Published immediately: a report that appeared on its own and then asked
    // to be published would be a chore nobody asked for.
    expect(overview?.status).toBe('published')
  })

  test('the report it creates renders real numbers, not empty blocks', async () => {
    const id = await project('Numbers')
    await storeEvents(id, [
      { name: 'commerce.order.created', occurred_at: yesterday, value: 25, user_key: 'a', session_key: 's1' },
      { name: 'commerce.order.created', occurred_at: yesterday, value: 75, user_key: 'b', session_key: 's2' },
    ])

    await provisionTemplates(id, owner)

    const report = (await reportsFor(id)).find(entry => entry.template_key === 'commerce.overview')!
    const blocks = await blocksOf(Number(report.id))
    const revenue = blocks.find(block => block.title === 'Revenue')!

    const result = await runQuery({
      projectId: id,
      timezone: 'UTC',
      range: 'last_7_days',
      query: revenue.query as never,
    })

    // The whole promise of the feature: it is right when you first look at it.
    expect(result.total).toBe(100)
  })

  test('running twice does not create a second copy', async () => {
    const id = await project('Twice')
    await storeEvents(id, [{ name: 'commerce.order.created', occurred_at: yesterday, value: 10 }])

    await provisionTemplates(id, owner)
    const second = await provisionTemplates(id, owner)

    expect(second.created).toHaveLength(0)

    const overviews = (await reportsFor(id)).filter(report => report.template_key === 'commerce.overview')
    expect(overviews).toHaveLength(1)
  })

  test('a deleted template report stays deleted', async () => {
    const id = await project('Deleted')
    await storeEvents(id, [{ name: 'commerce.order.created', occurred_at: yesterday, value: 10 }])
    await provisionTemplates(id, owner)

    const report = (await reportsFor(id)).find(entry => entry.template_key === 'commerce.overview')!
    await db.unsafe(`UPDATE reports SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [report.id])

    // More events arrive, which is exactly when a naive implementation would
    // helpfully re-create it. Deleting it said something.
    await storeEvents(id, [{ name: 'commerce.order.created', occurred_at: yesterday, value: 99 }])
    const result = await provisionTemplates(id, owner)

    expect(result.created).not.toContain('commerce.overview')
    expect((await reportsFor(id)).filter(entry => entry.template_key === 'commerce.overview')).toHaveLength(0)
  })

  test('a project can turn auto-reports off', async () => {
    const id = await project('Disabled')
    await db.unsafe(`UPDATE projects SET auto_reports_enabled = 0 WHERE id = $1`, [id])
    await storeEvents(id, [{ name: 'commerce.order.created', occurred_at: yesterday, value: 10 }])

    const result = await provisionTemplates(id, owner)

    expect(result.created).toHaveLength(0)
    expect(await reportsFor(id)).toHaveLength(0)
  })

  test('only the templates whose events arrived are created', async () => {
    const id = await project('Users only')
    await storeEvents(id, [
      { name: 'user.registered', occurred_at: yesterday, user_key: 'a' },
      { name: 'user.login', occurred_at: yesterday, user_key: 'a' },
    ])

    const result = await provisionTemplates(id, owner)

    expect(result.created).toContain('users')
    // No orders, so nothing commerce-shaped: four empty blocks read as broken
    // rather than as waiting.
    expect(result.created).not.toContain('commerce.overview')
    expect(result.created).not.toContain('customers')
  })

  test('a second template appears later, without disturbing the first', async () => {
    const id = await project('Growing')
    await storeEvents(id, [{ name: 'user.registered', occurred_at: yesterday, user_key: 'a' }])
    await provisionTemplates(id, owner)

    await storeEvents(id, [{ name: 'commerce.order.created', occurred_at: yesterday, value: 20, user_key: 'a' }])
    const later = await provisionTemplates(id, owner)

    expect(later.created).toContain('commerce.overview')

    const keys = (await reportsFor(id)).map(report => report.template_key)
    expect(keys).toContain('users')
    expect(keys).toContain('commerce.overview')
  })

  test('a project that does not exist is a no-op rather than a throw', async () => {
    const result = await provisionTemplates(999_999, owner)
    expect(result.created).toHaveLength(0)
  })
})

describe('template versions', () => {
  /** Read from the shipped template, so a future version bump does not fail these. */
  const overview = TEMPLATES.find(entry => entry.key === 'commerce.overview')!

  /** Pretend the shipped template moved on, without editing the shipped file. */
  async function pinToOlderVersion(reportId: number): Promise<void> {
    await db.unsafe(`UPDATE reports SET template_version = $1 WHERE id = $2`, [overview.version - 1, reportId])
  }

  async function provisionedOverview(name: string): Promise<{ project: number, report: number }> {
    const id = await project(name)
    await storeEvents(id, [{ name: 'commerce.order.created', occurred_at: yesterday, value: 10 }])
    await provisionTemplates(id, owner)
    const report = (await reportsFor(id)).find(entry => entry.template_key === 'commerce.overview')!
    return { project: id, report: Number(report.id) }
  }

  test('a report on the current version is not a candidate', async () => {
    const { project: id } = await provisionedOverview('Current')
    expect(await upgradableReports(id)).toHaveLength(0)
  })

  test('an older report is offered, and says it can be done automatically', async () => {
    const { project: id, report } = await provisionedOverview('Older')
    await pinToOlderVersion(report)

    const candidates = await upgradableReports(id)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.key).toBe('commerce.overview')
    expect(candidates[0]!.to).toBe(overview.version)
    expect(candidates[0]!.automatic).toBeTrue()
  })

  test('an untouched report is upgraded, and its blocks come back as the template defines them', async () => {
    const { report } = await provisionedOverview('Untouched')
    await pinToOlderVersion(report)
    // Something the template does not define, to prove the rewrite is a
    // replacement rather than a merge.
    await addBlock(report, { kind: 'text', layout: { x: 0, y: 20, w: 12, h: 1 }, body: 'stale' })

    const result = await upgradeTemplateReport(report, owner)
    expect(result.upgraded).toBeTrue()

    const blocks = await blocksOf(report)
    expect(blocks).toHaveLength(overview.blocks.length)
    expect(blocks.some(block => block.body === 'stale')).toBeFalse()

    const row = (await db.unsafe(`SELECT template_version FROM reports WHERE id = $1`, [report]))?.[0] as { template_version: number }
    expect(Number(row.template_version)).toBe(overview.version)
  })

  test('the layout that was replaced is still restorable', async () => {
    // An automatic change nobody asked for must not also be irreversible.
    const { report } = await provisionedOverview('Restorable')
    await pinToOlderVersion(report)
    await upgradeTemplateReport(report, owner)

    const revisions = await db.unsafe(
      `SELECT reason FROM report_revisions WHERE report_id = $1 ORDER BY id`,
      [report],
    ) as Array<{ reason: string }>

    expect(revisions.map(revision => revision.reason)).toContain('upgrade')
  })

  test('an edited report is left alone', async () => {
    const { project: id, report } = await provisionedOverview('Edited')
    await pinToOlderVersion(report)

    // What the builder writes the moment somebody moves a block.
    await saveRevision(report, owner, 'autosave')
    await updateBlocks(report, [{ id: Number((await blocksOf(report))[0]!.id), title: 'Mine' }])

    const result = await upgradeTemplateReport(report, owner)
    expect(result.upgraded).toBeFalse()
    expect(result.reason).toBe('edited')

    // Still listed, so the person can see why theirs differs from a colleague's.
    const candidates = await upgradableReports(id)
    expect(candidates[0]!.automatic).toBeFalse()

    expect((await blocksOf(report)).some(block => block.title === 'Mine')).toBeTrue()
  })

  test('an edited report can be upgraded when it is explicitly asked for', async () => {
    const { report } = await provisionedOverview('Forced')
    await pinToOlderVersion(report)
    await saveRevision(report, owner, 'autosave')

    const result = await upgradeTemplateReport(report, owner, { force: true })
    expect(result.upgraded).toBeTrue()
  })

  test('provisioning upgrades untouched reports and skips edited ones', async () => {
    const { project: id, report } = await provisionedOverview('Sweep')
    await pinToOlderVersion(report)

    const first = await provisionTemplates(id, owner)
    expect(first.upgraded).toContain('commerce.overview')

    // And again: the engine's own revision must not make the report look edited.
    await pinToOlderVersion(report)
    const second = await provisionTemplates(id, owner)
    expect(second.upgraded).toContain('commerce.overview')
  })

  test('upgrading twice in a row is a no-op the second time', async () => {
    const { report } = await provisionedOverview('Twice upgraded')
    await pinToOlderVersion(report)

    expect((await upgradeTemplateReport(report, owner)).upgraded).toBeTrue()
    const again = await upgradeTemplateReport(report, owner)
    expect(again.upgraded).toBeFalse()
    expect(again.reason).toBe('up-to-date')
  })

  test('a report that is not from a template is never upgraded', async () => {
    const id = await project('Handmade')
    const report = await createReport(id, owner, { name: 'Mine' })

    const result = await upgradeTemplateReport(Number(report.id), owner)
    expect(result.upgraded).toBeFalse()
    expect(result.reason).toBe('unknown-template')
    expect(await upgradableReports(id)).toHaveLength(0)
  })

  test('an upgraded report reaches viewers, not just the draft', async () => {
    // Viewers read the last published snapshot. An upgrade that rewrote only
    // the draft would leave the report claiming the new version while still
    // rendering the old one to everyone.
    const { report } = await provisionedOverview('Republished')
    await pinToOlderVersion(report)
    await addBlock(report, { kind: 'text', layout: { x: 0, y: 30, w: 12, h: 1 }, body: 'stale' })
    await publishReport(report, owner)

    expect((await publishedBlocks(report))!.some(block => block.body === 'stale')).toBeTrue()

    await upgradeTemplateReport(report, owner, { force: true })

    const published = await publishedBlocks(report)
    expect(published!.some(block => block.body === 'stale')).toBeFalse()
    expect(published).toHaveLength(overview.blocks.length)
  })

  test('an unpublished template report is not published by an upgrade', async () => {
    const { report } = await provisionedOverview('Still draft')
    await db.unsafe(`UPDATE reports SET status = 'draft' WHERE id = $1`, [report])
    await pinToOlderVersion(report)

    await upgradeTemplateReport(report, owner)

    const rows = await db.unsafe(`SELECT status FROM reports WHERE id = $1`, [report]) as Array<{ status: string }>
    // Publishing a draft somebody had not finished would be a louder mistake
    // than a late upgrade.
    expect(rows[0]?.status).toBe('draft')
  })

  test('a deleted report is not upgraded', async () => {
    const { project: id, report } = await provisionedOverview('Deleted upgrade')
    await pinToOlderVersion(report)
    await db.unsafe(`UPDATE reports SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [report])

    expect(await upgradableReports(id)).toHaveLength(0)
    expect((await upgradeTemplateReport(report, owner)).upgraded).toBeFalse()
  })
})
