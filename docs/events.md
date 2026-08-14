# Event taxonomy

The names ReportsHQ recognises, and the properties each one carries.

This document is a contract in three directions: the integration packages
([Stacks](https://github.com/stacksjs/reportshq/issues/7),
[Laravel](https://github.com/stacksjs/reportshq/issues/8)) emit these names, the
auto-report templates match on them, and a report built by hand can rely on them
meaning the same thing in every project. Send a matching event and the reports
appear on their own.

You are not limited to these. Any name works, and custom events are first-class
in the builder. What the reserved names buy you is reports you did not have to
build.

## Shape

Names are lowercase, dot-separated, and read `domain.subject.verb-in-past-tense`:

```
commerce.order.created
user.registered
cms.post.published
```

The ingest folds case and collapses separators, so `Commerce/Order Created`
arrives as `commerce.order.created`. Rely on that for forgiveness, not as a
style: send the canonical form.

Two properties carry meaning everywhere they appear:

- **`user_key`** is your own pseudonymous identifier for the person involved.
  Unique counts, repeat rate and retention are computed from it. Send a stable
  internal id or a hash, never an email address: this is not a table that should
  accumulate identities.
- **`value`** is the number a report sums or averages, with `currency` alongside
  when it is money. Send minor units (4250 for $42.50) or major units
  consistently. Consistently is the part that matters.

## `commerce.*`

Feeds the **Commerce overview** and **Customers** templates.

| Event | Required | Recommended |
|---|---|---|
| `commerce.order.created` | `value`, `currency` | `user_key`, `properties.items`, `properties.order_id` |
| `commerce.order.paid` | `value`, `currency` | `user_key`, `properties.order_id`, `properties.method` |
| `commerce.order.refunded` | `value`, `currency` | `user_key`, `properties.order_id`, `properties.reason` |
| `commerce.order.cancelled` | | `user_key`, `properties.order_id` |
| `commerce.checkout.started` | | `user_key`, `session_key`, `value`, `currency` |
| `commerce.cart.updated` | | `user_key`, `session_key`, `properties.items` |
| `commerce.product.viewed` | | `user_key`, `session_key`, `properties.sku` |
| `commerce.customer.created` | | `user_key` |

Revenue is summed from `commerce.order.paid` where you send it, and falls back
to `commerce.order.created` where you do not. Sending both without paying
attention double-counts, which is the single most common integration mistake:
if every order is paid immediately, send one of them.

The conversion funnel is `commerce.product.viewed` to
`commerce.checkout.started` to `commerce.order.created` to
`commerce.order.paid`, ordered by `session_key`. Steps you do not send are
skipped rather than counted as zero.

## `user.*`

Feeds the **Users** template: signups, active users, and a weekly retention grid.

| Event | Required | Recommended |
|---|---|---|
| `user.registered` | | `user_key`, `properties.plan`, `properties.source` |
| `user.login` | | `user_key`, `session_key` |
| `user.logout` | | `user_key`, `session_key` |
| `user.deleted` | | `user_key` |
| `user.invited` | | `user_key`, `properties.invited_by` |
| `user.subscription.started` | `value`, `currency` | `user_key`, `properties.plan`, `properties.interval` |
| `user.subscription.cancelled` | | `user_key`, `properties.plan`, `properties.reason` |

Active users and retention both need `user_key`. Without it the events still
arrive and still count, but every person looks like a different person, and the
retention grid is empty rather than wrong.

## `cms.*`

Feeds the **Content** template, which only appears once these events exist.

| Event | Required | Recommended |
|---|---|---|
| `cms.post.published` | | `properties.post_id`, `properties.author`, `properties.category` |
| `cms.post.viewed` | | `properties.post_id`, `user_key`, `session_key` |
| `cms.comment.created` | | `properties.post_id`, `user_key` |

## Custom events

Anything outside a reserved prefix is yours. Use the same shape so your own
reports read like the built-in ones:

```json
{
  "name": "support.ticket.resolved",
  "user_key": "cust_8812",
  "value": 42,
  "properties": { "queue": "billing", "first_response_minutes": 12 }
}
```

Avoid the reserved prefixes for a different meaning. Sending
`commerce.order.created` for something that is not an order will produce a
Commerce report that is confidently wrong, which is worse than no report.

## Practical notes

**Send events once.** The stream is append-only and never deduplicated after the
fact, because a report that changes retroactively is one nobody can act on.
Corrections are new events: a refund, not an edited order.

**Backfill with real timestamps.** `occurred_at` is accepted up to 30 days back,
so an import lands on the days things actually happened rather than all at once
on the day you imported. Older than that is clamped, not rejected.

**Property cardinality matters.** A property with thousands of distinct values
groups into thousands of series and reports as noise. Order ids belong in
properties for lookup; they are not something to group by.
