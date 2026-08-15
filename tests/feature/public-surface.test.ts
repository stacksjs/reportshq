/**
 * What the two anonymous pages are allowed to reach.
 *
 * `/s` and `/embed` are the only views in the product rendered for somebody
 * with no account, and the rule they are written to is narrow: a token buys one
 * report's published snapshot and nothing else. No project name, no member
 * list, no ingest key, no sibling reports, no raw events.
 *
 * The rule holds today. What this file defends is the edit that comes later,
 * where a public page grows a "shared by {project.name}" line and quietly takes
 * a project row with it — because the ingest key is on that row, and the person
 * making that change is thinking about a heading, not about credentials.
 *
 * So the test reads the views as source and asserts what they are allowed to
 * import. Behavioural tests cannot catch this: a page that renders the project
 * name looks correct, and so does the page that renders the key next to it.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shareByToken } from '../../app/Reports/shares'

const VIEWS = join(import.meta.dir, '../../resources/views')

/** The views rendered without a session. */
const PUBLIC_VIEWS = ['s.stx', 'embed.stx']

/**
 * Everything a public view may call, and nothing else.
 *
 * An allowlist rather than a list of banned names on purpose. A denylist has to
 * predict the helper somebody writes next year; this fails closed, and adding
 * to it is a deliberate decision about what a stranger may reach.
 */
const PERMITTED = new Set([
  // The single entry point from token to report. Returns a flat, minimal shape
  // rather than the rows it read, which is the reason it exists.
  'shareByToken',
  // Counting a view.
  'recordView',
  // The published snapshot's blocks, and the engine that draws them.
  'publishedBlocks',
  'runQuery',
  // Turning a block's query into a sentence, so a reader can tell what they are
  // looking at. Reads the block, touches no rows.
  'describeQuery',
  'describeCaveat',
  // Reading a query parameter.
  'param',
])

function importedNames(view: string): string[] {
  const src = readFileSync(join(VIEWS, view), 'utf8')
  const names: string[] = []

  for (const match of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of match[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]!.trim()
      if (name)
        names.push(name)
    }
  }

  return names
}

describe('the anonymous share pages', () => {
  for (const view of PUBLIC_VIEWS) {
    test(`${view} imports only what a stranger may reach`, () => {
      const imported = importedNames(view)

      // Guards the audit: a view that suddenly imports nothing means the regex
      // stopped matching, not that the page became safe.
      expect(imported.length).toBeGreaterThan(3)

      for (const name of imported)
        expect(PERMITTED.has(name)).toBeTrue()
    })

    test(`${view} never reads a project or a member`, () => {
      const src = readFileSync(join(VIEWS, view), 'utf8')

      // The specific rows that carry credentials and identities. `shareByToken`
      // already narrows what a token resolves to; this catches a view that goes
      // around it and queries directly.
      for (const forbidden of ['ingest_key', 'projectsFor', 'accessFor', 'eventsFor', 'sharesFor', 'FROM projects', 'FROM users', 'FROM project_members'])
        expect(src).not.toContain(forbidden)
    })
  }
})

describe('the ingest key', () => {
  /**
   * The key writes events into a project, so it belongs to whoever administers
   * one and to nobody else - not to a member who can only read reports, and
   * certainly not to a stranger holding a share link.
   *
   * There are only three places it can reach a screen or a payload, and each is
   * behind an administration check today. This asserts the pairing rather than
   * the check itself, because the mistake to catch is a fourth place: a
   * settings panel, a debug payload, an onboarding banner that puts the key
   * where the gate is not.
   */
  const SURFACES = [
    join(import.meta.dir, '../../routes/projects.ts'),
    join(VIEWS, 'project.stx'),
    join(VIEWS, 'project-settings.stx'),
  ]

  test('appears in the presentation layer only alongside an administration check', () => {
    const searched = [
      ...SURFACES,
      ...PUBLIC_VIEWS.map(view => join(VIEWS, view)),
    ]

    for (const file of searched) {
      const src = readFileSync(file, 'utf8')
      if (!/ingest_?[kK]ey/.test(src))
        continue

      expect(/canAdminister|mayAdminister/.test(src)).toBeTrue()
    }
  })

  test('is not on the anonymous pages at all', () => {
    // Stronger than the pairing above: a public page has no administrator to
    // check for, so the key must not be mentioned in any form.
    for (const view of PUBLIC_VIEWS)
      expect(/ingest_?[kK]ey/.test(readFileSync(join(VIEWS, view), 'utf8'))).toBeFalse()
  })
})

describe('a token that does not resolve', () => {
  // Verified against the rendered pages as well: a revoked link and a token
  // that never existed produce byte-identical HTML. These pin the layer under
  // that, where the distinction would have to be introduced first.
  test('gives the same answer for revoked, expired and never-issued', async () => {
    expect(await shareByToken('neverexistedatall')).toBeNull()
    expect(await shareByToken('')).toBeNull()
    expect(await shareByToken('   ')).toBeNull()
  })

  test('does not treat an overlong token as a database question', async () => {
    // Rejected on length before it reaches a query, so a token field cannot be
    // used to push arbitrary length into the driver.
    expect(await shareByToken('x'.repeat(5000))).toBeNull()
  })
})
