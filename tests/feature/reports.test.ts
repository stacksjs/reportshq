/**
 * The report domain: block config validation, and the operations that write it.
 *
 * The validation half matters most. A block config is JSON in a column, JSON on
 * the wire, and JSON in a shipped template, and it names fields that reach a
 * query builder. It is the one place in this product where "whatever the client
 * sent" would otherwise flow toward SQL.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { hasOverlap } from '../../app/Reports/layout'
import { addBlock, archiveReport, archivedReports, blocksOf, createReport, duplicateReport, MAX_AUTOSAVES, publishedBlocks, publishReport, removeBlock, reportBySlug, reportsFor, restoreReport, saveRevision, settleLayout, updateBlocks } from '../../app/Reports/reports'
import { GRID_COLUMNS, isAllowedField, MAX_SERIES, validateBlockLayout, validateBlockQuery } from '../../app/Reports/schema'
import { createProject } from '../../app/Support/projects'

const stamp = Date.now()
let owner: { id: number }
let projectId: number
let otherProjectId: number

beforeAll(async () => {
  const email = `reports-owner-${stamp}@reportshq.test`
  await db.unsafe(
    // On Pro, so a fixture building a dozen reports is testing reports rather
    // than testing the free plan's limits. limits.test.ts sets its own tier.
    `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'pro', CURRENT_TIMESTAMP)`,
    ['reports owner', email, 'not-a-real-hash'],
  )
  const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
  owner = { id: Number(row.id) }

  projectId = Number((await createProject(owner, { name: `Reports ${stamp}` })).id)
  otherProjectId = Number((await createProject(owner, { name: `Reports other ${stamp}` })).id)
})

afterAll(async () => {
  for (const id of [projectId, otherProjectId]) {
    const reports = await db.unsafe(`SELECT id FROM reports WHERE project_id = $1`, [id]) as Array<{ id: number }>
    for (const report of reports) {
      await db.unsafe(`DELETE FROM report_revisions WHERE report_id = $1`, [report.id])
      await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1`, [report.id])
    }
    await db.unsafe(`DELETE FROM reports WHERE project_id = $1`, [id])
  }
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id IN ($1, $2)`, [projectId, otherProjectId])
  await db.unsafe(`DELETE FROM projects WHERE id IN ($1, $2)`, [projectId, otherProjectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
})

describe('fields a block may name', () => {
  test('the event columns are allowed', () => {
    for (const field of ['name', 'user_key', 'session_key', 'value', 'currency', 'occurred_at'])
      expect(isAllowedField(field)).toBeTrue()
  })

  test('anything under properties is allowed, because the bag is the customer\'s', () => {
    expect(isAllowedField('properties.plan')).toBeTrue()
    expect(isAllowedField('properties.utm_source')).toBeTrue()
  })

  test('an unknown bare column is refused', () => {
    // An allowlist rather than a pattern: these names reach a query builder,
    // and "anything that looks like an identifier" is how a column name
    // becomes an injection point the day the query is built with a template
    // string instead.
    expect(isAllowedField('password')).toBeFalse()
    expect(isAllowedField('users.email')).toBeFalse()
    expect(isAllowedField('id')).toBeFalse()
  })

  test('quotes and backslashes are refused inside a property key', () => {
    expect(isAllowedField('properties.a"b')).toBeFalse()
    expect(isAllowedField('properties.a\'b')).toBeFalse()
    expect(isAllowedField('properties.a\\b')).toBeFalse()
  })

  test('an empty or over-long property key is refused', () => {
    expect(isAllowedField('properties.')).toBeFalse()
    expect(isAllowedField(`properties.${'k'.repeat(65)}`)).toBeFalse()
  })
})

describe('validating a block query', () => {
  const valid = { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day' }

  test('a well-formed query passes', () => {
    expect(validateBlockQuery(valid).valid).toBeTrue()
  })

  test('an unknown measure is refused, and the message lists the real ones', () => {
    const result = validateBlockQuery({ ...valid, measure: 'median' })
    expect(result.valid).toBeFalse()
    expect(result.errors[0]).toContain('count_unique')
  })

  test('sum and avg require a field to operate on', () => {
    expect(validateBlockQuery({ ...valid, measure: 'sum' }).errors[0]).toContain('needs a `field`')
    expect(validateBlockQuery({ ...valid, measure: 'avg', field: 'value' }).valid).toBeTrue()
  })

  test('a field that cannot be read is refused', () => {
    const result = validateBlockQuery({ ...valid, measure: 'sum', field: 'users.password' })
    expect(result.valid).toBeFalse()
  })

  test('a dimension is checked the same way as a field', () => {
    expect(validateBlockQuery({ ...valid, dimension: 'properties.plan' }).valid).toBeTrue()
    expect(validateBlockQuery({ ...valid, dimension: 'secret_column' }).valid).toBeFalse()
  })

  test('every problem is reported at once, not just the first', () => {
    // A config panel that surfaces a second error only after the first is
    // fixed is a worse experience than one that shows both.
    const result = validateBlockQuery({ events: 'nope', measure: 'median', grain: 'fortnight' })
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })

  test('filters are checked field by field', () => {
    expect(validateBlockQuery({ ...valid, filters: [{ field: 'name', operator: 'is', value: 'a' }] }).valid).toBeTrue()
    expect(validateBlockQuery({ ...valid, filters: [{ field: 'nope', operator: 'is', value: 'a' }] }).valid).toBeFalse()
    expect(validateBlockQuery({ ...valid, filters: [{ field: 'name', operator: 'sorta', value: 'a' }] }).valid).toBeFalse()
  })

  test('a filter that needs a value must have one', () => {
    const result = validateBlockQuery({ ...valid, filters: [{ field: 'name', operator: 'is' }] })
    expect(result.errors[0]).toContain('needs a value')
  })

  test('exists takes no value, and saying otherwise is an error', () => {
    expect(validateBlockQuery({ ...valid, filters: [{ field: 'user_key', operator: 'exists' }] }).valid).toBeTrue()
    expect(validateBlockQuery({ ...valid, filters: [{ field: 'user_key', operator: 'exists', value: 'x' }] }).valid).toBeFalse()
  })

  test('the series limit is bounded', () => {
    expect(validateBlockQuery({ ...valid, limit: MAX_SERIES }).valid).toBeTrue()
    expect(validateBlockQuery({ ...valid, limit: MAX_SERIES + 1 }).valid).toBeFalse()
    expect(validateBlockQuery({ ...valid, limit: 0 }).valid).toBeFalse()
    expect(validateBlockQuery({ ...valid, limit: 2.5 }).valid).toBeFalse()
  })

  test('a funnel needs at least two steps', () => {
    expect(validateBlockQuery({ ...valid, steps: ['a'] }).valid).toBeFalse()
    expect(validateBlockQuery({ ...valid, steps: ['a', 'b'] }).valid).toBeTrue()
  })

  test('a non-object is refused rather than throwing', () => {
    expect(validateBlockQuery(null).valid).toBeFalse()
    expect(validateBlockQuery('count').valid).toBeFalse()
    expect(validateBlockQuery([]).valid).toBeFalse()
  })
})

describe('validating a block layout', () => {
  test('a block inside the grid passes', () => {
    expect(validateBlockLayout({ x: 0, y: 0, w: 6, h: 4 }).valid).toBeTrue()
    expect(validateBlockLayout({ x: 6, y: 2, w: 6, h: 4 }).valid).toBeTrue()
  })

  test('a block that runs off the right edge is named precisely', () => {
    // This is the shape a drag produces at the edge, so the message says what
    // happened rather than blaming `x`.
    const result = validateBlockLayout({ x: 8, y: 0, w: 6, h: 4 })
    expect(result.valid).toBeFalse()
    expect(result.errors[0]).toContain(`${GRID_COLUMNS} columns`)
  })

  test('zero and negative sizes are refused', () => {
    expect(validateBlockLayout({ x: 0, y: 0, w: 0, h: 4 }).valid).toBeFalse()
    expect(validateBlockLayout({ x: 0, y: 0, w: 6, h: 0 }).valid).toBeFalse()
    expect(validateBlockLayout({ x: -1, y: 0, w: 6, h: 4 }).valid).toBeFalse()
  })

  test('fractional grid units are refused', () => {
    expect(validateBlockLayout({ x: 0.5, y: 0, w: 6, h: 4 }).valid).toBeFalse()
  })
})

describe('creating reports', () => {
  test('a report gets a readable slug', async () => {
    const report = await createReport(projectId, owner, { name: 'Revenue overview' })
    expect(report.slug).toBe('revenue-overview')
    expect(report.status).toBe('draft')
    expect(report.origin).toBe('user')
  })

  test('a colliding name gets a readable suffix, not a random one', async () => {
    const second = await createReport(projectId, owner, { name: 'Revenue overview' })
    expect(second.slug).toBe('revenue-overview-2')
  })

  test('slugs are unique per project, so two customers can both have one', async () => {
    const elsewhere = await createReport(otherProjectId, owner, { name: 'Revenue overview' })
    expect(elsewhere.slug).toBe('revenue-overview')
  })

  test('a report with no name is refused', async () => {
    await expect(createReport(projectId, owner, { name: '  ' })).rejects.toThrow('needs a name')
  })

  test('lookup by slug is scoped to the project', async () => {
    const mine = await reportBySlug(projectId, 'revenue-overview')
    expect(Number(mine?.project_id)).toBe(projectId)

    // The same slug exists in the other project and must not leak across.
    const theirs = await reportBySlug(otherProjectId, 'revenue-overview')
    expect(Number(theirs?.project_id)).toBe(otherProjectId)
    expect(Number(theirs?.id)).not.toBe(Number(mine?.id))
  })

  test('a template report records where it came from', async () => {
    const report = await createReport(
      projectId,
      owner,
      { name: 'Commerce overview' },
      { origin: 'template', templateKey: 'commerce.overview', templateVersion: 1 },
    )

    expect(report.origin).toBe('template')
    expect(report.template_key).toBe('commerce.overview')
    expect(Number(report.template_version)).toBe(1)
  })
})

describe('blocks', () => {
  let reportId: number

  beforeAll(async () => {
    reportId = Number((await createReport(projectId, owner, { name: `Blocks ${stamp}` })).id)
  })

  test('a valid block is stored with its query intact', async () => {
    const block = await addBlock(reportId, {
      kind: 'line',
      title: 'Orders per day',
      layout: { x: 0, y: 0, w: 6, h: 4 },
      query: { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day' },
    })

    expect(block.kind).toBe('line')

    const blocks = await blocksOf(reportId)
    const stored = blocks.find(entry => Number(entry.id) === Number(block.id))
    expect((stored?.query as Record<string, unknown>).measure).toBe('count')
  })

  test('an invalid query is refused before anything is written', async () => {
    const before = (await blocksOf(reportId)).length

    await expect(addBlock(reportId, {
      kind: 'bar',
      layout: { x: 0, y: 4, w: 6, h: 4 },
      query: { events: [], measure: 'sum', filters: [] } as never,
    })).rejects.toThrow('needs a `field`')

    expect((await blocksOf(reportId)).length).toBe(before)
  })

  test('an invalid layout is refused too', async () => {
    await expect(addBlock(reportId, {
      kind: 'line',
      layout: { x: 10, y: 0, w: 6, h: 4 },
      query: { events: [], measure: 'count', filters: [] },
    })).rejects.toThrow('12 columns')
  })

  test('a text block needs no query', async () => {
    const block = await addBlock(reportId, {
      kind: 'text',
      layout: { x: 0, y: 8, w: 12, h: 2 },
      body: 'Revenue excludes refunds.',
    })

    expect(block.kind).toBe('text')
  })

  test('blocks read back in grid order, not insertion order', async () => {
    const top = await addBlock(reportId, {
      kind: 'big_number',
      layout: { x: 6, y: 0, w: 3, h: 2 },
      query: { events: [], measure: 'count', filters: [] },
    })

    const blocks = await blocksOf(reportId)
    const ids = blocks.map(block => Number(block.id))

    // The one at y=0 comes before the text block at y=8, despite being added
    // after it: reading order is how a keyboard and a screen reader traverse.
    expect(ids.indexOf(Number(top.id))).toBeLessThan(ids.length - 1)
    expect(blocks.map(block => Number(block.y))).toEqual([...blocks.map(block => Number(block.y))].sort((a, b) => a - b))
  })
})

describe('revisions', () => {
  let reportId: number

  beforeAll(async () => {
    reportId = Number((await createReport(projectId, owner, { name: `Revisions ${stamp}` })).id)
    await addBlock(reportId, {
      kind: 'line',
      layout: { x: 0, y: 0, w: 6, h: 4 },
      query: { events: [], measure: 'count', filters: [] },
    })
  })

  test('a revision captures the whole layout', async () => {
    await saveRevision(reportId, owner)

    const rows = await db.unsafe(
      `SELECT snapshot FROM report_revisions WHERE report_id = $1 ORDER BY id DESC LIMIT 1`,
      [reportId],
    ) as Array<{ snapshot: string }>

    expect(JSON.parse(rows[0]!.snapshot).blocks).toHaveLength(1)
  })

  test('autosaves are pruned to the cap', async () => {
    for (let i = 0; i < MAX_AUTOSAVES + 12; i++)
      await saveRevision(reportId, owner)

    const rows = await db.unsafe(
      `SELECT COUNT(*) AS n FROM report_revisions WHERE report_id = $1 AND reason = 'autosave'`,
      [reportId],
    ) as Array<{ n: number }>

    expect(Number(rows[0]?.n)).toBe(MAX_AUTOSAVES)
  })

  test('publishes survive the pruning that trims autosaves', async () => {
    await publishReport(reportId, owner)

    for (let i = 0; i < MAX_AUTOSAVES + 5; i++)
      await saveRevision(reportId, owner)

    const rows = await db.unsafe(
      `SELECT COUNT(*) AS n FROM report_revisions WHERE report_id = $1 AND reason = 'publish'`,
      [reportId],
    ) as Array<{ n: number }>

    // "Restore what was last live" is a different promise from undo, and there
    // are few of these, so they are not pruned.
    expect(Number(rows[0]?.n)).toBe(1)
  })

  test('publishing moves the report out of draft', async () => {
    const rows = await db.unsafe(`SELECT status FROM reports WHERE id = $1`, [reportId]) as Array<{ status: string }>
    expect(rows[0]?.status).toBe('published')
  })
})

describe('listing reports', () => {
  test('lists only this project, newest first', async () => {
    const reports = await reportsFor(projectId)
    expect(reports.length).toBeGreaterThan(0)

    const elsewhere = await reportsFor(otherProjectId)
    const mine = new Set(reports.map(report => Number(report.id)))
    expect(elsewhere.every(report => !mine.has(Number(report.id)))).toBeTrue()
  })

  test('a soft-deleted report drops out of the list', async () => {
    const report = await createReport(projectId, owner, { name: `Temporary ${stamp}` })
    await db.unsafe(`UPDATE reports SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [report.id])

    const ids = (await reportsFor(projectId)).map(entry => Number(entry.id))
    expect(ids).not.toContain(Number(report.id))
  })
})

describe('draft and published are different things', () => {
  let reportId: number

  async function flag(): Promise<boolean> {
    const rows = await db.unsafe(
      `SELECT unpublished_changes FROM reports WHERE id = $1`,
      [reportId],
    ) as Array<{ unpublished_changes: number | boolean }>

    return Boolean(rows[0]?.unpublished_changes)
  }

  beforeAll(async () => {
    reportId = Number((await createReport(projectId, owner, { name: `Draft split ${stamp}` })).id)
  })

  test('a report nobody has published serves nothing to viewers', async () => {
    await addBlock(reportId, {
      kind: 'big_number',
      title: 'First',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      query: { events: [], measure: 'count', filters: [] },
    })

    // Null, not []. "Never published" and "published an empty grid" are
    // different answers and the viewer says something different for each.
    expect(await publishedBlocks(reportId)).toBeNull()
  })

  test('adding a block marks the draft as ahead', async () => {
    expect(await flag()).toBeTrue()
  })

  test('publishing serves the draft and clears the flag', async () => {
    await publishReport(reportId, owner)

    const published = await publishedBlocks(reportId)
    expect(published).toHaveLength(1)
    expect(published![0]!.title).toBe('First')
    expect(await flag()).toBeFalse()
  })

  test('publishing stamps when it happened', async () => {
    const rows = await db.unsafe(`SELECT published_at FROM reports WHERE id = $1`, [reportId]) as Array<{ published_at: string | null }>
    expect(rows[0]?.published_at).toBeTruthy()
  })

  test('editing after publishing does not change what viewers see', async () => {
    const blocks = await blocksOf(reportId)
    await updateBlocks(reportId, [{ id: Number(blocks[0]!.id), title: 'Renamed mid-edit' }])

    // The draft moved. The published snapshot did not, which is the entire
    // reason a draft exists: a teammate opening this mid-edit gets the last
    // thing that was deliberately published.
    expect((await blocksOf(reportId))[0]!.title).toBe('Renamed mid-edit')
    expect((await publishedBlocks(reportId))![0]!.title).toBe('First')
    expect(await flag()).toBeTrue()
  })

  test('publishing again catches viewers up', async () => {
    await publishReport(reportId, owner)

    expect((await publishedBlocks(reportId))![0]!.title).toBe('Renamed mid-edit')
    expect(await flag()).toBeFalse()
  })

  test('deleting every block does not empty the published report', async () => {
    for (const block of await blocksOf(reportId))
      await removeBlock(reportId, Number(block.id))

    expect(await blocksOf(reportId)).toHaveLength(0)
    // Snapshots are read, not replayed, so what was published survives the
    // draft being emptied out from under it.
    expect(await publishedBlocks(reportId)).toHaveLength(1)
    expect(await flag()).toBeTrue()
  })

  test('an empty grid can be published, and reads as empty rather than absent', async () => {
    await publishReport(reportId, owner)
    expect(await publishedBlocks(reportId)).toEqual([])
  })
})

describe('the stored layout can never overlap', () => {
  let reportId: number

  async function layout(): Promise<Array<{ id: number, x: number, y: number, w: number, h: number }>> {
    return (await blocksOf(reportId)).map(block => ({
      id: Number(block.id),
      x: Number(block.x),
      y: Number(block.y),
      w: Number(block.w),
      h: Number(block.h),
    }))
  }

  beforeAll(async () => {
    reportId = Number((await createReport(projectId, owner, { name: `Packing ${stamp}` })).id)
  })

  test('a block added at coordinates that collide is moved, not stacked', async () => {
    await addBlock(reportId, {
      kind: 'line',
      layout: { x: 0, y: 0, w: 12, h: 4 },
      query: { events: [], measure: 'count', filters: [] },
    })

    // Exactly on top of the first. A client could send this, and the API is
    // reachable without one.
    await addBlock(reportId, {
      kind: 'bar',
      layout: { x: 0, y: 0, w: 12, h: 4 },
      query: { events: [], measure: 'count', filters: [] },
    })

    expect(hasOverlap(await layout())).toBeFalse()
  })

  test('addBlock reports the position the block ended up at', async () => {
    const added = await addBlock(reportId, {
      kind: 'donut',
      layout: { x: 0, y: 0, w: 12, h: 2 },
      query: { events: [], measure: 'count', filters: [] },
    })

    // A caller trusting the coordinates it asked for would draw the block
    // somewhere it is not.
    const stored = (await layout()).find(block => block.id === Number(added.id))!
    expect({ x: Number(added.x), y: Number(added.y) }).toEqual({ x: stored.x, y: stored.y })
  })

  test('dragging a block onto another pushes the other one down', async () => {
    const blocks = await layout()
    const [first, second] = [blocks[0]!, blocks[1]!]

    const settled = await updateBlocks(
      reportId,
      [{ id: second.id, layout: { x: first.x, y: first.y, w: second.w, h: second.h } }],
      { moved: second.id },
    )

    expect(hasOverlap(settled)).toBeFalse()
    // The one being held keeps where it was dropped; the other gives way.
    expect(settled.find(entry => entry.id === second.id)!.y).toBe(first.y)
    expect(settled.find(entry => entry.id === first.id)!.y).toBeGreaterThan(first.y)
  })

  test('what updateBlocks returns is what was stored', async () => {
    const settled = await updateBlocks(reportId, [])
    expect(settled).toEqual(await layout())
  })

  test('a save that only renames does not move anything', async () => {
    const before = await layout()
    await updateBlocks(reportId, [{ id: before[0]!.id, title: 'Renamed' }])

    expect(await layout()).toEqual(before)
  })

  test('removing a block leaves the rest where they were', async () => {
    const before = await layout()
    await removeBlock(reportId, before[0]!.id)
    const after = await settleLayout(reportId)

    // No compaction: a gap is a decision somebody is allowed to make.
    for (const block of after)
      expect(block.y).toBe(before.find(entry => entry.id === block.id)!.y)
  })
})

describe('managing reports', () => {
  let sourceId: number

  beforeAll(async () => {
    sourceId = Number((await createReport(projectId, owner, { name: `Manageable ${stamp}`, description: 'The original' })).id)
    await addBlock(sourceId, {
      kind: 'big_number',
      title: 'Counted',
      layout: { x: 0, y: 0, w: 3, h: 3 },
      query: { events: ['user.registered'], measure: 'count', filters: [] },
    })
    await publishReport(sourceId, owner)
  })

  test('a duplicate carries the blocks across', async () => {
    const copy = await duplicateReport(projectId, owner, sourceId)
    const blocks = await blocksOf(Number(copy!.id))

    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.title).toBe('Counted')
    expect((blocks[0]!.query as { measure: string }).measure).toBe('count')
  })

  test('a duplicate is a draft, and does not share the original\'s slug', async () => {
    const copy = await duplicateReport(projectId, owner, sourceId)

    expect(copy!.status).toBe('draft')
    expect(copy!.slug).not.toBe((await db.unsafe(`SELECT slug FROM reports WHERE id = $1`, [sourceId]))?.[0]?.slug)
  })

  test('a duplicate of a template report belongs to the person, not the template', async () => {
    // Otherwise the template engine treats the copy as the report it already
    // provisioned: the next version would rewrite somebody's duplicate under
    // them, and the key would match two reports at once.
    const templated = Number((await createReport(
      projectId,
      owner,
      { name: `Templated ${stamp}` },
      { origin: 'template', templateKey: 'commerce.overview', templateVersion: 1 },
    )).id)

    const copy = await duplicateReport(projectId, owner, templated)

    expect(copy!.origin).toBe('user')
    expect(copy!.template_key).toBeFalsy()
  })

  test('a report from another project cannot be duplicated', async () => {
    expect(await duplicateReport(otherProjectId, owner, sourceId)).toBeNull()
  })

  test('archiving hides it from the list without touching its blocks', async () => {
    const target = Number((await createReport(projectId, owner, { name: `Archivable ${stamp}` })).id)
    await addBlock(target, {
      kind: 'line',
      layout: { x: 0, y: 0, w: 6, h: 4 },
      query: { events: [], measure: 'count', filters: [] },
    })

    expect(await archiveReport(projectId, target)).toBeTrue()
    expect((await reportsFor(projectId)).map(report => Number(report.id))).not.toContain(target)
    // Soft, so the decision is reversible and nothing behind it is lost.
    expect(await blocksOf(target)).toHaveLength(1)
  })

  test('an archived report is listed as archived, and can be restored', async () => {
    const target = Number((await createReport(projectId, owner, { name: `Restorable ${stamp}` })).id)
    await archiveReport(projectId, target)

    expect((await archivedReports(projectId)).map(report => Number(report.id))).toContain(target)

    expect(await restoreReport(projectId, target)).toBeTrue()
    expect((await reportsFor(projectId)).map(report => Number(report.id))).toContain(target)
    expect((await archivedReports(projectId)).map(report => Number(report.id))).not.toContain(target)
  })

  test('archiving something already archived reports that it did nothing', async () => {
    const target = Number((await createReport(projectId, owner, { name: `Twice archived ${stamp}` })).id)

    expect(await archiveReport(projectId, target)).toBeTrue()
    expect(await archiveReport(projectId, target)).toBeFalse()
  })

  test('neither archive nor restore reaches into another project', async () => {
    const target = Number((await createReport(projectId, owner, { name: `Fenced ${stamp}` })).id)

    expect(await archiveReport(otherProjectId, target)).toBeFalse()
    await archiveReport(projectId, target)
    expect(await restoreReport(otherProjectId, target)).toBeFalse()
  })
})
