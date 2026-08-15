/**
 * @reportshq/stacks
 *
 * Point a Stacks application at a ReportsHQ project and its reports build
 * themselves. The application keeps emitting its own events; this package
 * listens, translates them into the reserved taxonomy, and ships them in the
 * background.
 *
 * ```ts
 * // app/Events.ts
 * import { listen } from '@reportshq/stacks'
 *
 * export default {
 *   ...listen(),
 * }
 * ```
 *
 * With `REPORTSHQ_KEY` set, that is the whole integration. With it unset the
 * package is inert: no timers, no requests, no errors. That matters because the
 * same code runs in tests and on a laptop, where sending analytics would be
 * both wrong and confusing.
 */
import type { StacksEvent } from './mappers'
import type { TaxonomyEvent } from './transport'
import type { ReportsHQConfig } from './config'
import { isEnabled, resolveConfig } from './config'
import { mapEvent, mappedEventNames } from './mappers'
import { Transport } from './transport'

export type { Domain, StacksEvent } from './mappers'
export type { ReportsHQConfig, Domains } from './config'
export type { TaxonomyEvent, TransportStats } from './transport'
export { MAPPINGS, mapEvent, mappedEventNames } from './mappers'
export { shouldSample, Transport } from './transport'
export { isEnabled, resolveConfig } from './config'

export interface Client {
  /** Translate and queue a framework event. Non-blocking; never throws. */
  handle: (event: StacksEvent) => void
  /** Queue an event already in taxonomy form, for anything not covered by a mapper. */
  track: (event: TaxonomyEvent) => void
  /** Deliver everything buffered. */
  flush: () => Promise<void>
  /** Stop, delivering what is left. */
  stop: () => Promise<void>
  config: ReportsHQConfig
  stats: Transport['stats']
  pending: () => number
}

/**
 * Build a client.
 *
 * Usually called once, by `listen()`. Exported because an application that
 * wants to send its own events, or send to two projects, needs the handle.
 */
export function createClient(options: Partial<ReportsHQConfig> = {}): Client {
  const config = resolveConfig(options)
  const transport = new Transport(config)

  return {
    handle(event: StacksEvent): void {
      const mapped = mapEvent(event, config.domains)
      if (mapped)
        transport.track(mapped)
    },
    track: (event: TaxonomyEvent) => transport.track(event),
    flush: () => transport.flush(),
    stop: () => transport.stop(),
    config,
    stats: transport.stats,
    pending: () => transport.pending,
  }
}

/**
 * Listeners for `app/Events.ts`, keyed by the framework's event names.
 *
 * Returns an empty object when there is no key, so spreading it into an events
 * map is safe everywhere, including in tests and on a developer's machine. That
 * is deliberately different from registering listeners that then do nothing:
 * absent listeners cannot cost anything, and cannot appear in a debug dump as
 * something that looks broken.
 *
 * Shutdown flushing is wired here rather than left to the application, because
 * the one moment events are most likely to be lost is a deploy, and an
 * integration that quietly drops the last five seconds of every day is worse
 * than one that never claimed to be reliable.
 */
export function listen(options: Partial<ReportsHQConfig> = {}): Record<string, (payload?: Record<string, unknown>) => void> {
  const client = createClient(options)

  if (!isEnabled(client.config))
    return {}

  const listeners: Record<string, (payload?: Record<string, unknown>) => void> = {}

  for (const name of mappedEventNames(client.config.domains)) {
    listeners[name] = (payload?: Record<string, unknown>) => {
      client.handle({ name, payload: payload ?? {} })
    }
  }

  registerShutdown(client)

  return listeners
}

let shutdownRegistered = false

function registerShutdown(client: Client): void {
  if (shutdownRegistered)
    return

  const runtime = (globalThis as {
    process?: { on?: (event: string, handler: () => void) => void }
  }).process

  if (!runtime?.on)
    return

  shutdownRegistered = true

  // `beforeExit` covers a normal finish; the signals cover a container being
  // asked to stop. None of them re-raise or exit: this package has no business
  // deciding when the host process ends.
  for (const signal of ['beforeExit', 'SIGINT', 'SIGTERM']) {
    runtime.on(signal, () => {
      void client.stop()
    })
  }
}
