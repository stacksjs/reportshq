# Ingestion API

The write side of ReportsHQ. One endpoint, one credential, one shape.

```bash
curl -X POST https://reportshq.org/ingest \
  -H "X-ReportsHQ-Key: rhq_your_project_key" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "name": "commerce.order.created",
        "occurred_at": "2026-08-14T10:15:00Z",
        "value": 4250,
        "currency": "USD",
        "user_key": "cust_8812",
        "properties": { "plan": "pro", "items": 3 }
      }
    ]
  }'
```

```json
{ "ok": true, "stored": 1, "dropped": 0, "skipped": 0, "errors": [] }
```

## The key

`X-ReportsHQ-Key` carries a project's ingest key, which looks like
`rhq_` followed by 32 hex characters.

It is **public by design**. It ships inside your application, where anything
embedded is readable, so it grants exactly one capability: append events to one
project. It can never read events, reports, members or anything else about the
account. If it leaks, rotate it from project settings; the old key stops working
on the next request.

Reading events uses a bearer token instead, on a different endpoint. The two
credentials are never interchangeable.

## The request

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Dot taxonomy, lowercased. See [events.md](./events.md). |
| `occurred_at` | no | ISO 8601, or an epoch in seconds or milliseconds. Defaults to receipt time. |
| `value` | no | The number a report sums or averages. |
| `currency` | no | ISO 4217. Uppercased; anything that is not three letters is dropped. |
| `user_key` | no | Your own pseudonymous id for the person. Never send an email address. |
| `session_key` | no | Groups events from one visit. Funnels order steps by it. |
| `properties` | no | Flat object of scalars. Nested values are stored as JSON strings. |

`{ "events": [ ... ] }` is the documented shape. A bare array is also accepted,
because it is what most people try first.

## What gets repaired rather than rejected

A batch comes from a running application. Rejecting forty-nine good events
because the fiftieth had an unusable name loses real data at the worst possible
moment, so the ingest repairs what it can:

- **Names** are lowercased, separators collapse to dots, and unsupported
  characters are stripped. `Commerce/Order Created` becomes
  `commerce.order.created`. This matters: without folding, two spellings from
  one codebase become two series on every chart.
- **Timestamps** are clamped to 30 days in the past and one hour in the future
  rather than refused. A device with a wrong clock is still a real event you
  paid for. Unparseable values fall back to receipt time.
- **Property values** longer than 1024 characters are truncated. Bags with more
  than 64 properties, or larger than 8 KB, are trimmed property by property so
  the result stays valid JSON.
- **Over-long batches** are truncated to 500 events, and the remainder is
  reported as `skipped`.

Only two things get an event dropped: it is not an object, or it has no usable
name. Both are reported per row in `errors`, with the index from your batch.

## Limits

| Limit | Value | On exceeding |
|---|---|---|
| Request body | 512 KB | `413` |
| Events per request | 500 | Truncated, counted in `skipped` |
| Event name | 120 characters | Truncated |
| Property key | 64 characters | Truncated |
| Property value | 1024 characters | Truncated |
| Properties per event | 64 | Trimmed |
| Property bag | 8 KB | Trimmed |
| Requests per project | 120 per 10 seconds | `429` with `Retry-After` |
| Requests per source address | 300 per 10 seconds | `429` with `Retry-After` |

Rate limits count **requests**, not events. Combined with the batch cap that is
still an event ceiling, and it keeps the decision cheap enough to make before
parsing a body. Event volume against your plan is metered separately and bills
rather than blocks.

## Responses

| Status | Meaning |
|---|---|
| `201` | Accepted. Check `stored`, `dropped` and `skipped`. |
| `400` | The body was not valid JSON. |
| `401` | The key was missing, unknown, or revoked. |
| `413` | The body exceeded 512 KB. |
| `422` | The body parsed but had no `events` array. |
| `429` | Rate limited. Wait `retry_after` seconds. |

A `201` with `dropped > 0` is a success with a note, not a failure. Log
`errors` while integrating and the payload problem is usually obvious.

Every response except `400` uses this envelope:

```json
{ "ok": false, "error": "rate_limited", "message": "Too many requests. Slow down and retry.", "retry_after": 7 }
```

Error responses also carry a `request_id`, added by the server. Quote it if you
open a support conversation; it is how a single request is found in the logs.

`400` is the exception: the router parses the body before this endpoint runs, so
a malformed one is refused upstream with the framework's standard error shape.
Match on the status rather than on `error` if you handle that case.

## Checking a key

```bash
curl https://reportshq.org/ingest/verify -H "X-ReportsHQ-Key: rhq_your_project_key"
```

```json
{ "ok": true, "project": { "name": "Acme Storefront" } }
```

Writes nothing. Returns the project name and nothing else, so a public write
credential never becomes a way to read the account behind it. Useful in an SDK
self-test and in onboarding, before the first real event arrives.

## Reading events back

Reads are authenticated with a bearer token and scoped to a project you have
access to:

```bash
curl "https://reportshq.org/api/projects/42/events?name=commerce.order.created&limit=50" \
  -H "Authorization: Bearer <token>"
```

```json
{ "events": [ ... ], "next_cursor": 8817 }
```

Pagination is keyset, not offset: pass `next_cursor` back as `before`. An
append-only stream grows underneath a reader, so an offset silently shifts as
new events arrive and pages either repeat or skip rows. A cursor costs the same
on page 1 and page 400.

Filters: `name`, `from`, `to`, `user_key`, `before`, `limit` (max 200).
