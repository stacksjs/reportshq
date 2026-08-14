/**
 * Cache-aside in front of the engine.
 *
 * A report is a page of blocks, and opening it runs every block's query at
 * once. Two people opening the same report in the same minute, or one person
 * flipping between tabs, should not both pay for it.
 *
 * Deliberately short-lived. An analytics product is judged on whether the
 * numbers are current, and a stale total is worse than a slow one: five
 * seconds of staleness is invisible to a reader and absorbs the burst that
 * loading a page produces, while a minute of it means someone sends a test
 * event and does not see it arrive.
 *
 * The key includes everything that can change an answer, so a cached entry can
 * never be served to a question it did not answer. Getting that wrong is a
 * cross-tenant data leak rather than a stale number, which is why the project
 * id is first and the whole query is hashed rather than summarised.
 */
import type { BlockQuery } from './schema'
import type { EngineResult } from './engine'
import { cache } from '@stacksjs/cache'

/** How long an answer stays fresh. */
export const TTL_SECONDS = 5

export interface CacheKeyParts {
  projectId: number
  query: BlockQuery
  timezone: string
  range: string
}

/**
 * A stable key for a question.
 *
 * `JSON.stringify` is not stable across key order, so `{a, b}` and `{b, a}`
 * would cache twice and, worse, could collide differently after a refactor
 * reorders a literal. The query is serialised with sorted keys first.
 */
export function cacheKey(parts: CacheKeyParts): string {
  const canonical = stableStringify({
    query: parts.query,
    timezone: parts.timezone,
    range: parts.range,
  })

  const digest = new Bun.CryptoHasher('sha256').update(canonical).digest('hex').slice(0, 32)

  // Project id in the clear rather than only inside the hash: it makes a key
  // readable while debugging, and it means an accidental hash collision still
  // cannot cross a tenant boundary.
  return `reportshq:q:${parts.projectId}:${digest}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null'

  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

/**
 * Run through the cache.
 *
 * Every cache failure falls through to the engine. A cache is an optimisation,
 * and an analytics page that shows an error because Redis is unreachable has
 * turned a performance feature into an availability problem.
 */
export async function cached(parts: CacheKeyParts, run: () => Promise<EngineResult>): Promise<EngineResult> {
  const key = cacheKey(parts)

  try {
    const hit = await cache.get(key)
    if (hit)
      return JSON.parse(String(hit)) as EngineResult
  }
  catch {
    // Fall through and compute.
  }

  const result = await run()

  try {
    await cache.set(key, JSON.stringify(result), TTL_SECONDS)
  }
  catch {
    // Answer the question even if it cannot be remembered.
  }

  return result
}
