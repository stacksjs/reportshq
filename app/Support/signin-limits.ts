/**
 * Brute-force control on sign-in.
 *
 * Separate from the ingest limiter in app/Events/limits.ts, and deliberately
 * the opposite shape in the one way that matters: **this one fails closed.**
 * Ingest fails open because refusing a customer's data over our own broken
 * counter is worse than letting a bounded batch through. Here the thing behind
 * the counter is everybody's password, and a limiter that is unavailable is not
 * a reason to start accepting unlimited guesses.
 *
 * Two windows, because they answer different questions. Per-identifier stops
 * somebody working through a password list against one account. Per-address
 * stops the same list being sprayed across many accounts, which the
 * per-identifier window would not notice at all: one guess per account looks
 * like a hundred people mistyping.
 *
 * The email is hashed into the key rather than stored raw, so the limiter's
 * memory is not a list of who has tried to sign in.
 */
import { MemoryStorage, RateLimiter } from 'ts-rate-limiter'

/** Attempts per window against one email address. */
export const IDENTIFIER_LIMIT = 8
/** Attempts per window from one address, across every account. */
export const ADDRESS_LIMIT = 30
/** Five minutes: long enough to make a list impractical, short enough to forgive a bad morning. */
export const WINDOW_MS = 5 * 60 * 1000

export interface SigninDecision {
  ok: boolean
  retryAfter: number
}

function makeLimiter(maxRequests: number): RateLimiter {
  return new RateLimiter({
    windowMs: WINDOW_MS,
    maxRequests,
    algorithm: 'sliding-window',
    storage: new MemoryStorage({ enableAutoCleanup: true }),
  })
}

const identifierLimiter = makeLimiter(IDENTIFIER_LIMIT)
const addressLimiter = makeLimiter(ADDRESS_LIMIT)

/** A stable key for an email that is not the email. */
function identifierKey(email: string): string {
  const hash = new Bun.CryptoHasher('sha256')
  hash.update(String(email).trim().toLowerCase())
  return hash.digest('hex').slice(0, 32)
}

function retryAfterFrom(resetTime: number): number {
  return Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))
}

/**
 * Charge one sign-in attempt.
 *
 * Called before the password is checked, so a wrong guess and a right one cost
 * the same. Charging only failures would let an attacker probe indefinitely as
 * long as they occasionally guessed right, and it leaks which guesses were
 * close through timing.
 */
export async function checkSigninLimits(email: string, ip: string): Promise<SigninDecision> {
  try {
    const identifier = await identifierLimiter.consume(`signin:${identifierKey(email)}`)
    if (!identifier.allowed)
      return { ok: false, retryAfter: retryAfterFrom(identifier.resetTime) }

    if (ip) {
      const address = await addressLimiter.consume(`signin-ip:${ip}`)
      if (!address.allowed)
        return { ok: false, retryAfter: retryAfterFrom(address.resetTime) }
    }

    return { ok: true, retryAfter: 0 }
  }
  catch {
    // Closed, unlike ingest. See the note at the top of this file.
    return { ok: false, retryAfter: 30 }
  }
}

/** Clear both windows for one identity. Tests only. */
export async function resetSigninLimits(email: string, ip: string): Promise<void> {
  await identifierLimiter.reset(`signin:${identifierKey(email)}`)
  if (ip)
    await addressLimiter.reset(`signin-ip:${ip}`)
}

/**
 * The address a request came from.
 *
 * Lived in the ingest limiter, which is gone with the rest of the pipeline. It
 * moves here rather than disappearing because sign-in still rate limits by
 * address, and that is the last thing on this side that needs to know.
 */
export function clientAddress(request: { headers?: { get?: (name: string) => string | null } }): string {
  const forwarded = request.headers?.get?.('x-forwarded-for')

  // The first entry is the client; the rest are proxies that appended
  // themselves. Trusting the last one rate limits the load balancer.
  if (forwarded)
    return forwarded.split(',')[0]!.trim()

  return request.headers?.get?.('x-real-ip')?.trim() || 'unknown'
}
