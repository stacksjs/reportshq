/**
 * Friendly names, and the property keys the builder offers to group by.
 *
 * The label map is worth testing for one reason: it is a second copy of the
 * event list in docs/events.md, and the doc is what the SDKs are written
 * against. A name documented there and missing here shows up in the builder as
 * a raw string beside a dozen labelled ones, which reads as a bug in the
 * product rather than an omission in a map.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { propertyKeysFor } from '../../app/Events/query'
import { EVENT_LABELS, eventLabel, fieldLabel, humanize } from '../../app/Events/taxonomy'
import { storeEvents } from '../../app/Events/ingest'
import { createProject } from '../../app/Support/projects'

/** Every `event.name` in the taxonomy table of docs/events.md. */
function documentedEvents(): string[] {
  const doc = readFileSync(join(import.meta.dir, '../../docs/events.md'), 'utf8')
  const names = new Set<string>()

  for (const line of doc.split('\n')) {
    // Table rows only, and only the first cell, so a name mentioned in prose or
    // listed as a recommended property is not mistaken for an event.
    if (!line.startsWith('|'))
      continue

    const first = line.split('|')[1]?.trim() ?? ''
    const match = first.match(/^`([a-z][a-z0-9]*(?:\.[a-z0-9_]+)+)`$/)
    if (match)
      names.add(match[1]!)
  }

  return [...names]
}

describe('event labels', () => {
  test('the doc actually parses into events', () => {
    // Guards the guard: if the table format changes and this finds nothing,
    // the drift test below would pass by checking an empty list.
    expect(documentedEvents().length).toBeGreaterThan(10)
  })

  test('every documented event has a label', () => {
    const missing = documentedEvents().filter(name => !EVENT_LABELS[name])
    expect(missing).toEqual([])
  })

  test('no label exists for an event the docs do not describe', () => {
    // The other direction: a label for an event no SDK sends is a name somebody
    // invented here, and the docs are where that conversation belongs.
    const documented = new Set(documentedEvents())
    expect(Object.keys(EVENT_LABELS).filter(name => !documented.has(name))).toEqual([])
  })

  test('labels are readable rather than restatements of the key', () => {
    for (const [name, label] of Object.entries(EVENT_LABELS)) {
      expect(label).not.toContain('.')
      expect(label).not.toBe(name)
      expect(label[0]).toBe(label[0]!.toUpperCase())
    }
  })

  test('a custom event falls back to something legible', () => {
    expect(eventLabel('shop.basket.abandoned')).toBe('Shop basket abandoned')
    expect(eventLabel('commerce.order.created')).toBe('Order placed')
  })

  test('humanize copes with the shapes a customer actually sends', () => {
    expect(humanize('signup_completed')).toBe('Signup completed')
    expect(humanize('a-b-c')).toBe('A b c')
    expect(humanize('')).toBe('')
  })
})

describe('the Stacks integration package', () => {
  test('every event it can send is a documented one', async () => {
    // The package translates framework events into reserved names. A name it
    // emits that the doc does not describe is a name no template reads and no
    // label exists for, so it arrives in somebody's project as an orphan.
    const { MAPPINGS } = await import('../../packages/stacks/src/mappers')
    const documented = new Set(documentedEvents())

    const undocumented = Object.values(MAPPINGS)
      .map(mapping => mapping.to)
      .filter(name => !documented.has(name))

    expect(undocumented).toEqual([])
  })

  test('every event it can send has a friendly label', async () => {
    const { MAPPINGS } = await import('../../packages/stacks/src/mappers')

    const unlabelled = Object.values(MAPPINGS)
      .map(mapping => mapping.to)
      .filter(name => !EVENT_LABELS[name])

    expect(unlabelled).toEqual([])
  })

  test('no two framework events map to the same taxonomy name', async () => {
    // Two mappings onto one name means one of them is unreachable in practice
    // and the reports built on it silently double-count.
    const { MAPPINGS } = await import('../../packages/stacks/src/mappers')
    const targets = Object.values(MAPPINGS).map(mapping => mapping.to)

    expect(new Set(targets).size).toBe(targets.length)
  })
})

describe('field labels', () => {
  test('known columns read as words', () => {
    expect(fieldLabel('user_key')).toBe('User')
    expect(fieldLabel('occurred_at')).toBe('Time')
  })

  test('a property is labelled by its key, without the prefix', () => {
    expect(fieldLabel('properties.plan')).toBe('Plan')
    expect(fieldLabel('properties.order_id')).toBe('Order id')
  })
})

describe('propertyKeysFor', () => {
  const stamp = Date.now()
  let owner: { id: number }
  let projectId: number

  const yesterday = new Date(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) + 'T12:00:00.000Z').toISOString()

  beforeAll(async () => {
    const email = `taxonomy-${stamp}@reportshq.test`
    await db.unsafe(
      `INSERT INTO users (name, email, password, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      ['taxonomy owner', email, 'not-a-real-hash'],
    )
    const row = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0] as { id: number }
    owner = { id: Number(row.id) }
    projectId = Number((await createProject(owner, { name: `Taxonomy ${stamp}`, timezone: 'UTC' })).id)
  })

  afterAll(async () => {
    await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [projectId])
    await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
    await db.unsafe(`DELETE FROM users WHERE id = $1`, [owner.id])
  })

  test('a project with no events offers nothing', async () => {
    expect(await propertyKeysFor(projectId)).toEqual([])
  })

  test('keys come back most frequent first', async () => {
    await storeEvents(projectId, [
      { name: 'user.registered', occurred_at: yesterday, properties: { plan: 'pro', source: 'organic' } },
      { name: 'user.registered', occurred_at: yesterday, properties: { plan: 'starter' } },
      { name: 'user.registered', occurred_at: yesterday, properties: { plan: 'scale' } },
    ])

    const keys = await propertyKeysFor(projectId)
    expect(keys.map(entry => entry.key)).toEqual(['plan', 'source'])
    expect(keys[0]!.count).toBe(3)
  })

  test('one project cannot see another\'s keys', async () => {
    const other = Number((await createProject(owner, { name: `Taxonomy other ${stamp}`, timezone: 'UTC' })).id)
    try {
      expect(await propertyKeysFor(other)).toEqual([])
    }
    finally {
      await db.unsafe(`DELETE FROM projects WHERE id = $1`, [other])
    }
  })
})
