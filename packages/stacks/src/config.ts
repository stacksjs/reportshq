/**
 * How the integration is configured.
 *
 * Everything has a default that is safe in production, because the common case
 * is somebody setting one environment variable and never opening this file. The
 * defaults are chosen so that a misconfigured integration is *quiet and
 * harmless* rather than loud and expensive: no key means it does nothing at all.
 */

export interface Domains {
  /** `commerce.*` events: orders, checkout, products, carts. */
  commerce: boolean
  /** `user.*` events: registration, sign-in, subscriptions. */
  users: boolean
  /** `cms.*` events: posts, comments. */
  cms: boolean
}

export interface ReportsHQConfig {
  /** The project's ingest key. Without it, nothing is sent. */
  key: string
  /** Where to send. Overridable for self-hosted installs and for tests. */
  endpoint: string
  domains: Domains
  /**
   * Fraction of *subjects* to keep, 0 to 1.
   *
   * Not a fraction of events: see `shouldSample` in transport.ts for why that
   * distinction is the difference between a funnel that means something and one
   * that does not.
   */
  sampleRate: number
  /** Events buffered before a flush is triggered by size. */
  batchSize: number
  /** Milliseconds between flushes when the batch never fills. */
  flushIntervalMs: number
  /**
   * Most events held in memory at once.
   *
   * When this is reached the **oldest** are dropped. An application must never
   * fall over because its analytics could not be delivered, and old events are
   * the least valuable thing in the buffer by the time it is full.
   */
  maxBufferSize: number
  /** Delivery attempts per batch, including the first. */
  maxRetries: number
  /** Milliseconds before the first retry; doubles each attempt. */
  retryBaseMs: number
  /** Called with anything that goes wrong. Silent by default. */
  onError: (error: Error) => void
}

const DEFAULTS: Omit<ReportsHQConfig, 'key'> = {
  endpoint: 'https://reportshq.org/ingest',
  domains: { commerce: true, users: true, cms: true },
  sampleRate: 1,
  batchSize: 50,
  // Five seconds. Long enough that a busy endpoint batches properly, short
  // enough that somebody watching the onboarding screen sees their test event
  // arrive while they are still looking at it.
  flushIntervalMs: 5000,
  maxBufferSize: 10_000,
  maxRetries: 3,
  retryBaseMs: 500,
  onError: () => {},
}

function envValue(name: string): string {
  // Read defensively: this package runs inside somebody else's application and
  // must not assume a particular runtime's globals exist.
  const source = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return String(source?.[name] ?? '').trim()
}

function clamp(value: number, low: number, high: number, fallback: number): number {
  if (!Number.isFinite(value))
    return fallback
  return Math.min(Math.max(value, low), high)
}

/**
 * Resolve configuration from explicit options, then the environment.
 *
 * Options win over the environment so a test, or an app with several projects,
 * can be explicit without unsetting anything.
 */
export function resolveConfig(options: Partial<ReportsHQConfig> = {}): ReportsHQConfig {
  const key = String(options.key ?? envValue('REPORTSHQ_KEY'))
  const endpoint = String(options.endpoint ?? envValue('REPORTSHQ_ENDPOINT') ?? '') || DEFAULTS.endpoint

  return {
    key,
    endpoint,
    domains: { ...DEFAULTS.domains, ...(options.domains ?? {}) },
    sampleRate: clamp(Number(options.sampleRate ?? DEFAULTS.sampleRate), 0, 1, DEFAULTS.sampleRate),
    // At least one, or a flush by size never happens and everything waits for
    // the timer.
    batchSize: Math.max(1, Math.trunc(Number(options.batchSize ?? DEFAULTS.batchSize)) || DEFAULTS.batchSize),
    flushIntervalMs: Math.max(250, Number(options.flushIntervalMs ?? DEFAULTS.flushIntervalMs)),
    maxBufferSize: Math.max(1, Math.trunc(Number(options.maxBufferSize ?? DEFAULTS.maxBufferSize)) || DEFAULTS.maxBufferSize),
    maxRetries: clamp(Math.trunc(Number(options.maxRetries ?? DEFAULTS.maxRetries)), 1, 10, DEFAULTS.maxRetries),
    retryBaseMs: Math.max(0, Number(options.retryBaseMs ?? DEFAULTS.retryBaseMs)),
    onError: options.onError ?? DEFAULTS.onError,
  }
}

/**
 * Whether this configuration can send anything at all.
 *
 * A rate of zero counts as off, not as "sample nothing but keep working": with
 * no key and with no sample there is equally nothing to do, and both should
 * cost the application nothing rather than buffering events to discard them.
 */
export function isEnabled(config: ReportsHQConfig): boolean {
  return config.key.length > 0 && config.sampleRate > 0
}
