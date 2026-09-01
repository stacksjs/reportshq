import type { LogHQClient } from '@loghq/stacks'
import { install, verifyAttached } from '@loghq/stacks'
import { env } from '@stacksjs/env'
import * as logging from '@stacksjs/logging'

const { log } = logging

/**
 * Stream this app's logs to loghq.
 *
 * **Why this is not in `config/logging.ts` like the other apps.** Four of the
 * five hq apps declare loghq as a transport there:
 *
 *     transports: [loghqTransport({ key: env.LOGHQ_KEY, ... })]
 *
 * That seam does not exist here. This app is on `@stacksjs/logging` 0.70.378,
 * which exports no `registerTransport` and whose `LoggingConfig` has no
 * `transports` field, so the declarative form does not merely fail at runtime —
 * it fails `typecheck:app`, and `config/` is typechecked in this repo. Upgrading
 * the framework to reach the seam is a much larger change than this one and is
 * not what wiring up logging should cost.
 *
 * So `install()` takes the other seam it supports: it wraps the `log` singleton
 * in place, and every existing `log.info` / `log.error` call site starts
 * shipping without being touched. Verified against this app's actual installed
 * version: `activeSeam()` reports `{ seam: 'tee', via: 'log.*' }`, and lines
 * logged after it land in a `POST /logs` batch carrying the right level,
 * message, channel and environment. `log.struct` is deliberately excluded — see
 * `captureStruct` below.
 *
 * Two consequences of the tee worth knowing:
 *
 *   - It owns `log.*`. A second `install()` in the same process is detected and
 *     warned about rather than layered, but the rule is one call per process,
 *     which is why this lives behind a preload rather than in application code.
 *   - It must run before anything logs. Passing `logger` explicitly is what
 *     makes the attach synchronous; left to discover the logger by dynamic
 *     import, `install()` lands a microtask later and misses that tick.
 *
 * Trace correlation still works here, and costs nothing: this version's router
 * stamps an incoming `x-request-id` (or a fresh uuid) onto the request in
 * AsyncLocalStorage, and `@stacksjs/logging` reads it back through
 * `Symbol.for('stacks.router.requestStorage')`, so `getLogContext()` puts it on
 * every record as `trace_id`. Anything logged inside a request arrives at loghq
 * already joinable.
 *
 * With no `LOGHQ_KEY` the client disables itself on construction and drops
 * everything, so this is safe — and silent — in local dev and in CI with no env
 * setup at all.
 */
export function installLoghq(): LogHQClient {
  return install({
    key: text(env.LOGHQ_KEY),
    host: text(env.LOGHQ_HOST),
    environment: env.APP_ENV,
    channel: 'reportshq',
    // Off here, unlike the sibling apps, because this version mangles the
    // events. Driving `log.struct` on 0.70.378 through the tee produced
    // `job.undefined` as an event name, and `db.query` and `cache.*` did not
    // arrive at all. `http.request` came through intact, which is the shape
    // that makes this worth a comment rather than a silent `false`: partial
    // success is how a broken feed gets mistaken for a working one.
    //
    // Nothing in this framework version emits struct events anyway — verified,
    // no `@stacksjs/*` package calls `log.struct.*` — so this costs nothing
    // today and is worth revisiting only if that changes or the app upgrades.
    captureStruct: false,
    // Hand the logger over rather than letting it be discovered, so the wrap is
    // in place before this module finishes evaluating. See above.
    logger: logging,
  })
}

/**
 * An env value as a string, or `undefined` when it is unset or empty.
 *
 * `@stacksjs/env` at this version types every application-declared key as
 * `string | number | boolean | undefined`: `config/env.ts` constrains the value
 * with `schema.string()` at runtime, but that constraint does not reach the
 * type. Narrowing here rather than asserting it away means `LOGHQ_KEY=0` — a
 * value TypeScript would happily hand over as a number — still arrives as
 * something the client can reject as a bad key, instead of as a type error
 * somebody silences with `as string`.
 *
 * Empty collapses to `undefined` because that is what the SDK reads as "not
 * configured": an empty host would otherwise override its default with nothing.
 */
function text(value: string | number | boolean | undefined): string | undefined {
  if (value === undefined || value === '')
    return undefined
  return String(value)
}

/**
 * Report, once at boot, whether this app's logs are actually reaching loghq.
 *
 * Installing proves nothing. Three states are indistinguishable from the
 * outside and only one of them works:
 *
 *   - nothing attached, because no logger was found to wrap
 *   - attached, but the client is disabled because `LOGHQ_KEY` was empty — which
 *     is exactly what a key that never reached the box looks like
 *   - attached and delivering
 *
 * `verifyAttached()` is the only thing that separates them: it asks the logger
 * what it holds, then asks that client whether it will send.
 *
 * **This never throws.** A boot assertion that can take the app down over
 * telemetry is a worse bug than the one it detects. Logging is a dependency of
 * diagnosis, not of serving traffic.
 *
 * **And it stays quiet unless something is actually wrong.** An unconfigured key
 * is the normal, documented state in local dev and in CI, so outside production
 * it is not news and is logged at debug. A key missing *in production* is the
 * failure this exists to catch, and only there is it an error.
 */
export async function reportLoghqAttachment(): Promise<void> {
  try {
    const isProduction = String(env.APP_ENV ?? '') === 'production'
    const info = await verifyAttached()
    const where = `seam=${info.seam}${info.via ? ` via=${info.via}` : ''}`

    // Nothing attached at all means `install()` found no logger to wrap, which
    // is a misconfiguration in any environment.
    if (info.seam === 'none') {
      log.error(`loghq: install() ran but nothing attached (${where}). Logs are staying local — check that @stacksjs/logging resolves from this process.`)
      return
    }

    // Another copy of the SDK got to the logger first, so this client is fully
    // configured, holds a queue, and will never receive a line.
    if (info.seam === 'conflict') {
      log.error(`loghq: another copy of @loghq/stacks already owns the logger (${where}). Deduplicate the package so one copy is hoisted for the whole process.`)
      return
    }

    if (!info.live) {
      const why = info.disabledReason ?? 'disabled in config'
      const detail = `loghq: attached but not delivering — ${why} (${where}).`

      if (info.disabledReason === 'auth' && !isProduction) {
        // The documented local default: no key, client disables itself, logs
        // carry on to the console and the file.
        log.debug(`${detail} Expected without LOGHQ_KEY outside production.`)
        return
      }

      log.error(`${detail}${info.disabledReason === 'auth' ? ' LOGHQ_KEY is missing or rejected; on a deployed box that usually means the key never reached the environment.' : ''}`)
      return
    }

    log.debug(`loghq: attached and delivering (${where})`)
  }
  catch (err) {
    log.debug(`loghq: could not determine attachment: ${err instanceof Error ? err.message : String(err)}`)
  }
}
