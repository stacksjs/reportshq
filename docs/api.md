# The query API

JSON, served by your own application. There is no hosted endpoint and no key to
send: these routes live inside the app the package is installed into, behind
whatever middleware you already use.

Off by default. Turn it on when you want it:

```php
// config/reportshq.php
'api' => [
    'enabled' => env('REPORTSHQ_API', false),
    'prefix' => env('REPORTSHQ_API_PREFIX', 'api/reportshq'),
    'middleware' => ['api'],
],
```

It is a separate group from the pages, with separate middleware, because the two
fail differently. A page wants a session and a redirect to a login. An API call
wants a token and a 401.

## Reading

```bash
curl -s http://localhost:8000/api/reportshq/reports
curl -s http://localhost:8000/api/reportshq/reports/commerce-overview
curl -s http://localhost:8000/api/reportshq/reports/commerce-overview/draft
curl -s http://localhost:8000/api/reportshq/schema
```

`/reports/{slug}` serves the published snapshot. The draft is a separate
endpoint rather than a flag, so a client cannot ask for it by accident and show
somebody's half arranged grid on a shared link.

`/schema` returns what the builder may offer, from the same allowlist the
compiler reads. A panel therefore cannot suggest a field the query would then
refuse.

## The block shape

```json
{
  "kind": "big_number",
  "title": "Revenue",
  "series": [{ "key": "revenue", "total": 15000, "points": [...] }],
  "total": 15000,
  "error": null
}
```

This is the shape the chart components read directly. There is no second shape
and no translation layer: the components are compiled from stx and consume this
as it stands, which is what stops the server and the charts drifting apart.

## Refusals arrive on the block

A block that cannot be answered honestly carries an `error` and no series. The
call still returns 200, because one impossible block is not a failed page.

```json
{ "kind": "table", "error": "revenue reads several rows per one order", "series": [] }
```

That example is the common one: summing an order total across joined line items
counts the order once per line. The number would be plausible and wrong, so it
is refused instead. See [the builder](/builder) for the rest of the refusals.

## Writing

The builder's own endpoints, reused rather than duplicated. A second set of
routes doing the same writes would be a second set of rules about what a drag
meant.

```bash
curl -X POST .../api/reportshq/reports/commerce-overview/blocks -d '{"kind":"bar"}'
curl -X POST .../api/reportshq/reports/commerce-overview/layout -d '{"blocks":[...]}'
curl -X POST .../api/reportshq/reports/commerce-overview/publish
```

Layout is packed on the server as well as in the browser, and the response
carries the canonical positions back. What is stored and what you saw cannot
disagree.

## Sharing

```bash
curl -X POST .../api/reportshq/reports/commerce-overview/shares -d '{"label":"Board"}'
curl -s .../api/reportshq/reports/commerce-overview/shares
curl -X DELETE .../api/reportshq/reports/commerce-overview/shares/1
```

The token is returned exactly once, when the link is created, because that is
the moment it is copied. Afterwards the list shows only its first few
characters: a screenshot of a sharing panel should not be a credential.
