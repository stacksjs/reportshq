/**
 * The cross-SDK contract.
 *
 * `docs/fixtures/sdk-events.json` states, for each logical event, the one
 * taxonomy payload every SDK must produce. This asserts the Stacks package
 * satisfies it; the Laravel package asserts the same file from PHP.
 *
 * Without a shared fixture set the two drift, and the drift is invisible: a
 * Laravel app and a Stacks app doing the same thing produce reports that
 * quietly disagree, and nobody finds out until somebody compares them.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mapEvent } from '../src/mappers'

interface Case {
  case: string
  stacks: { event: string, payload: Record<string, unknown> }
  expected: Record<string, unknown> | null
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../docs/fixtures/sdk-events.json'), 'utf8'),
) as { cases: Case[] }

const ALL = { commerce: true, users: true, cms: true }

describe('cross-SDK fixtures', () => {
  test('the fixture file has cases in it', () => {
    // Guards the guard: an empty or unparsed file would make every assertion
    // below vacuously true.
    expect(fixtures.cases.length).toBeGreaterThan(5)
  })

  for (const entry of fixtures.cases) {
    test(entry.case, () => {
      const mapped = mapEvent({ name: entry.stacks.event, payload: entry.stacks.payload }, ALL)

      if (entry.expected === null) {
        expect(mapped).toBeNull()
        return
      }

      expect(mapped).not.toBeNull()

      // `occurred_at` is stamped at queue time unless the payload carried one,
      // so it is only compared when the fixture states it.
      const actual = { ...mapped } as Record<string, unknown>
      if (!('occurred_at' in entry.expected))
        delete actual.occurred_at

      // Exact equality, not a subset match. A field the SDK adds and the
      // fixture does not mention is drift too: it reaches the ingest, it gets
      // stored, and the other SDK does not produce it.
      expect(actual).toEqual(entry.expected)
    })
  }
})
