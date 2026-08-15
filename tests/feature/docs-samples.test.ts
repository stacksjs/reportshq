/**
 * The docs describe a real API, checked against the real API.
 *
 * Documentation rots in a particular direction: the code changes, the samples
 * do not, and nobody notices because nobody runs a doc. The first thing a new
 * customer does is paste the quickstart curl into a terminal, so a stale sample
 * is not a cosmetic problem. It is the product failing at the only moment where
 * a customer has no reason to assume the fault is theirs.
 *
 * So this extracts the samples from the markdown and holds them to what the
 * code actually accepts: the payloads go through the same normalizer the ingest
 * route uses, and the endpoints and headers are compared with the ones the
 * routes read. It is not a substitute for running the quickstart on a clean
 * machine, which is still on the checklist. It is the part that can run on
 * every commit.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeBatch } from '../../app/Events/normalize'

const DOCS = join(import.meta.dir, '../../docs')

interface Fence {
  file: string
  lang: string
  body: string
}

/** Every fenced code block in docs/, with the language it claims to be. */
function fences(): Fence[] {
  const found: Fence[] = []

  for (const name of readdirSync(DOCS)) {
    if (!name.endsWith('.md'))
      continue

    const src = readFileSync(join(DOCS, name), 'utf8')
    const pattern = /^```(\w*)\n([\s\S]*?)^```/gm

    for (const match of src.matchAll(pattern))
      found.push({ file: name, lang: match[1] ?? '', body: match[2] ?? '' })
  }

  return found
}

const ALL = fences()

describe('the documented samples', () => {
  test('there are samples to check', () => {
    // Without this, a broken extractor turns every assertion below into a loop
    // over nothing, and the file reports success while testing air.
    expect(ALL.length).toBeGreaterThan(20)
  })

  test('every JSON sample parses', () => {
    const broken: string[] = []

    for (const fence of ALL.filter(entry => entry.lang === 'json')) {
      try {
        JSON.parse(fence.body)
      }
      catch (error) {
        broken.push(`${fence.file}: ${(error as Error).message}`)
      }
    }

    expect(broken).toEqual([])
  })

  test('every documented event payload is one the ingest would accept', () => {
    // The check that matters. A sample showing a field the normalizer drops, or
    // a shape it refuses, sends the reader's first request into a silent
    // `dropped` count.
    const payloads = ALL
      .filter(fence => fence.lang === 'json' || fence.lang === 'bash')
      .flatMap(fence => extractEventBatches(fence.body))

    expect(payloads.length).toBeGreaterThan(0)

    for (const payload of payloads) {
      const { events, dropped } = normalizeBatch(payload)

      expect(dropped).toEqual([])
      expect(events.length).toBeGreaterThan(0)
    }
  })

  test('the samples send the header the route actually reads', () => {
    const route = readFileSync(join(import.meta.dir, '../../routes/ingest.ts'), 'utf8')
    const header = route.match(/request\.headers\.get\('([^']+)'\)/)?.[1]

    expect(header).toBe('x-reportshq-key')

    // Case is irrelevant over HTTP, spelling is not.
    for (const fence of ALL.filter(entry => entry.lang === 'bash')) {
      for (const match of fence.body.matchAll(/-H "([\w-]+):/g)) {
        const name = match[1]!.toLowerCase()
        if (name.includes('reportshq'))
          expect(name).toBe(header)
      }
    }
  })

  test('the documented endpoints exist', () => {
    // Paths the docs tell a customer to call, and where each is defined. A doc
    // pointing at a route that was renamed is a support ticket that starts with
    // "your instructions do not work".
    const ingest = readFileSync(join(import.meta.dir, '../../routes/ingest.ts'), 'utf8')

    expect(ingest).toContain(`'/ingest'`)
    expect(ingest).toContain(`'/ingest/verify'`)

    const documented = new Set(
      ALL.filter(fence => fence.lang === 'bash')
        .flatMap(fence => [...fence.body.matchAll(/https:\/\/reportshq\.org(\/[\w/-]*)/g)])
        .map(match => match[1]!),
    )

    // Whatever else the docs mention, these two are the ones a customer types
    // first, and both must be reachable.
    expect(documented.has('/ingest')).toBeTrue()
    expect(documented.has('/ingest/verify')).toBeTrue()
  })
})

/** Keys that only ever appear in a response, never in a request body. */
const RESPONSE_ONLY = ['ok', 'stored', 'dropped', 'skipped', 'next_cursor', 'error']

/**
 * Pull anything shaped like an ingest batch out of a sample.
 *
 * Handles both a bare JSON block and the `-d '...'` argument of a curl command,
 * because the quickstart shows the latter and that is the one a reader pastes.
 *
 * A request is told from a response by the SHAPE OF ITS WRAPPER, never by
 * whether its events look valid. That distinction is the whole correctness of
 * this file: an earlier version recognised a batch by every entry carrying a
 * `name`, which meant a sample with `nmae` was not a broken sample but an
 * unrecognised one. It was skipped in silence and the suite stayed green, which
 * is precisely the failure the file exists to prevent - and it took a mutation
 * check to notice, because a passing test looks the same either way.
 */
function extractEventBatches(body: string): unknown[] {
  const candidates: string[] = []

  // A whole fence that is itself JSON.
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('['))
    candidates.push(trimmed)

  // The payload inside a curl -d '...' argument, which may span lines.
  for (const match of body.matchAll(/-d\s+'([\s\S]*?)'/g))
    candidates.push(match[1]!)

  const batches: unknown[] = []

  for (const candidate of candidates) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    }
    catch {
      // Malformed JSON is caught by its own test, which reports the file and
      // the parser's message rather than a confusing downstream failure.
      continue
    }

    if (Array.isArray(parsed)) {
      if (parsed.length > 0)
        batches.push(parsed)
      continue
    }

    const object = parsed as Record<string, unknown>
    if (!Array.isArray(object.events) || object.events.length === 0)
      continue

    if (RESPONSE_ONLY.some(key => key in object))
      continue

    batches.push(object.events)
  }

  return batches
}
