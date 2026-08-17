/**
 * Every route that touches tenant data resolves permission first.
 *
 * The other authz tests take a route and prove it refuses. This one takes the
 * whole route table and proves nothing was forgotten, which is the failure that
 * actually happens: not a gate implemented wrongly, but a gate not written at
 * all on the route somebody added in a hurry six months after launch. That one
 * ships green, because every test written so far is about the routes that
 * already existed.
 *
 * So this reads the route files as text and asserts a property over all of
 * them. A new handler with no gate fails here on its first run, and the only
 * way past is to name it in ALLOWED below with a reason, which is a code review
 * about authentication rather than a diff nobody looked at twice.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTES_DIR = join(import.meta.dir, '../../routes')

/**
 * Anything that establishes who is asking or what they may reach.
 *
 * Broad on purpose. A handler that calls `currentUser` and then queries by that
 * user's id is scoped even without a project helper, and demanding a specific
 * function here would fail correct code and teach people to append a call that
 * does nothing. The claim being tested is "identity was considered", and the
 * behavioural tests carry the claim that it was considered correctly.
 */
const GATES = /\b(?:accessFor|canRead|canAdminister|isOwner|projectsFor|projectForIngestKey|currentUser|editableReport|shareByToken|verifyKey)\b/

/**
 * Routes that are deliberately open, each with the reason it is safe.
 *
 * The reason is the point. An allowlist without one becomes a list of things
 * nobody remembers approving.
 */
const ALLOWED = new Map<string, string>([
  // The sign-in surface, which cannot require a session to create one. These
  // are not ungoverned: app/Support/signin-limits.ts throttles them, and the
  // credential each one checks IS its gate.
  ['POST /register', 'Creating an account is the act of becoming a user. Rate limited per address and per IP.'],
  ['POST /login', 'Checks the password, which is the gate. Rate limited per address and per IP.'],
  ['POST /forgot', 'Checks nothing and reveals nothing: answers the same either way, so an address cannot be probed. Rate limited.'],
  ['POST /reset', 'The emailed token is the credential. Single use and expiring.'],
  ['POST /logout', 'Revokes whatever token the caller presents. Presenting someone else\'s is signing them out with a credential already held.'],
])

interface Handler {
  file: string
  verb: string
  path: string
  body: string
}

/**
 * Drop comments, so a route named in prose is not audited as a real one.
 *
 * Only block comments and whole-line `//` comments. A trailing `//` is left
 * alone deliberately: telling it apart from the `//` in a URL inside a string
 * needs a parser, and mistaking one for the other would silently delete code
 * from the text this audit reasons about. Leaving a trailing comment in can
 * only produce a false pass on a gate mentioned there, which the behavioural
 * tests would still catch.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** Every `route.<verb>('<path>', ...)` in routes/, with the source that follows it. */
function handlers(): Handler[] {
  const found: Handler[] = []

  for (const name of readdirSync(ROUTES_DIR)) {
    if (!name.endsWith('.ts'))
      continue

    // Read synchronously: `describe` bodies run before any await resolves, so
    // the table has to exist by the time the tests below are declared.
    const src = stripComments(readFileSync(join(ROUTES_DIR, name), 'utf8'))
    const pattern = /route\.(get|post|put|patch|delete)\((['`])([^'`]*)\2/g
    const marks: Array<{ verb: string, path: string, at: number }> = []

    for (const match of src.matchAll(pattern))
      marks.push({ verb: match[1]!.toUpperCase(), path: match[3]!, at: match.index! })

    marks.forEach((mark, index) => {
      found.push({
        file: name,
        verb: mark.verb,
        path: mark.path,
        // Up to the next route definition: close enough to a handler body for a
        // "was a gate mentioned" question, without parsing TypeScript.
        body: src.slice(mark.at, marks[index + 1]?.at ?? src.length),
      })
    })
  }

  return found
}

describe('route gates', () => {
  const all = handlers()

  test('there are routes to check', () => {
    // Guards the audit itself. If the regex stops matching, every assertion
    // below passes over an empty list and this file quietly stops testing
    // anything, which is worse than failing.
    // Lower since the hosted pipeline was retired: ingest, the builder API
    // and project tenancy were most of the route table, and what is left is
    // signing in and out. The guard still catches the regex breaking, which is
    // all it was ever for.
    expect(all.length).toBeGreaterThan(3)
  })

  for (const handler of all) {
    const label = `${handler.verb} ${handler.path}`
    const reason = ALLOWED.get(label)

    test(`${handler.file} ${label} ${reason ? 'is deliberately open' : 'resolves permission'}`, () => {
      if (reason) {
        expect(reason.length).toBeGreaterThan(20)
        return
      }

      expect(GATES.test(handler.body)).toBeTrue()
    })
  }

  test('the allowlist has no entries for routes that no longer exist', () => {
    // A stale exemption is a hole waiting for a route to be added back under
    // the same path.
    const live = new Set(all.map(handler => `${handler.verb} ${handler.path}`))

    for (const label of ALLOWED.keys())
      expect(live.has(label)).toBeTrue()
  })
})
