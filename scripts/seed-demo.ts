/**
 * A demo project with a believable month of events and two reports.
 *
 * Every UI issue after this one develops against this seed, so it has to look
 * like a real account rather than a fixture: weekday and weekend traffic differ,
 * revenue varies per order, a slice of orders get refunded, and returning
 * customers reappear across days. A chart built against flat, uniform data
 * looks fine and then falls apart the first time it meets a real project.
 *
 * Idempotent. Running it twice replaces the demo rather than doubling it, which
 * is what you want while iterating on a page that reads it.
 *
 *   bun scripts/seed-demo.ts
 */
import { db } from '@stacksjs/database'
import { storeEvents } from '../app/Events/ingest'
import { addBlock, createReport, publishReport } from '../app/Reports/reports'
import { createProject } from '../app/Support/projects'

const DEMO_EMAIL = 'demo@reportshq.test'
const DEMO_PROJECT = 'Northwind Supply'
const DAYS = 30

/** Deterministic, so two runs produce the same shape and diffs stay readable. */
function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const random = makeRandom(20260814)

function pick<T>(values: T[]): T {
  return values[Math.floor(random() * values.length)] as T
}

async function clearExisting(): Promise<void> {
  const users = await db.unsafe(`SELECT id FROM users WHERE email = $1`, [DEMO_EMAIL]) as Array<{ id: number }>
  if (users.length === 0)
    return

  const projects = await db.unsafe(`SELECT id FROM projects WHERE owner_id = $1`, [users[0]!.id]) as Array<{ id: number }>

  for (const project of projects) {
    const reports = await db.unsafe(`SELECT id FROM reports WHERE project_id = $1`, [project.id]) as Array<{ id: number }>
    for (const report of reports) {
      await db.unsafe(`DELETE FROM report_revisions WHERE report_id = $1`, [report.id])
      await db.unsafe(`DELETE FROM report_blocks WHERE report_id = $1`, [report.id])
    }
    await db.unsafe(`DELETE FROM reports WHERE project_id = $1`, [project.id])
    await db.unsafe(`DELETE FROM events WHERE project_id = $1`, [project.id])
    await db.unsafe(`DELETE FROM project_members WHERE project_id = $1`, [project.id])
    await db.unsafe(`DELETE FROM project_invites WHERE project_id = $1`, [project.id])
  }

  await db.unsafe(`DELETE FROM projects WHERE owner_id = $1`, [users[0]!.id])
  await db.unsafe(`DELETE FROM users WHERE id = $1`, [users[0]!.id])
}

async function seed(): Promise<void> {
  await clearExisting()

  await db.unsafe(
    `INSERT INTO users (name, email, password, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    ['Ana Reis', DEMO_EMAIL, 'seeded-not-a-login'],
  )
  const user = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [DEMO_EMAIL]))?.[0] as { id: number }
  const owner = { id: Number(user.id) }

  const project = await createProject(owner, { name: DEMO_PROJECT, timezone: 'Europe/Lisbon' })
  const projectId = Number(project.id)

  // A pool of customers, some of whom come back. Retention and repeat rate are
  // meaningless without that overlap.
  const customers = Array.from({ length: 240 }, (_, i) => `cust_${5000 + i}`)
  const returning = customers.slice(0, 60)
  const plans = ['starter', 'pro', 'scale']
  const sources = ['organic', 'referral', 'paid', 'email']

  const events: Array<Record<string, unknown>> = []
  const now = Date.now()

  for (let day = DAYS - 1; day >= 0; day--) {
    const date = new Date(now - day * 24 * 60 * 60 * 1000)
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6

    // Weekends are quieter, and the trend drifts upward across the month.
    const trend = 1 + (DAYS - day) / (DAYS * 2)
    const orders = Math.round((weekend ? 6 : 14) * trend * (0.75 + random() * 0.5))
    const signups = Math.round((weekend ? 3 : 7) * trend * (0.7 + random() * 0.6))

    for (let i = 0; i < signups; i++) {
      events.push({
        name: 'user.registered',
        occurred_at: new Date(date.getTime() + random() * 86_400_000).toISOString(),
        user_key: pick(customers),
        properties: { plan: pick(plans), source: pick(sources) },
      })
    }

    for (let i = 0; i < orders; i++) {
      const at = new Date(date.getTime() + random() * 86_400_000)
      // Returning customers are over-represented, as they are in a real store.
      const customer = random() < 0.35 ? pick(returning) : pick(customers)
      const total = Math.round((1800 + random() * 24_000)) / 100
      const session = `sess_${Math.floor(random() * 1e9).toString(36)}`

      events.push({
        name: 'commerce.product.viewed',
        occurred_at: new Date(at.getTime() - 9 * 60_000).toISOString(),
        user_key: customer,
        session_key: session,
        properties: { sku: `SKU-${100 + Math.floor(random() * 40)}` },
      })

      events.push({
        name: 'commerce.checkout.started',
        occurred_at: new Date(at.getTime() - 4 * 60_000).toISOString(),
        user_key: customer,
        session_key: session,
        value: total,
        currency: 'EUR',
      })

      events.push({
        name: 'commerce.order.created',
        occurred_at: at.toISOString(),
        user_key: customer,
        session_key: session,
        value: total,
        currency: 'EUR',
        properties: { items: 1 + Math.floor(random() * 4), plan: pick(plans) },
      })

      // A minority of orders are refunded a day or two later, so the refund
      // rate is a real number rather than zero.
      if (random() < 0.06) {
        events.push({
          name: 'commerce.order.refunded',
          occurred_at: new Date(at.getTime() + (1 + random()) * 86_400_000).toISOString(),
          user_key: customer,
          value: total,
          currency: 'EUR',
          properties: { reason: pick(['damaged', 'late', 'changed mind']) },
        })
      }
    }
  }

  // Written in chunks, through the same path the ingest uses, so the seed
  // exercises normalisation rather than bypassing it.
  let stored = 0
  for (let i = 0; i < events.length; i += 400) {
    const result = await storeEvents(projectId, events.slice(i, i + 400))
    stored += result.stored
  }

  const revenue = await createReport(projectId, owner, {
    name: 'Revenue overview',
    description: 'Orders, revenue and refunds across the last 30 days.',
  })
  const revenueId = Number(revenue.id)

  await addBlock(revenueId, {
    kind: 'big_number',
    title: 'Revenue',
    layout: { x: 0, y: 0, w: 3, h: 2 },
    query: { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [], compare: true },
  })

  await addBlock(revenueId, {
    kind: 'big_number',
    title: 'Orders',
    layout: { x: 3, y: 0, w: 3, h: 2 },
    query: { events: ['commerce.order.created'], measure: 'count', filters: [], compare: true },
  })

  await addBlock(revenueId, {
    kind: 'big_number',
    title: 'Average order value',
    layout: { x: 6, y: 0, w: 3, h: 2 },
    query: { events: ['commerce.order.created'], measure: 'avg', field: 'value', filters: [] },
  })

  await addBlock(revenueId, {
    kind: 'big_number',
    title: 'Refunded',
    layout: { x: 9, y: 0, w: 3, h: 2 },
    query: { events: ['commerce.order.refunded'], measure: 'sum', field: 'value', filters: [] },
  })

  await addBlock(revenueId, {
    kind: 'line',
    title: 'Revenue per day',
    layout: { x: 0, y: 2, w: 8, h: 5 },
    query: { events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [], grain: 'day', compare: true },
  })

  await addBlock(revenueId, {
    kind: 'donut',
    title: 'Orders by plan',
    layout: { x: 8, y: 2, w: 4, h: 5 },
    query: { events: ['commerce.order.created'], measure: 'count', dimension: 'properties.plan', filters: [], limit: 5 },
  })

  await addBlock(revenueId, {
    kind: 'funnel',
    title: 'Browse to order',
    layout: { x: 0, y: 7, w: 12, h: 4 },
    query: {
      events: [],
      measure: 'count',
      filters: [],
      steps: ['commerce.product.viewed', 'commerce.checkout.started', 'commerce.order.created'],
    },
  })

  await publishReport(revenueId, owner)

  const users = await createReport(projectId, owner, {
    name: 'Customers',
    description: 'Signups, active customers and where they came from.',
  })
  const usersId = Number(users.id)

  await addBlock(usersId, {
    kind: 'big_number',
    title: 'New customers',
    layout: { x: 0, y: 0, w: 4, h: 2 },
    query: { events: ['user.registered'], measure: 'count', filters: [], compare: true },
  })

  await addBlock(usersId, {
    kind: 'big_number',
    title: 'Buying customers',
    layout: { x: 4, y: 0, w: 4, h: 2 },
    query: { events: ['commerce.order.created'], measure: 'count_unique', filters: [] },
  })

  await addBlock(usersId, {
    kind: 'bar',
    title: 'Signups per day',
    layout: { x: 0, y: 2, w: 8, h: 5 },
    query: { events: ['user.registered'], measure: 'count', filters: [], grain: 'day' },
  })

  await addBlock(usersId, {
    kind: 'table',
    title: 'Signups by source',
    layout: { x: 8, y: 2, w: 4, h: 5 },
    query: { events: ['user.registered'], measure: 'count', dimension: 'properties.source', filters: [], limit: 10 },
  })

  await addBlock(usersId, {
    kind: 'text',
    layout: { x: 0, y: 7, w: 12, h: 1 },
    body: 'Buying customers counts distinct user keys, so one person ordering twice counts once.',
  })

  await publishReport(usersId, owner)

  console.log(`Seeded ${DEMO_PROJECT}`)
  console.log(`  project ${projectId}, ingest key ${String(project.ingest_key).slice(0, 12)}...`)
  console.log(`  ${stored} events across ${DAYS} days`)
  console.log(`  2 published reports: revenue-overview (7 blocks), customers (5 blocks)`)
}

await seed()
