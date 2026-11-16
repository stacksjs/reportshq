/**
 * The HQ connect endpoints (`@stacksjs/hq/service`), mounted under /api/cli.
 *
 *   POST /api/cli/connect                 -> { code, approveUrl, confirmCode }
 *   GET  /api/cli/connect/{code}          -> pending | approved + licence (once) | expired
 *   POST /api/cli/connect/{code}/approve  -> the approve page's action (signed-in user)
 *
 * `buddy hq:connect reportshq` drives the first two and writes the licence it
 * collects to the application's `REPORTSHQ_LICENSE`. There is no usage route:
 * this is the licence-only kind of service, with no keys and nothing metered
 * (app/Hq/adapter.ts).
 */

import type { EnhancedRequest } from '@stacksjs/bun-router'
import type { HqRequest } from '@stacksjs/hq/service'
import { route } from '@stacksjs/router'
import { ConnectRefusedError } from '../app/Hq/adapter'
import { hq } from '../app/Hq/service'
import { checkConnectLimit } from '../app/Support/connect-limits'
import { sameOrigin } from '../app/Support/origin'
import { requestUser } from '../app/Support/session'
import { clientAddress } from '../app/Support/signin-limits'

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

/** The JSON body, whichever way this request carries it. Never throws. */
async function body(request: EnhancedRequest): Promise<Record<string, unknown>> {
  const parsed = (request as { jsonBody?: unknown }).jsonBody
  if (parsed && typeof parsed === 'object')
    return parsed as Record<string, unknown>
  try {
    const raw = await request.text()
    const read = raw ? JSON.parse(raw) : {}
    return read && typeof read === 'object' ? read as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

/** The request as the package reads it, with the body handed over already parsed. */
function hqRequest(request: EnhancedRequest, payload: Record<string, unknown> = {}): HqRequest {
  return {
    url: String(request.url),
    method: request.method,
    headers: request.headers,
    params: (request as { params?: Record<string, string | undefined> }).params,
    json: async () => payload,
  }
}

function tooMany(retryAfter: number, message = 'rate limited'): Response {
  return json({ error: message }, 429, { 'Retry-After': String(retryAfter) })
}

route.post('/connect', async (request: EnhancedRequest) => {
  const limit = await checkConnectLimit('start', clientAddress(request))
  if (!limit.ok)
    return tooMany(limit.retryAfter)

  // The package answers `confirmCode` beside the code and the approve URL. It
  // goes ONLY to the caller that asked for the code, never into the approve
  // URL: the CLI prints it, and approving below is refused until the person
  // has typed it.
  return hq().startConnect(hqRequest(request, await body(request)))
}).skipCsrf() // called by a CLI: no browser, no cookie, nothing to forge

route.get('/connect/{code}', async (request: EnhancedRequest) => {
  const limit = await checkConnectLimit('poll', clientAddress(request))
  if (!limit.ok)
    return tooMany(limit.retryAfter)
  return hq().pollConnect(hqRequest(request), String((request as { params?: Record<string, string> }).params?.code ?? ''))
})

// The approve page's button. Cookie-authenticated, so it checks the Origin:
// approving hands a licence to whoever holds the code, which is exactly what
// a forged cross-site POST would want.
//
// It also needs the confirmation code from the terminal that started the
// connect. The package checks it inside `approveConnect`, so there is no
// request that approves without it, and wrong guesses are limited per person
// here, before it is asked.
route.post('/connect/{code}/approve', async (request: EnhancedRequest) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const user = requestUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)

  const limit = await checkConnectLimit('approve', user.id)
  if (!limit.ok)
    return tooMany(limit.retryAfter, 'Too many attempts. Wait a minute and try again.')

  const code = String((request as { params?: Record<string, string> }).params?.code ?? '')

  try {
    const result = await hq().approveConnect(code, { id: user.id }, (await body(request)).confirm)
    if (!result.ok) {
      if (result.reason === 'confirmation_mismatch') {
        return json({
          error: 'That code does not match. Enter the confirmation code your terminal is showing.',
          reason: 'confirmation_mismatch',
        }, 422)
      }
      return json({
        error: result.reason === 'already_approved'
          ? 'This connection was already approved.'
          : 'This connection request has expired. Run the command again.',
        reason: result.reason,
      }, result.reason === 'already_approved' ? 409 : 410)
    }
    return json({ ok: true, project: result.project })
  }
  catch (error) {
    if (error instanceof ConnectRefusedError)
      return json({ error: error.message, reason: error.reason }, 409)
    console.error('[hq] could not approve connect:', error instanceof Error ? error.message : error)
    return json({ error: 'Could not approve the connection. Please try again.' }, 500)
  }
}).middleware('auth').skipCsrf()
