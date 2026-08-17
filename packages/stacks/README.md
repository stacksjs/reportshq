# @reportshq/stacks

Reports that run inside your own Stacks application, against your own database.

Nothing leaves the application. The compiler queries in process through the
connection you already configured, the charts render in the reader's browser,
and the licence is checked offline. There is no endpoint to send anything to.

## Install

```bash
bun add @reportshq/stacks
```

Works in both framework layouts with no configuration. A **vendored** checkout
keeps `@stacksjs/*` as workspaces under `storage/framework/core`; an
**unvendored** one takes them from npm. This package imports them by name and
never by path, so the same specifier resolves in both. A test asserts that,
because the failure only appears in whichever layout the author was not using.

## Describe a model

```ts
import { Compiler, Registry, Runner } from '@reportshq/stacks'
import { db } from '@stacksjs/database'

const registry = new Registry({
  order: {
    table: 'orders',
    measures: {
      revenue: { aggregate: 'sum', column: 'total_amount', unit: 'currency' },
      orders: { aggregate: 'count' },
    },
    time: { placed: 'created_at' },
    dimensions: { status: 'status' },
  },
})

const runner = new Runner(new Compiler(registry, db))
```

**A description is an allowlist, not a hint.** Nothing outside it is reachable
by a query, which is what lets a block's configuration arrive from a browser at
all. Adding a column to a model does not expose it; adding it here does. Point
this at a `users` table and `password` stays unreachable no matter what anybody
types into a URL.

## Run a report

```ts
const blocks = await runner.report([
  { kind: 'big_number', title: 'Revenue', query: { model: 'order', measure: 'revenue' } },
  { kind: 'line', title: 'Per day', query: {
    model: 'order', measure: 'revenue', time: { key: 'placed' }, grain: 'day',
  } },
], 'Europe/Berlin')
```

Buckets are computed in the zone you pass, not in UTC. A day that starts at
midnight in Berlin is a different set of rows from one that starts at midnight
in UTC, and relabelling afterwards does not fix which rows landed where.

## Refusals

A block that cannot be answered honestly carries an `error` and no series. The
report still renders, because one impossible question is not a failed page.

The refusal worth knowing about is fan-out. Crossing a one-to-many join
multiplies the base row, so summing an order total across its line items counts
each order once per line:

```ts
// Refused: revenue belongs to the order, and the join multiplies it.
{ model: 'order', measure: 'revenue', dimension: { model: 'product', key: 'name' } }

// Correct: the measure belongs to the line, so the join does not multiply it.
{ model: 'order_item', measure: 'line_revenue', dimension: { model: 'product', key: 'name' } }
```

That number would have been plausible and wrong, which is why it is a refusal
rather than a warning.

## Values are parameterised, identifiers are not taken from input

Filter values are bound. Identifiers cannot be bound, so they are never read
from a request: a measure resolves to a described aggregate and column, a
dimension to a described column, a grain to one of four constants. That is a
stronger guarantee than escaping would be.

## Known limit

On SQLite the timezone offset is resolved in JavaScript and applied as a fixed
shift, because SQLite carries no timezone database. That is correct except for
a bucket spanning a daylight-saving transition, where one hour lands on the
wrong side. Postgres and MySQL use their own zone handling and do not have this
limit. It is stated rather than silent.

## Pages and routes

The package ships stx views and describes its routes; the application mounts
them. A package that calls the router has decided the prefix and the middleware
on the application's behalf, and a Stacks app has its own opinions about both.

```ts
import { createHandlers, reportRoutes } from '@reportshq/stacks'
import { route } from '@stacksjs/router'

const handlers = createHandlers(store, runner, registry)

for (const r of reportRoutes(handlers))
  route[r.method](r.path, r.handle)
```

The views render the same compiled chart components the Laravel package ships
and the marketing site loads, so a chart is written once in stx and drawn
everywhere rather than once per host language.

One thing worth knowing if you write your own view: the element is built in the
server script with `elementHtml(block)` and printed with `{!! !!}`, not written
as a tag in the template. A template cannot interpolate a tag name, and
`<div is="{{ tag }}">` is the customized-built-in form, which renders a plain
div with an attribute nobody reads.

## Licence

Checked offline, and nothing gates a report. An unlicensed application reports
on its own data exactly as a licensed one does; the pages say so and that is
the whole of it. A reporting tool that blanks a dashboard over a billing state
is one nobody can rely on for the dashboard.
