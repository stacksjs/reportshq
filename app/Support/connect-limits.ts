/**
 * Rate limits on the `buddy hq:connect` endpoints (routes/hq.ts).
 *
 * Three windows for three different callers:
 *
 * - **start**: anyone can ask for a connect code, and each one is a row until
 *   it expires ten minutes later. Ten a minute per address is far more than a
 *   CLI needs and bounds what a script can pile up.
 * - **poll**: a CLI polls about once a second while the person approves.
 * - **approve**: the confirmation code is six characters. Ten tries a minute
 *   per person makes guessing it, inside the ten minutes a connect lives, a
 *   one in several million chance.
 *
 * Fails closed, like sign-in (./signin-limits.ts): what sits behind these is
 * the handing over of a licence, and a limiter that is unavailable is not a
 * reason to accept unlimited guesses.
 */
import { MemoryStorage, RateLimiter } from 'ts-rate-limiter'

const WINDOW_MS = 60_000

export const START_LIMIT = 10
export const POLL_LIMIT = 120
export const APPROVE_LIMIT = 10

export interface ConnectDecision {
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

const limiters = {
  start: makeLimiter(START_LIMIT),
  poll: makeLimiter(POLL_LIMIT),
  approve: makeLimiter(APPROVE_LIMIT),
}

export type ConnectStep = keyof typeof limiters

/** Charge one request against a step's window. `who` is an address, or a user id for approve. */
export async function checkConnectLimit(step: ConnectStep, who: string | number): Promise<ConnectDecision> {
  try {
    const result = await limiters[step].consume(`hq-${step}:${who}`)
    if (result.allowed)
      return { ok: true, retryAfter: 0 }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((result.resetTime - Date.now()) / 1000)) }
  }
  catch {
    return { ok: false, retryAfter: 30 }
  }
}

/** Clear one caller's window. Tests only. */
export async function resetConnectLimit(step: ConnectStep, who: string | number): Promise<void> {
  await limiters[step].reset(`hq-${step}:${who}`)
}
