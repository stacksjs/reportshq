# @reportshq/stacks

Send a Stacks application's own events to [ReportsHQ](https://reportshq.org). Your app keeps emitting the events it already emits; this package listens, translates them into the reserved taxonomy, and ships them in the background. Then the reports build themselves.

## Install

```bash
bun add @reportshq/stacks
```

```ts
// app/Events.ts
import { listen } from '@reportshq/stacks'

export default {
  ...listen(),
}
```

```bash
# .env
REPORTSHQ_KEY=rhq_your_project_key
```

That is the whole integration. Within a few minutes of your first order or signup, the matching reports appear in your project with real numbers in them.

## What gets sent

Only the events in [the taxonomy](https://github.com/stacksjs/reportshq/blob/main/docs/events.md). An application emits dozens of events that mean nothing to a reporting taxonomy, and forwarding them under invented names would fill your project with vocabulary no report template can read, so anything unmapped is ignored.

| Your app emits | ReportsHQ receives |
|---|---|
| `order:created` | `commerce.order.created` with `value`, `currency`, `properties.order_id` |
| `order:paid` | `commerce.order.paid` |
| `order:refunded` | `commerce.order.refunded` |
| `order:cancelled` | `commerce.order.cancelled` |
| `checkout:started` | `commerce.checkout.started` |
| `cart:updated` | `commerce.cart.updated` |
| `product:viewed` | `commerce.product.viewed` |
| `customer:created` | `commerce.customer.created` |
| `user:created` | `user.registered` with `properties.plan`, `properties.source` |
| `user:login` / `user:logout` | `user.login` / `user.logout` |
| `user:deleted` / `user:invited` | `user.deleted` / `user.invited` |
| `subscription:created` | `user.subscription.started` |
| `subscription:cancelled` | `user.subscription.cancelled` |
| `post:published` / `post:viewed` | `cms.post.published` / `cms.post.viewed` |
| `comment:created` | `cms.comment.created` |

The subject of an event is taken from `user_key` / `user_id` / `customer_id` and `session_key` / `session_id`. Send a **stable internal id**, never an email or a name: it is only ever compared for equality, so anything more identifying is data nobody needed.

## Configuration

Everything is optional except the key.

```ts
listen({
  key: process.env.REPORTSHQ_KEY,          // or set REPORTSHQ_KEY
  endpoint: 'https://reportshq.org/ingest', // or REPORTSHQ_ENDPOINT, for self-hosted
  domains: { commerce: true, users: true, cms: false },
  sampleRate: 1,
  batchSize: 50,
  flushIntervalMs: 5000,
  maxBufferSize: 10_000,
  onError: error => console.warn('[reportshq]', error.message),
})
```

**With no key set, the package does nothing at all**: no listeners are registered, no timers start, no requests are made. The same code can run in tests and on a laptop without sending anything or complaining about it.

## Sampling keeps subjects whole

`sampleRate` keeps a fraction of **subjects**, not of events. Sampling events independently is the obvious implementation and it quietly ruins the reports it feeds: a funnel asks how many people who viewed a product went on to check out, and if each of those events is kept or dropped by its own coin flip, the steps stop belonging to the same people and every conversion rate becomes noise.

Here a subject is hashed, so somebody is either wholly in the sample or wholly out, and funnels, retention and unique counts all stay internally consistent. Your totals are then a sample of reality; they are not scaled up, because scaling would invent precision the sample does not have.

## It cannot slow your app down

That is the constraint the transport is built around.

- `track` appends to an in-memory buffer and returns. Nothing on your request path waits for HTTP.
- The buffer is bounded. At the limit the **oldest** events are dropped, because if delivery has been failing for a while, the recent events are the ones describing what is happening now.
- Delivery failures never throw into your code. Pass `onError` if you want to hear about them.
- `5xx` and `429` are retried with backoff. `4xx` is not: a bad key will be bad every time, and retrying is a slower way to fail while blocking everything behind it.
- Timers are unref'd, so a CLI command that sends one event still exits when its work is done.
- On `beforeExit`, `SIGINT` and `SIGTERM` the buffer is flushed. A deploy is exactly when events are most likely to be lost.

## Sending your own events

For anything the mappers do not cover:

```ts
import { createClient } from '@reportshq/stacks'

const reports = createClient()

reports.track({
  name: 'commerce.order.created',
  value: 4250,
  currency: 'USD',
  user_key: customer.id,
  properties: { plan: 'pro' },
})
```

Use a name from the taxonomy where one fits. Custom names work and are queryable, but no report template is written against them, so nothing will build itself from them.

## Adding a mapping

Add the event to `docs/events.md` first. That doc is what the report templates, the app's validation and the friendly names in the builder are all written against, and a name in one place and not the others is a report that is quietly always empty. A test asserts the mapper table and the doc agree in both directions.

## License

MIT
