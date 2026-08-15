# API

Two surfaces, with two different credentials, and one of them is not finished.

## Writing: the ingest API

**This is the public API.** One endpoint, one credential, one shape, documented
in full in the [ingestion reference](/ingest).

```bash
curl -X POST https://reportshq.org/ingest \
  -H "X-ReportsHQ-Key: rhq_your_project_key" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"name":"commerce.order.created","value":4250,"currency":"USD"}]}'
```

The key is public by design: it ships inside your application, and it grants
exactly one capability, appending events to one project. It can never read.

To check a key points where you think it does:

```bash
curl https://reportshq.org/ingest/verify -H "X-ReportsHQ-Key: rhq_your_project_key"
```

That returns the project's name and nothing else, so a write credential never
becomes a way to read the account behind it.

## Reading: bearer authenticated, and not yet self-serve

The read endpoints authenticate with a personal access token in an
`Authorization` header:

```bash
curl "https://reportshq.org/api/projects/42/events?name=commerce.order.created&limit=50" \
  -H "Authorization: Bearer <token>"
```

Pagination is keyset rather than offset: pass `next_cursor` back as `before`.
See [the ingestion reference](/ingest) for the response shape and the reasoning.

**The gap worth stating plainly:** there is currently no way to mint a
standalone API token from the interface. The token that works is the one behind
your session cookie, which is issued at sign-in and not intended to be copied
into scripts. So the read API is real and works, but it is not yet something
you can integrate against properly, and it is not versioned or stable.

Issuing revocable per-project API tokens is the missing piece. Until it exists,
treat the read endpoints as internal.

## Why there is no generated reference here

`buddy generate:openapi` produces a specification with several hundred paths,
almost all of which are routes the framework mounts by default rather than part
of this product. Publishing it would document endpoints that are not ReportsHQ's
and, in some cases, are not mounted at all, and a reader cannot tell which is
which. A reference that cannot be trusted is worse than none.

When the read API has its own credentials and a stable surface, it gets a
reference generated from that surface alone.

## Getting data out today

- [Exports](/schedules-exports): CSV and XLSX in a long format built for a
  spreadsheet
- [Scheduled delivery](/schedules-exports): the headline numbers by email on a
  timer
- [Share links and embeds](/sharing): a live report in a page of your own
- [Self-hosting](/self-hosting): your own database, which you can query however
  you like
