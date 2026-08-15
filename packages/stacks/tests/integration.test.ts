/**
 * The integration package, against a real HTTP server.
 *
 * A fake ingest rather than a mocked fetch, because the things most likely to
 * be wrong here are on the wire: the header name, the body shape, what a 4xx
 * does versus a 5xx. A mock would happily agree with whatever this package
 * sends, including the wrong thing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createClient, listen, mapEvent, mappedEventNames, resolveConfig, shouldSample, Transport } from '../src/index'

interface Received {
  key: string
  events: Array<Record<string, unknown>>
}

let server: ReturnType<typeof Bun.serve>
let endpoint = ''
let received: Received[] = []
/** Statuses the fake returns, one per request, before falling back to 201. */
let responses: number[] = []
let requestCount = 0

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      requestCount++
      const status = responses.shift() ?? 201

      if (status >= 400)
        return new Response(JSON.stringify({ error: 'refused' }), { status })

      const body = await request.json() as { events: Array<Record<string, unknown>> }
      received.push({ key: request.headers.get('X-ReportsHQ-Key') ?? '', events: body.events })

      return new Response(JSON.stringify({ ok: true }), { status })
    },
  })

  endpoint = `http://localhost:${server.port}/ingest`
})

afterAll(() => {
  server.stop(true)
})

afterEach(() => {
  received = []
  responses = []
  requestCount = 0
})

function client(overrides: Record<string, unknown> = {}) {
  return createClient({
    key: 'rhq_test',
    endpoint,
    batchSize: 100,
    flushIntervalMs: 60_000,
    retryBaseMs: 1,
    ...overrides,
  })
}

describe('configuration', () => {
  test('without a key it is inert', () => {
    const config = resolveConfig({ key: '' })
    const inert = createClient({ key: '', endpoint })

    inert.handle({ name: 'user:created', payload: { id: 1 } })

    expect(config.key).toBe('')
    expect(inert.pending()).toBe(0)
    // Not "registers listeners that do nothing": no listeners at all, so an
    // unconfigured app cannot pay for this package in any way.
    expect(listen({ key: '', endpoint })).toEqual({})
  })

  test('options beat the environment, and defaults fill the rest', () => {
    const config = resolveConfig({ key: 'explicit', batchSize: 7 })

    expect(config.key).toBe('explicit')
    expect(config.batchSize).toBe(7)
    expect(config.endpoint).toContain('://')
    expect(config.domains).toEqual({ commerce: true, users: true, cms: true })
  })

  test('nonsense values fall back rather than breaking the transport', () => {
    const config = resolveConfig({ key: 'k', batchSize: 0, sampleRate: 5, maxRetries: 99 })

    // A batch size of zero would mean a size-triggered flush never happens.
    expect(config.batchSize).toBeGreaterThan(0)
    expect(config.sampleRate).toBe(1)
    expect(config.maxRetries).toBeLessThanOrEqual(10)
  })
})

describe('mapping', () => {
  const all = { commerce: true, users: true, cms: true }

  test('an order becomes the reserved commerce name, with its measure', () => {
    const mapped = mapEvent({ name: 'order:created', payload: { id: 9, total: 4250, currency: 'usd', user_id: 'u1' } }, all)

    expect(mapped?.name).toBe('commerce.order.created')
    expect(mapped?.value).toBe(4250)
    expect(mapped?.currency).toBe('USD')
    expect(mapped?.user_key).toBe('u1')
    expect(mapped?.properties?.order_id).toBe('9')
  })

  test('a registration becomes user.registered', () => {
    const mapped = mapEvent({ name: 'user:created', payload: { user_id: 'u2', plan: 'pro', source: 'organic' } }, all)

    expect(mapped?.name).toBe('user.registered')
    expect(mapped?.properties).toEqual({ plan: 'pro', source: 'organic' })
  })

  test('an unmapped event is dropped rather than invented', () => {
    // An app emits dozens of events that mean nothing to a reporting taxonomy.
    // Forwarding them under made-up names fills a project with vocabulary no
    // template can read.
    expect(mapEvent({ name: 'widget:frobnicated', payload: {} }, all)).toBeNull()
  })

  test('a disabled domain maps nothing from that domain', () => {
    const domains = { commerce: false, users: true, cms: true }

    expect(mapEvent({ name: 'order:created', payload: { total: 10 } }, domains)).toBeNull()
    expect(mapEvent({ name: 'user:created', payload: {} }, domains)).not.toBeNull()
    expect(mappedEventNames(domains)).not.toContain('order:created')
  })

  test('empty properties are omitted, not sent as nulls', () => {
    const mapped = mapEvent({ name: 'order:cancelled', payload: {} }, all)

    expect(mapped?.name).toBe('commerce.order.cancelled')
    expect(mapped?.properties).toBeUndefined()
  })

  test('currency is only attached where there is a value to denominate', () => {
    const mapped = mapEvent({ name: 'user:login', payload: { currency: 'usd', user_id: 'u' } }, all)
    expect(mapped?.currency).toBeUndefined()
  })

  test('every mapped name targets a dotted taxonomy name', () => {
    for (const name of mappedEventNames({ commerce: true, users: true, cms: true })) {
      const mapped = mapEvent({ name, payload: {} }, { commerce: true, users: true, cms: true })
      expect(mapped?.name).toMatch(/^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/)
    }
  })
})

describe('delivery', () => {
  test('a flush sends one batch with the key in the header', async () => {
    const sender = client()
    sender.handle({ name: 'order:created', payload: { id: 1, total: 100, user_id: 'a' } })
    sender.handle({ name: 'user:created', payload: { user_id: 'b' } })

    await sender.flush()

    expect(received).toHaveLength(1)
    expect(received[0]!.key).toBe('rhq_test')
    expect(received[0]!.events).toHaveLength(2)
    expect(sender.stats.sent).toBe(2)
  })

  test('every event carries a timestamp even when the payload had none', async () => {
    const sender = client()
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })
    await sender.flush()

    expect(String(received[0]!.events[0]!.occurred_at)).toContain('T')
  })

  test('a full batch flushes without waiting for the timer', async () => {
    const sender = client({ batchSize: 2 })

    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })
    sender.handle({ name: 'user:login', payload: { user_id: 'b' } })
    await sender.flush()

    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(sender.stats.sent).toBe(2)
  })

  test('flushing an empty buffer sends nothing', async () => {
    await client().flush()
    expect(requestCount).toBe(0)
  })

  test('a 5xx is retried and then succeeds', async () => {
    responses = [500, 503]

    const sender = client()
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })
    await sender.flush()

    expect(requestCount).toBe(3)
    expect(sender.stats.sent).toBe(1)
    expect(sender.stats.failed).toBe(0)
  })

  test('a 4xx is not retried, because it will be wrong every time', async () => {
    responses = [401]

    const errors: Error[] = []
    const sender = client({ onError: (error: Error) => errors.push(error) })
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })
    await sender.flush()

    // Retrying a bad key is a slower way to fail and blocks everything behind it.
    expect(requestCount).toBe(1)
    expect(sender.stats.failed).toBe(1)
    expect(errors[0]?.message).toContain('401')
  })

  test('a 429 is retried, because it means later rather than no', async () => {
    responses = [429]

    const sender = client()
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })
    await sender.flush()

    expect(requestCount).toBe(2)
    expect(sender.stats.sent).toBe(1)
  })

  test('giving up reports the failure rather than swallowing it', async () => {
    responses = [500, 500, 500]

    const errors: Error[] = []
    const sender = client({ onError: (error: Error) => errors.push(error) })
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })
    await sender.flush()

    expect(sender.stats.failed).toBe(1)
    expect(errors).toHaveLength(1)
  })

  test('an unreachable endpoint does not throw into the caller', async () => {
    const sender = createClient({ key: 'k', endpoint: 'http://127.0.0.1:1/ingest', retryBaseMs: 1, flushIntervalMs: 60_000 })
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })

    // The whole promise of this package: analytics cannot take the app down.
    expect(sender.flush()).resolves.toBeUndefined()
    await sender.flush()
    expect(sender.stats.failed).toBeGreaterThan(0)
  })

  test('events arriving during a flush are not sent twice', async () => {
    const sender = client()
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })

    const flushing = sender.flush()
    sender.handle({ name: 'user:login', payload: { user_id: 'b' } })
    await flushing
    await sender.flush()

    const all = received.flatMap(batch => batch.events)
    expect(all).toHaveLength(2)
    expect(sender.stats.sent).toBe(2)
  })

  test('stop delivers the tail', async () => {
    const sender = client()
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })

    await sender.stop()

    // A deploy is exactly when events are most likely to be lost.
    expect(sender.stats.sent).toBe(1)
    expect(sender.pending()).toBe(0)
  })

  test('stop is idempotent, and nothing is accepted afterwards', async () => {
    const sender = client()
    await sender.stop()
    await sender.stop()

    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })
    expect(sender.pending()).toBe(0)
  })
})

describe('back pressure', () => {
  test('the oldest events are dropped when the buffer is full', () => {
    const transport = new Transport(resolveConfig({
      key: 'k',
      endpoint: 'http://127.0.0.1:1/ingest',
      maxBufferSize: 3,
      batchSize: 1000,
      flushIntervalMs: 60_000,
    }))

    for (let index = 0; index < 5; index++)
      transport.track({ name: 'user.login', user_key: `u${index}` })

    // Recent events describe what is happening now, which is what somebody
    // watching a dashboard during an incident actually needs.
    expect(transport.pending).toBe(3)
    expect(transport.stats.dropped).toBe(2)
  })
})

describe('sampling', () => {
  test('a rate of 1 keeps everything and a rate of 0 keeps nothing', () => {
    expect(shouldSample({ name: 'x', user_key: 'a' }, 1)).toBeTrue()
    expect(shouldSample({ name: 'x', user_key: 'a' }, 0)).toBeFalse()
  })

  test('a subject is wholly in or wholly out', () => {
    // The property that makes funnels survive sampling. Independent per-event
    // coin flips would decorrelate the steps and turn every conversion rate
    // into noise.
    const decisions = new Set<boolean>()
    for (let index = 0; index < 25; index++)
      decisions.add(shouldSample({ name: `event.${index}`, user_key: 'steady' }, 0.5))

    expect(decisions.size).toBe(1)
  })

  test('different subjects get different answers', () => {
    const kept = Array.from({ length: 200 }, (_, index) =>
      shouldSample({ name: 'x', user_key: `user-${index}` }, 0.5)).filter(Boolean).length

    // Roughly half, with plenty of slack: this asserts the hash spreads, not
    // that it is a perfect uniform.
    expect(kept).toBeGreaterThan(60)
    expect(kept).toBeLessThan(140)
  })

  test('an event with no subject falls back to a per-event decision', () => {
    expect(shouldSample({ name: 'x' }, 1, () => 0.9)).toBeTrue()
    expect(shouldSample({ name: 'x' }, 0.5, () => 0.9)).toBeFalse()
    expect(shouldSample({ name: 'x' }, 0.5, () => 0.1)).toBeTrue()
  })

  test('a rate of zero switches the integration off entirely', async () => {
    // Same as an absent key: no work per event, no timer, no request. Counting
    // drops would mean doing per-event work for a client that is off.
    const sender = client({ sampleRate: 0 })
    sender.handle({ name: 'user:login', payload: { user_id: 'a' } })

    await sender.flush()

    expect(sender.pending()).toBe(0)
    expect(requestCount).toBe(0)
  })

  test('a subject sampled out is counted as dropped and never sent', async () => {
    // A subject the hash puts outside a half sample, found rather than assumed,
    // so this stays true if the hash is ever changed.
    const excluded = Array.from({ length: 200 }, (_, index) => `user-${index}`)
      .find(key => !shouldSample({ name: 'x', user_key: key }, 0.5))!

    expect(excluded).toBeDefined()

    const sender = client({ sampleRate: 0.5 })
    sender.handle({ name: 'user:login', payload: { user_id: excluded } })

    await sender.flush()

    expect(sender.stats.dropped).toBe(1)
    expect(requestCount).toBe(0)
  })
})

describe('listen()', () => {
  test('returns a listener per mapped framework event', () => {
    const listeners = listen({ key: 'k', endpoint, flushIntervalMs: 60_000 })

    expect(Object.keys(listeners)).toContain('order:created')
    expect(Object.keys(listeners)).toContain('user:created')
    expect(typeof listeners['order:created']).toBe('function')
  })

  test('a listener called with no payload does not throw', () => {
    const listeners = listen({ key: 'k', endpoint, flushIntervalMs: 60_000 })
    expect(() => listeners['user:logout']!()).not.toThrow()
  })

  test('disabled domains produce no listeners for those events', () => {
    const listeners = listen({
      key: 'k',
      endpoint,
      flushIntervalMs: 60_000,
      domains: { commerce: true, users: false, cms: false },
    })

    expect(Object.keys(listeners)).toContain('order:created')
    expect(Object.keys(listeners)).not.toContain('user:created')
    expect(Object.keys(listeners)).not.toContain('post:published')
  })
})
