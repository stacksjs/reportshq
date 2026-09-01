/**
 * Attach loghq to this app's logger, before anything has logged.
 *
 * This app has no app-owned `preloader.ts` to hang the attachment off — its
 * preload chain ends in the vendored framework one under
 * `storage/framework/defaults/`, which must not be edited — so it gets its own
 * entry in `bunfig.toml`, after the framework preloader.
 *
 * A preload is the right place for it rather than a convenient one. loghq
 * attaches here by wrapping the `log` singleton in place (see
 * `app/Support/loghq.ts` for why it cannot use the declarative transport the
 * sibling apps use), and a wrap only captures what is logged after it. Anything
 * later — a route file, a service provider, the server's own boot — has already
 * let the framework's startup lines past.
 *
 * The install is synchronous and at top level for the same reason: `install()`
 * left to discover the logger by dynamic import attaches a microtask later, and
 * that gap is exactly where boot logs live. `app/Support/loghq.ts` hands it the
 * logger to close the gap.
 *
 * The skip list is deliberately short, and shorter than the framework
 * preloader's own `fastCommands`. This is not a diagnostic that can be skipped
 * for speed — it is the feature — so it stays attached for `dev`, `build`,
 * `serve`, `migrate` and the rest, where the logs are worth having. It is
 * skipped only where shipping would be wrong rather than merely slow: a test
 * suite must not be able to spend the project's ingest quota, and `lint`,
 * `format` and the help/version commands have no application logs to send.
 *
 * Production is unaffected by the list either way: both deployed processes start
 * as `bun <entry-file>` with no arguments at all.
 */

import { installLoghq, reportLoghqAttachment } from '../../app/Support/loghq'

const args = process.argv.slice(2)

// No argv[1] means a REPL or `bun -e`, which has no boot to ship.
const isRepl = !process.argv[1]

const localOnlyCommands = [
  'test',
  'lint',
  'format',
  'version',
  '--version',
  '-v',
  'help',
  '--help',
  '-h',
]

const skip = isRepl
  || (args.length > 0 && localOnlyCommands.some(cmd => args[0] === cmd || args[0]!.startsWith(`${cmd}:`)))

if (!skip) {
  installLoghq()

  // Not awaited: the report asks the logger what it holds, which initialises it
  // and loads config. A diagnostic must not sit on the boot path, and must not
  // be able to fail the boot even if it throws.
  void reportLoghqAttachment().catch(() => {})
}
