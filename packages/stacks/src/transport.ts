/**
 * Getting events out of the application and into ReportsHQ.
 *
 * One rule governs every decision in this file: **the host application must
 * never be slower, or less available, because of analytics.** Nothing here
 * blocks a request, nothing here grows without a bound, and nothing here throws
 * into somebody else's code. A dropped event is a bad outcome; a checkout page
 * that hangs waiting on our HTTP call is a catastrophic one, and the two are
 * not close enough to trade off carefully.
 */
import type { ReportsHQConfig } from './config'
import { isEnabled } from './config'

export interface TaxonomyEvent {
  name: string
  occurred_at?: string
  value?: number
  currency?: string
  user_key?: string
  session_key?: string
  properties?: Record<string, unknown>
}

export interface TransportStats {
  /** Accepted into the buffer. */
  queued: number
  /** Delivered to the endpoint. */
  sent: number
  /** Discarded: sampled out, or dropped because the buffer was full. */
  dropped: number
  /** Batches that failed every attempt. */
  failed: number
}

/**
 * Deterministic sampling, on the **subject** rather than on the event.
 *
 * Sampling events independently is the obvious implementation and it quietly
 * ruins the reports it feeds. A funnel asks how many people who viewed a
 * product then checked out; if each of those events is kept or dropped by its
 * own coin flip, the steps stop belonging to the same people and every
 * conversion rate becomes noise. Hashing the user or session key instead means
 * a subject is either wholly in the sample or wholly out, and every funnel,
 * retention curve and unique count stays internally consistent.
 *
 * Events with no subject key fall back to a per-event decision, since there is
 * nothing to be consistent with.
 */
export function shouldSample(event: TaxonomyEvent, rate: number, random: () => number = Math.random): boolean {
  if (rate >= 1)
    return true
  if (rate <= 0)
    return false

  const subject = event.user_key ?? event.session_key ?? ''
  if (!subject)
    return random() < rate

  // FNV-1a: small, dependency-free, and well spread for short strings. The
  // absolute values do not matter, only that the same subject always lands in
  // the same place.
  let hash = 2166136261
  for (let index = 0; index < subject.length; index++) {
    hash ^= subject.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return ((hash >>> 0) % 10000) / 10000 < rate
}

export class Transport {
  private readonly config: ReportsHQConfig
  private buffer: TaxonomyEvent[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> = Promise.resolve()
  private stopped = false
  readonly stats: TransportStats = { queued: 0, sent: 0, dropped: 0, failed: 0 }

  constructor(config: ReportsHQConfig) {
    this.config = config
  }

  /**
   * Accept an event.
   *
   * Synchronous and non-throwing by construction: it appends to an array and
   * returns. Everything that can fail happens later, on the timer.
   */
  track(event: TaxonomyEvent): void {
    if (this.stopped || !isEnabled(this.config))
      return

    if (!shouldSample(event, this.config.sampleRate)) {
      this.stats.dropped++
      return
    }

    if (this.buffer.length >= this.config.maxBufferSize) {
      // Drop the oldest, not the newest. If delivery has been failing for a
      // while, recent events describe what is happening now, and that is what
      // somebody staring at a dashboard needs.
      this.buffer.shift()
      this.stats.dropped++
    }

    this.buffer.push({ occurred_at: new Date().toISOString(), ...event })
    this.stats.queued++

    if (this.buffer.length >= this.config.batchSize)
      void this.flush()

    this.ensureTimer()
  }

  private ensureTimer(): void {
    if (this.timer || this.stopped)
      return

    this.timer = setInterval(() => void this.flush(), this.config.flushIntervalMs)

    // Never hold the process open. A CLI command that sends one event should
    // still exit when its work is done, rather than sitting on a timer for
    // five seconds because a library forgot to unref.
    const handle = this.timer as unknown as { unref?: () => void }
    handle.unref?.()
  }

  /**
   * Send everything buffered.
   *
   * Serialised against itself: two overlapping flushes would send the same
   * batch twice if the first had already taken events off the buffer, or
   * interleave retries unpredictably. Callers can await it, but nothing on the
   * request path does.
   */
  flush(): Promise<void> {
    this.inFlight = this.inFlight.then(() => this.drain()).catch(() => {})
    return this.inFlight
  }

  private async drain(): Promise<void> {
    if (this.buffer.length === 0)
      return

    // Taken before the first attempt, so events arriving during delivery
    // belong to the next batch rather than being sent twice.
    const batch = this.buffer.splice(0, this.buffer.length)

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ReportsHQ-Key': this.config.key,
          },
          body: JSON.stringify({ events: batch }),
        })

        if (response.ok) {
          this.stats.sent += batch.length
          return
        }

        // 4xx means this batch is wrong and will be wrong every time: a bad
        // key, or events the server refuses. Retrying is just a slower way to
        // fail, and it would block everything behind it. 429 is the exception,
        // since it means "later", not "no".
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          this.stats.failed += batch.length
          this.config.onError(new Error(`ReportsHQ refused a batch: ${response.status}`))
          return
        }

        if (attempt === this.config.maxRetries) {
          this.stats.failed += batch.length
          this.config.onError(new Error(`ReportsHQ did not accept a batch after ${attempt} attempts: ${response.status}`))
          return
        }
      }
      catch (error) {
        if (attempt === this.config.maxRetries) {
          this.stats.failed += batch.length
          this.config.onError(error as Error)
          return
        }
      }

      await this.wait(this.config.retryBaseMs * 2 ** (attempt - 1))
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      const handle = timer as unknown as { unref?: () => void }
      handle.unref?.()
    })
  }

  /**
   * Stop accepting events and deliver what is left.
   *
   * Awaited on shutdown, so a deploy does not throw away the last few seconds
   * of a busy day. Idempotent, because shutdown handlers fire more than once
   * more often than anybody expects.
   */
  async stop(): Promise<void> {
    if (this.stopped)
      return

    this.stopped = true

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    // stopped is set first, so nothing new arrives; this delivers the tail.
    this.inFlight = this.inFlight.then(() => this.drain()).catch(() => {})
    await this.inFlight
  }

  /** Events waiting to be sent. For tests and for a health endpoint. */
  get pending(): number {
    return this.buffer.length
  }
}
