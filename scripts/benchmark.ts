/**
 * Measure the three things a slow day would show up in first.
 *
 * Run it, read the numbers, and put them in docs/benchmarks.md with the machine
 * they came from. It is deliberately a script rather than a test: a threshold
 * asserted in CI measures whatever hardware the runner happened to allocate, and
 * a suite that fails because a shared runner was busy teaches people to re-run
 * it until it passes, which is worse than not measuring.
 *
 * Point it at Postgres, which is what production runs:
 *
 *   DB_CONNECTION=postgres DB_HOST=127.0.0.1 DB_PORT=5432 \
 *   DB_DATABASE=reportshq DB_USERNAME=reportshq bun scripts/benchmark.ts
 *
 * It creates its own project, writes into it, and deletes everything on the way
 * out, including after a failure.
 */
import { db } from '@stacksjs/database'
import { storeEvents } from '../app/Events/ingest'
import { runQuery } from '../app/Reports/engine'
import { resolveRange } from '../app/Reports/range'
import { rebuildProject } from '../app/Reports/rollup'
import { createProject } from '../app/Support/projects'

const EVENTS = Number(process.env.BENCH_EVENTS ?? 50_000)
const BATCH = 500
const DAYS = 30

const stamp = Date.now()
let ownerId = 0
let projectId = 0

/** Wall clock around one thing, in milliseconds. */
async function timed<T>(label: string, work: () => Promise<T>): Promise<{ label: string, ms: number, result: T }> {
  const started = Bun.nanoseconds()
  const result = await work()
  const ms = (Bun.nanoseconds() - started) / 1_000_000
  return { label, ms, result }
}

function report(label: string, ms: number, extra = ''): void {
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(0).padStart(7)} ms  ${extra}`)
}

async function setUp(): Promise<void> {
  const email = `bench-${stamp}@reportshq.test`
  await db.unsafe(
    `INSERT INTO users (name, email, password, plan, created_at) VALUES ($1, $2, $3, 'pro', CURRENT_TIMESTAMP)`,
    ['bench', email, 'not-a-real-hash'],
  )
  ownerId = Number(((await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email])) as any)[0].id)
  projectId = Number((await createProject({ id: ownerId }, { name: `Bench ${stamp}`, timezone: 'UTC' })).id)
}

async function tearDown(): Promise<void> {
  if (!projectId)
    return
  await db.unsafe(`DELETE FROM rollup_states WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM event_rollups WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM usage_counters WHERE project_id = $1`, [projectId])
  await db.unsafe(`DELETE FROM projects WHERE id = $1`, [projectId])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [ownerId])
}

/** One batch of events, spread across the last DAYS days. */
function batch(offset: number): Array<Record<string, unknown>> {
  const now = Date.now()
  return Array.from({ length: BATCH }, (_, index) => {
    const n = offset + index
    const day = n % DAYS
    return {
      name: n % 5 === 0 ? 'user.registered' : 'commerce.order.created',
      occurred_at: new Date(now - day * 86_400_000 - (n % 24) * 3_600_000).toISOString(),
      value: Number((10 + (n % 90) + (n % 7) * 0.13).toFixed(2)),
      currency: 'USD',
      user_key: `cust_${n % 5000}`,
      session_key: `sess_${n % 9000}`,
      properties: { plan: ['free', 'pro', 'scale'][n % 3], country: ['DE', 'US', 'GB'][n % 3] },
    }
  })
}

async function main(): Promise<void> {
  console.log(`\nreportshq benchmark: ${EVENTS.toLocaleString()} events, ${process.env.DB_CONNECTION ?? 'sqlite'}\n`)
  await setUp()

  // Ingest. Batches are written one after another rather than concurrently: the
  // number wanted is what one worker sustains, since that is what a single
  // request does and what capacity planning multiplies.
  const ingest = await timed('ingest', async () => {
    for (let written = 0; written < EVENTS; written += BATCH)
      await storeEvents(projectId, batch(written))
  })
  report(`ingest ${EVENTS.toLocaleString()} events (batches of ${BATCH})`, ingest.ms,
    `${Math.round(EVENTS / (ingest.ms / 1000)).toLocaleString()} events/s`)

  // Every query below is one block on a report. A report is several, so the
  // budget that matters is this number times the blocks on a page.
  const queries: Array<[string, Record<string, unknown>]> = [
    ['count, 30 days, daily', { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day' }],
    ['sum, 30 days, daily', { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [], grain: 'day' }],
    ['count_unique, 30 days, daily', { events: ['commerce.order.created'], measure: 'count_unique', filters: [], grain: 'day' }],
    ['count by plan, 30 days, daily', { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'day', dimension: 'properties.plan' }],
    ['filtered count, 30 days, daily', { events: ['commerce.order.created'], measure: 'count', grain: 'day', filters: [{ field: 'properties.plan', operator: 'is', value: 'pro' }] }],
    ['count, 30 days, hourly', { events: ['commerce.order.created'], measure: 'count', filters: [], grain: 'hour' }],
  ]

  // Built the way a report builds it, not by hand. A hand-rolled `now + 24h`
  // ends a day into the future, the rollups do not cover tomorrow, and every
  // query silently falls back to the raw table: the benchmark then measures the
  // raw path twice and reports that the pre-aggregate makes no difference.
  const range = resolveRange('last_30_days', 'UTC')

  console.log('\n  raw table:')
  const rawTimings: Array<{ label: string, ms: number }> = []
  for (const [label, query] of queries) {
    const run = await timed(label, () => runQuery({ projectId, range, query: query as never }))
    rawTimings.push({ label, ms: run.ms })
    report(label, run.ms, `total ${Number(run.result.total).toLocaleString()}`)
  }

  const build = await timed('rebuild rollups', () => rebuildProject(projectId, DAYS + 2, 'UTC'))
  console.log('')
  report(`rebuild ${DAYS + 2} days of rollups`, build.ms)

  // Only the shapes the rollups may answer. The rest stay raw by design, and
  // timing them again would just repeat the numbers above.
  console.log('\n  via rollups:')
  for (const [label, query] of queries.slice(0, 2)) {
    const run = await timed(label, () => runQuery({ projectId, range, query: query as never }))
    const raw = rawTimings.find(entry => entry.label === label)?.ms ?? run.ms
    report(label, run.ms, `${(raw / run.ms).toFixed(1)}x faster than raw`)
  }

  console.log('')
}

try {
  await main()
}
finally {
  await tearDown()
}
