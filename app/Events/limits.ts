/**
 * Abuse controls for the public ingest.
 *
 * The ingest key is public by design: it ships inside the customer's
 * application, where anything embedded is readable. The key proves *which*
 * project a write belongs to, not that the caller is trustworthy, so `POST
 * /ingest` is reachable by anyone who reads it out of a bundle. Quotas sit on
 * top of it, so a script pointed at the endpoint cannot exhaust storage or
 * bury a real customer's data under noise.
 *
 * Two dimensions, because they fail differently. A per-project limit stops one
 * tenant (or one leaked key) from consuming the instance. A per-IP limit stops
 * one source hammering many projects, which the per-project limit alone would
 * happily allow.
 *
 * Requests are limited, not events: combined with the batch cap in
 * normalize.ts, a request ceiling is an event ceiling, and it keeps the
 * decision cheap enough to make before parsing a body. Event *volume* against a
 * plan is a different question with different consequences (it should bill, not
 * block) and is metered separately in #18.
 *
 * `ts-rate-limiter` provides the window. Its Redis storage is what makes these
 * numbers mean anything across more than one node; with the memory driver the
 * limits are per process, which is correct for a single instance and stated
 * here so nobody assumes otherwise.
 */
import { MemoryStorage, RateLimiter } from 'ts-rate-limiter'

/** Requests per window, per project. */
export const PROJECT_LIMIT = 120
/** Requests per window, per source address. Higher: one office is one address. */
export const IP_LIMIT = 300
/** The window both are measured over. */
export const WINDOW_MS = 10_000

export interface LimitDecision {
  ok: boolean
  /** Seconds to wait, for the Retry-After header. */
  retryAfter: number
  /** Which limit refused, for the log line and the response body. */
  scope?: 'project' | 'ip'
}

/**
 * Sliding window rather than fixed.
 *
 * A fixed window lets a caller send a full allowance at 09:59.999 and another
 * at 10:00.000, so the real ceiling is twice the configured one at exactly the
 * moment a flood is most likely to start.
 */
function makeLimiter(maxRequests: number): RateLimiter {
  return new RateLimiter({
    windowMs: WINDOW_MS,
    maxRequests,
    algorithm: 'sliding-window',
    // Timestamp tracking is enabled lazily by the driver on first
    // sliding-window use, so it is not a constructor option.
    storage: new MemoryStorage({ enableAutoCleanup: true }),
  })
}

const projectLimiter = makeLimiter(PROJECT_LIMIT)
const ipLimiter = makeLimiter(IP_LIMIT)

function retryAfterFrom(resetTime: number): number {
  return Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))
}

/**
 * Charge one request against both windows.
 *
 * The project limit is checked first and short-circuits, so a project already
 * over its ceiling does not also consume the IP allowance of everyone sharing
 * its address.
 *
 * Fails open. A limiter that throws is an infrastructure problem, and dropping
 * a customer's data because our own counter is unavailable is the worse of the
 * two outcomes: the batch is bounded by the body and batch caps regardless.
 */
export async function checkIngestLimits(projectId: number | string, ip: string): Promise<LimitDecision> {
  try {
    const project = await projectLimiter.consume(`project:${projectId}`)
    if (!project.allowed)
      return { ok: false, retryAfter: retryAfterFrom(project.resetTime), scope: 'project' }

    if (ip) {
      const address = await ipLimiter.consume(`ip:${ip}`)
      if (!address.allowed)
        return { ok: false, retryAfter: retryAfterFrom(address.resetTime), scope: 'ip' }
    }

    return { ok: true, retryAfter: 0 }
  }
  catch {
    return { ok: true, retryAfter: 0 }
  }
}

/**
 * The caller's address, for the per-IP window.
 *
 * Proxy headers are attacker-controlled, so this is only meaningful behind a
 * proxy that overwrites them. The leftmost entry in `x-forwarded-for` is the
 * original client where that holds, and where it does not, the limit degrades
 * to per-forged-header, which is why the per-project window is the one doing
 * the real work.
 */
export function clientAddress(request: { headers: { get: (name: string) => string | null } }): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded)
    return forwarded.split(',')[0]?.trim() ?? ''

  return request.headers.get('x-real-ip')?.trim() ?? ''
}

/** Reset both windows. Tests only; there is no reason to call this at runtime. */
export async function resetIngestLimits(projectId: number | string, ip: string): Promise<void> {
  await projectLimiter.reset(`project:${projectId}`)
  if (ip)
    await ipLimiter.reset(`ip:${ip}`)
}
