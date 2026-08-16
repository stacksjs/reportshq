# Quickstart

Account to first report. Every command here is copy-pasteable, and the ones
that talk to the API are executed by `tests/feature/docs-samples.test.ts`, so
they cannot rot quietly.

## 1. Create a project

Sign up at [reportshq.org](https://reportshq.org/register), then create a
project. A project is one application: its own events, its own ingest key, its
own members. Nothing crosses between projects.

Copy the ingest key from the project's settings. It looks like
`rhq_` followed by a long string.

The key is public by design. It ships inside your application, and the only
thing it can do is append events to that one project. It can never read.

## 2. Send an event

```bash
curl -X POST https://reportshq.org/ingest \
  -H "X-ReportsHQ-Key: rhq_your_project_key" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "name": "commerce.order.created",
        "value": 4250,
        "currency": "USD",
        "user_key": "cust_8812",
        "properties": { "plan": "pro" }
      }
    ]
  }'
```

A successful call returns what it did with the batch:

```json
{ "ok": true, "stored": 1, "dropped": 0, "skipped": 0 }
```

`dropped` is events the validator refused, `skipped` is events past the
per-request cap. Neither is ever silently non-zero: when something is dropped
the response carries an `errors` array saying which event and why, so a client
that logs it can fix its own payload without opening a support conversation.
See the [ingestion reference](/docs/ingest) for the full contract.

To check a key without sending anything:

```bash
curl -X POST https://reportshq.org/ingest/verify -H "X-ReportsHQ-Key: rhq_your_project_key"
```

## 3. Watch the report build itself

`commerce.order.created` is in [the taxonomy](/docs/events), so the commerce
reports are created for your project as soon as it arrives, with the number you
just sent already in them. Open the project and they are there.

Nothing appears from nothing: a report is only created when there is data for
it. An empty dashboard of placeholder charts is worse than no dashboard.

## 4. Send events from your application instead

Curl is for trying it. In an application, install the package for your
framework and stop writing tracking calls:

- [Stacks](/docs/stacks): `bun add @reportshq/stacks`, then `...listen()` in
  `app/Events.ts`
- [Laravel](/docs/laravel): `composer require reportshq/laravel`, then the
  service provider registers itself

Both translate the events your application already emits into the taxonomy, and
both produce byte-identical payloads for the same logical event.

Anything else posts JSON to the same endpoint you just used.

## 5. Make a report of your own

The automatic reports are a starting point. Open one in the builder, or start
an empty report, and put blocks on the grid: pick what to count, what to group
by, and over what period. Every block states in one sentence what it actually
counts, so two charts called Revenue can never be confused for each other.

See the [report builder guide](/docs/builder).

## Where to go next

| You want to | Read |
|---|---|
| The full wire contract and error semantics | [Ingestion API](/docs/ingest) |
| Which event names build which reports | [Event taxonomy](/docs/events) |
| Blocks, measures, dimensions, filters | [Report builder](/docs/builder) |
| A link somebody outside the company can open | [Sharing and embeds](/docs/sharing) |
| The numbers by email, or as a spreadsheet | [Schedules and exports](/docs/schedules-exports) |
| What each plan carries | [Limits](/docs/limits) |
| Running it on your own machines | [Self-hosting](/docs/self-hosting) |
