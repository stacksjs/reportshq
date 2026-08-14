/**
 * Turning what arrived into what we store.
 *
 * The governing rule: **one bad row must never cost a good one**. An SDK
 * batches events from a running application, and a batch that fails wholesale
 * because a single property was too long takes the other forty-nine with it,
 * usually at the worst moment. Every function here therefore repairs what it
 * can, drops what it cannot, and counts what it dropped so the caller can
 * report the number honestly.
 *
 * The bounds are not arbitrary. Each one is the point past which a value stops
 * being data and starts being an attack surface or a bill.
 */

export const LIMITS = {
  /** Whole request body. 512 KB holds a full batch of realistic events. */
  BODY_BYTES: 512 * 1024,
  /** Events per request. Above this, send another batch. */
  BATCH: 500,
  /** `commerce.order.created` is 23 characters; 120 is generous. */
  NAME: 120,
  /** Property keys. A key longer than this is a value in disguise. */
  KEY: 64,
  /** Property values, after stringifying. Longer values are truncated, not dropped. */
  VALUE: 1024,
  /** Properties per event. Beyond this the event is a document, not an event. */
  PROPERTIES: 64,
  /** Serialised property bag per event. */
  PROPERTIES_BYTES: 8 * 1024,
  /** Identifiers the customer chooses. */
  KEY_FIELD: 120,
  /** How far in the past a client clock may claim to be: 30 days. */
  PAST_MS: 30 * 24 * 60 * 60 * 1000,
  /** And in the future: one hour, which covers clock skew without allowing backdating forward. */
  FUTURE_MS: 60 * 60 * 1000,
} as const

export interface IncomingEvent {
  name?: unknown
  occurred_at?: unknown
  timestamp?: unknown
  properties?: unknown
  value?: unknown
  currency?: unknown
  user_key?: unknown
  session_key?: unknown
}

export interface NormalizedEvent {
  name: string
  occurred_at: string
  received_at: string
  properties: string
  value: number | null
  currency: string | null
  user_key: string | null
  session_key: string | null
}

export interface NormalizeResult {
  events: NormalizedEvent[]
  /** Rows that could not be stored at all, with the reason, for the response. */
  dropped: Array<{ index: number, reason: string }>
}

/**
 * Event names are lowercased and stripped to a dot taxonomy.
 *
 * Case-folding matters more than it looks: `Commerce.Order.Created` and
 * `commerce.order.created` arriving from two places in one codebase would
 * otherwise be two series on every chart, and nobody would notice until the
 * numbers looked half right.
 */
export function normalizeName(value: unknown): string | null {
  const name = String(value ?? '').trim().toLowerCase()
  if (!name)
    return null

  // Collapse separators to dots, drop anything that is not a word character,
  // and squeeze repeats, so `commerce..order  created` becomes
  // `commerce.order.created`.
  const cleaned = name
    .replace(/[\s/\\]+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, LIMITS.NAME)

  return cleaned || null
}

/**
 * A timestamp we are willing to believe.
 *
 * Client clocks are wrong in both directions, and a backfill can claim any date
 * at all. Rather than reject, clamp: a badly skewed clock is still a real event
 * that a customer paid for, and the report is far better served by the event
 * appearing at the edge of the window than by not appearing.
 *
 * Anything unparseable falls back to the receive time, which is the one clock
 * we control.
 */
export function normalizeTimestamp(value: unknown, receivedAt: Date): { at: Date, clamped: boolean } {
  const raw = value === undefined || value === null || value === ''
    ? null
    : typeof value === 'number'
      // Sub-second values are seconds; anything larger is milliseconds. The
      // boundary is generous because a 10-digit epoch is seconds until the year
      // 2286 and a millisecond epoch has been 13 digits since 2001.
      ? new Date(value < 1e11 ? value * 1000 : value)
      : new Date(String(value))

  if (!raw || Number.isNaN(raw.getTime()))
    return { at: receivedAt, clamped: value !== undefined && value !== null && value !== '' }

  const earliest = receivedAt.getTime() - LIMITS.PAST_MS
  const latest = receivedAt.getTime() + LIMITS.FUTURE_MS

  if (raw.getTime() < earliest)
    return { at: new Date(earliest), clamped: true }

  if (raw.getTime() > latest)
    return { at: new Date(latest), clamped: true }

  return { at: raw, clamped: false }
}

/** A scalar we are willing to put in a property bag. */
function normalizeValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined)
    return null

  if (typeof value === 'number')
    return Number.isFinite(value) ? value : null

  if (typeof value === 'boolean')
    return value

  if (typeof value === 'string')
    return value.length > LIMITS.VALUE ? value.slice(0, LIMITS.VALUE) : value

  // Objects and arrays are flattened to JSON rather than dropped, so a nested
  // payload still reaches the property bag in a readable form. Truncation here
  // can produce invalid JSON, which is fine: it is being stored as a display
  // string, not re-parsed.
  try {
    const encoded = JSON.stringify(value)
    if (!encoded)
      return null
    return encoded.length > LIMITS.VALUE ? encoded.slice(0, LIMITS.VALUE) : encoded
  }
  catch {
    // Circular structures land here.
    return null
  }
}

/**
 * The property bag: bounded in key length, value length, count and total size.
 *
 * Over-count and over-size trim rather than reject, and the trimming is
 * deterministic (insertion order) so the same event always yields the same
 * stored row.
 */
export function normalizeProperties(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return '{}'

  const out: Record<string, string | number | boolean> = {}
  let count = 0

  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (count >= LIMITS.PROPERTIES)
      break

    const key = rawKey.trim().slice(0, LIMITS.KEY)
    if (!key)
      continue

    const normalized = normalizeValue(rawValue)
    if (normalized === null)
      continue

    out[key] = normalized
    count++
  }

  let encoded = JSON.stringify(out)

  // Still too big: drop properties from the end until it fits. A truncated JSON
  // string would be unreadable, so the trimming has to happen at the property
  // level rather than the character level.
  while (encoded.length > LIMITS.PROPERTIES_BYTES) {
    const keys = Object.keys(out)
    if (keys.length === 0)
      return '{}'

    delete out[keys[keys.length - 1] as string]
    encoded = JSON.stringify(out)
  }

  return encoded
}

/** Customer-chosen identifiers: trimmed, bounded, never invented. */
function normalizeKeyField(value: unknown): string | null {
  const key = String(value ?? '').trim()
  if (!key)
    return null
  return key.slice(0, LIMITS.KEY_FIELD)
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '')
    return null

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** ISO 4217: three letters, uppercased. Anything else is not a currency. */
function normalizeCurrency(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

/**
 * Normalise a batch.
 *
 * Only two things get an event dropped: no usable name, and not being an object
 * at all. Everything else is repaired, because those two are the only cases
 * where there is nothing left to store.
 */
export function normalizeBatch(input: unknown, receivedAt = new Date()): NormalizeResult {
  const events: NormalizedEvent[] = []
  const dropped: Array<{ index: number, reason: string }> = []

  if (!Array.isArray(input))
    return { events, dropped }

  const received = receivedAt.toISOString()

  input.slice(0, LIMITS.BATCH).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      dropped.push({ index, reason: 'not an object' })
      return
    }

    const incoming = raw as IncomingEvent
    const name = normalizeName(incoming.name)

    if (!name) {
      dropped.push({ index, reason: 'missing or unusable name' })
      return
    }

    const { at } = normalizeTimestamp(incoming.occurred_at ?? incoming.timestamp, receivedAt)

    events.push({
      name,
      occurred_at: at.toISOString(),
      received_at: received,
      properties: normalizeProperties(incoming.properties),
      value: normalizeNumber(incoming.value),
      currency: normalizeCurrency(incoming.currency),
      user_key: normalizeKeyField(incoming.user_key),
      session_key: normalizeKeyField(incoming.session_key),
    })
  })

  return { events, dropped }
}
