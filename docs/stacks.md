# The Stacks package

`@reportshq/stacks` puts the reports inside your application. It reads the
models you already have, queries them in place on the connection your
application already holds, and renders through the routes you already guard.

Nothing leaves the application. There is no endpoint to send to, no connection
to hand out, and the licence check is offline.

This is the same engine as [the Laravel package](/docs/laravel) and the same
compiled chart components, so the two cannot drift on what a number means. What
differs is only how you describe a model and where you mount it.

## Install

```bash
bun add @reportshq/stacks
buddy migrate
```

Take `0.2.0` or later. `0.1.0` carries the same name but is a different
library: it was an event-forwarding SDK from before this package became the
reporting engine, and none of the API below exists in it.

The migration creates the tables the reports live in: reports, blocks,
revisions, shares and schedules. Your own tables are only ever read.

## Describing a model

The description is the allowlist. A block can only reach what it names, so a
column nobody meant to expose is not one click away.

```ts
// config/reportshq.ts
import type { ModelDescription } from '@reportshq/stacks'

export const models: Record<string, ModelDescription> = {
  order: {
    // The table, resolved from your model rather than guessed.
    table: 'orders',
    // What may be added up. Nothing outside this is reachable.
    measures: {
      revenue: { aggregate: 'sum', column: 'total_amount', unit: 'currency' },
      orders: { aggregate: 'count' },
    },
    // Which columns are dates worth bucketing by.
    time: {
      placed: 'created_at',
    },
    // What may be grouped by.
    dimensions: {
      status: 'status',
    },
  },
}
```

Everything except `models` has a defensible default, because a reporting
package should not need a page of configuration before it shows a number. The
rest of `ReportsHQConfig` is optional:

```ts
{
  license: null,              // checked offline, never sent anywhere
  timezone: 'UTC',            // buckets are computed in this zone
  routes: {
    enabled: true,
    prefix: '/reports',
    middleware: ['auth'],
    shareMiddleware: [],      // see below - deliberately not inherited
  },
  api: {
    enabled: false,           // a JSON surface is a decision, not a default
    prefix: '/api/reportshq',
    middleware: ['auth'],
  },
}
```

`shareMiddleware` is empty on purpose. A share link is read by somebody with no
account, so it does not inherit `routes.middleware`; adding a guard there means
the link stops working for the people it was sent to.

## Wiring it up

Three objects and a store. The compiler takes the connection the application
already configured rather than opening one, because two pools with two opinions
about the same database is not something a reporting package should introduce.

```ts
// app/Support/reports.ts
import type { ReportStore } from '@reportshq/stacks'
import { Compiler, createHandlers, Registry, Runner } from '@reportshq/stacks'
import { db } from '@stacksjs/database'
import { models } from '../../config/reportshq'

const registry = new Registry(models)
const runner = new Runner(new Compiler(registry, db, 'postgres'))

const store: ReportStore = {
  async list() { /* ... */ },
  async find(slug) { /* ... */ },
  async blocks(reportId) { /* ... */ },
  async saveLayout(reportId, blocks) { /* ... */ },
}

export const reportHandlers = createHandlers(store, runner, registry)
```

The store is an interface rather than a set of tables, so an application can
decide where reports live. Backing it with your own config instead of the
migration is a supported choice: reports defined in code are reviewed in a pull
request and deployed with everything else, and `saveLayout` can simply throw.
This application does exactly that, in `config/reportshq.ts`.

## Measures the compiler will refuse

A measure belongs to the table it is declared on. Summing an order total across
joined line items counts the order once per line, so:

```ts
// Refused, and says so on the block.
{ model: 'order', measure: 'revenue', dimension: { model: 'product', key: 'name' } }

// Correct: the measure belongs to the line, so the join does not multiply it.
{ model: 'order_item', measure: 'line_revenue', dimension: { model: 'product', key: 'name' } }
```

What makes that visible is `fansOut` on the relation. It is the single most
important flag in the description: a measure summed across a one-to-many join
counts its row once per match, and the compiler refuses rather than answering,
because the wrong number is plausible.

```ts
relations: {
  product: { table: 'products', through: { table: 'order_items', foreignKey: 'order_id' }, foreignKey: 'product_id', fansOut: true },
}
```

The refusal reaches the tile with the reason on it. A plausible wrong number is
worse than an empty block, because nobody checks a number that looks right.

## It reads what you declared, not the whole table

Be aware of what this does *not* do. The compiler builds SQL and the runner
executes it on the application's existing connection, not through the ORM, so
model scopes and soft deletes do **not** apply on their own. If rows are
excluded by a scope in your application, declare the same condition on the
model here, or the report will count them. A soft-deleted order is still a row.

## Timezone

Buckets are computed in the report's timezone, which defaults to `UTC`. A daily
chart in the wrong zone is wrong by one bucket at both ends, and nobody notices
until a total is quoted next to a different total.

## Where it renders

In a Stacks application a view is the route, so the pages are stx files under
`resources/views/reports/`: dropping `[slug].stx` in there is what publishes
`/reports/{slug}`. What is left is the schema, the download and the draft, and
`reportRoutes` describes those rather than registering them, so your route file
decides the prefix and the middleware:

```ts
// routes/reports.ts
import { route } from '@stacksjs/router'
import { isNotFound, reportRoutes } from '@reportshq/stacks'
import { reportHandlers } from '../app/Support/reports'

for (const description of reportRoutes(reportHandlers)) {
  // The two page routes are served by stx. Mounting them again would give one
  // URL two handlers and make which one answers a question of registration order.
  if (description.name === 'reportshq.index' || description.name === 'reportshq.show')
    continue

  route[description.method](description.path, async request => description.handle({
    params: request?.params ?? {},
    body: request?.body ?? {},
  }))
}
```

A package that calls the router has made those decisions for the application,
which is why it describes instead. Note that a route file is only loaded if
`app/Routes.ts` names it.

Or [the JSON API](/docs/api), for a front end of your own.

## Exports, sharing, schedules

CSV and XLSX are generated on demand rather than stored and linked. The numbers
are one query away, so there is nothing to clean up and no way to serve a stale
copy.

Sharing and scheduling are documented in [sharing](/docs/sharing) and
[schedules and exports](/docs/schedules-exports).

## Requirements

Bun 1.3+ and a Stacks application. The package imports every `@stacksjs/*`
specifier by name and never reaches for a path inside the framework, which is
what lets one build serve both a vendored checkout, where those are workspaces
under `storage/framework/core`, and an unvendored one, where they come from npm.
