import type { EnhancedRequest } from '@stacksjs/bun-router'
import { response, route } from '@stacksjs/router'
import { storeEvents } from '../app/Events/ingest'
import { checkIngestLimits, clientAddress } from '../app/Events/limits'
import { ingestAllowanceFor, recordUsage } from '../app/Billing/usage'
import { LIMITS } from '../app/Events/normalize'
import { projectForIngestKey } from '../app/Support/access'

/**
 * The public write endpoint.
 *
 * Mounted at the document root, with no auth middleware: the credential is the
 * project's ingest key in `X-ReportsHQ-Key`, not a session. That key is public
 * by design, because it ships inside the customer's application, and it grants
 * exactly one capability: append events to one project. It can never read.
 *
 * The contract is documented in docs/ingest.md and every bound below is stated
 * there. Two principles run through all of it:
 *
 * **A partial batch is a success.** Events come from a running application in
 * batches, and rejecting fifty good events because one had an unusable name
 * would lose real data at the worst moment. Bad rows are dropped and counted;
 * the response says how many, so a client can log it without guessing.
 *
 * **Never 500 on input.** Anything a caller can send is either accepted,
 * repaired, or refused with a status that says what to do about it. A crash
 * here is a bug in us, not in them.
 */

interface IngestBody {
  events?: unknown
}

/**
 * CSRF is skipped here, deliberately and narrowly.
 *
 * The framework enforces a double-submit cookie token on every unsafe method by
 * default, which is the right posture for anything a browser session can reach.
 * This endpoint is not that: it carries no cookie, holds no session, and
 * authenticates entirely from `X-ReportsHQ-Key`. CSRF defends against a
 * cross-site page making a request that rides the victim's ambient credentials;
 * there are none to ride here, and a custom header cannot be set cross-origin
 * without a preflight the attacker's page will fail anyway.
 *
 * Requiring a token would simply make the endpoint unusable from a server, an
 * SDK or curl, which is every caller it has.
 */
route.post('/ingest', async (request: EnhancedRequest) => {
  const key = request.headers.get('x-reportshq-key') ?? ''
  const project = await projectForIngestKey(key)

  // One answer for a missing, malformed, unknown or revoked key. Anything more
  // specific tells whoever is probing which of their guesses was closer.
  if (!project) {
    return response.json({ ok: false, error: 'invalid_key', message: 'Unknown or revoked ingest key.' }, 401)
  }

  const projectId = Number(project.id)
  const address = clientAddress(request)
  // The project's own zone decides which month a write counts against, so a
  // month boundary means the same thing to the customer as to the invoice.
  const timezone = String(project.timezone ?? 'UTC')

  const limit = await checkIngestLimits(projectId, address)
  if (!limit.ok) {
    return response.json(
      { ok: false, error: 'rate_limited', message: 'Too many requests. Slow down and retry.', retry_after: limit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  // Measured in bytes, not characters: a body of multibyte characters is
  // larger than its length suggests, and the cap exists to bound memory.
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > LIMITS.BODY_BYTES) {
    return response.json(
      {
        ok: false,
        error: 'payload_too_large',
        message: `Body exceeds ${LIMITS.BODY_BYTES} bytes. Send fewer events per request.`,
        limit_bytes: LIMITS.BODY_BYTES,
      },
      413,
    )
  }

  let body: IngestBody
  try {
    body = raw ? JSON.parse(raw) as IngestBody : {}
  }
  catch {
    return response.json({ ok: false, error: 'invalid_json', message: 'Body is not valid JSON.' }, 400)
  }

  // `{ events: [...] }` is the documented shape; a bare array is accepted too,
  // because it is what people try first and refusing it teaches nothing.
  const incoming = Array.isArray(body) ? body : body.events

  if (!Array.isArray(incoming)) {
    return response.json(
      { ok: false, error: 'invalid_body', message: 'Expected { "events": [ ... ] }.' },
      422,
    )
  }

  // Over-long batches are truncated rather than refused, and the count of what
  // was skipped is returned, so a client that batches too aggressively still
  // gets its first 500 events through while it learns.
  const skipped = Math.max(0, incoming.length - LIMITS.BATCH)

  // The plan quota.
  //
  // Checked here rather than before the body is parsed, deliberately. Refusing
  // early would be cheaper, but it would mean refusing an unknown number of
  // events, and "we dropped some of your data" is a thing a customer is owed a
  // number for. The parse is bounded by the body cap, and the rate limiter
  // above already bounds how often a refused project can reach this point.
  //
  // Separate from that rate limit on purpose: it says "too fast", this says
  // "too much this month". Conflating them would tell somebody to slow down
  // when what they need is a larger plan.
  const quota = await ingestAllowanceFor(projectId, timezone)

  if (quota.verdict === 'reject') {
    const refused = Math.min(incoming.length, LIMITS.BATCH)
    await recordUsage(projectId, timezone, { rejected: refused })

    return response.json(
      {
        ok: false,
        error: 'quota_exceeded',
        // Actionable rather than just a status: a client that logs this can
        // tell somebody what to do about it.
        message: `This project has used its ${quota.allowance.toLocaleString('en-GB')} events for the month, plus its grace allowance. Upgrade to keep collecting.`,
        plan: quota.tier,
        used: quota.used,
        allowance: quota.allowance,
        rejected: refused,
        resets_in: quota.resetsIn,
      },
      { status: 429, headers: { 'Retry-After': String(quota.resetsIn) } },
    )
  }

  const { stored, dropped } = await storeEvents(projectId, incoming)

  // Metered after the write, with what was actually stored. Counting the
  // request's intent rather than its result would bill somebody for events the
  // validator threw away.
  await recordUsage(projectId, timezone, { events: stored })

  return response.json(
    {
      ok: true,
      stored,
      dropped: dropped.length,
      skipped,
      // Announced while it is still true, rather than after the wall. A client
      // that logs this has a month's warning; one that ignores it is no worse
      // off than before.
      ...(quota.verdict === 'grace'
        ? {
            warning: 'over_quota',
            message: `This project is past its ${quota.allowance.toLocaleString('en-GB')} events for the month and is inside its grace allowance. Collection stops when that runs out.`,
          }
        : {}),
      // The reasons, not just the count. A client that logs this can fix its
      // own payload without opening a support conversation. Bounded so a
      // pathological batch cannot make the response larger than the request.
      errors: dropped.slice(0, 20),
    },
    201,
  )
}).skipCsrf()

/**
 * A cheap way for an integration to check its key without writing anything.
 *
 * The SDKs call it on boot when a self-test is requested, and the onboarding UI
 * uses it to say "your key works" before the first real event arrives.
 */
route.get('/ingest/verify', async (request: EnhancedRequest) => {
  const project = await projectForIngestKey(request.headers.get('x-reportshq-key') ?? '')

  if (!project)
    return response.json({ ok: false, error: 'invalid_key' }, 401)

  // The project's name, and nothing else. Enough to confirm the key points
  // where the integrator thinks it does, without handing a public credential
  // the ability to read anything about the account behind it.
  return response.json({ ok: true, project: { name: project.name } })
})
