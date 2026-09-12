# Troubleshooting

## A block shows an error but the page returns 200

This is expected when one block requests a query ReportsHQ cannot answer safely. Read the block's `error` value. Common causes are a fan-out relation, undeclared model or field, unsupported grain, invalid filter or an unavailable draft.

Fix the report or registry rather than converting the block error into a zero. Zero means the query ran and found no value; a refusal means no defensible value was calculated.

## Totals are too high after adding a dimension

The measure is probably crossing a one-to-many relation. Mark the relation `fansOut` and move the measure to the grain where it is additive. For example, use line revenue when grouping orders by product.

## Soft-deleted or tenant rows appear

The runner executes compiled SQL on the application's connection. ORM scopes do not apply automatically. Add the equivalent restrictions to the model description and ensure tenant identity comes from trusted application context, not the request body.

## Day or month buckets do not match another report

Confirm the report timezone, source timestamp and range boundaries. A UTC report and a local-time report can disagree at both range edges while each appears internally consistent.

## The API returns 404

The JSON API is disabled by default. Enable it, confirm the configured prefix and make sure the package routes are registered in the application. In Stacks, the route file must be named by `app/Routes.ts`.

## The API redirects to login

Session middleware is guarding an API route. Give the API its own token-aware middleware group. Keep browser page middleware, API middleware and share middleware separate.

## A share link asks the recipient to sign in

Authentication middleware was added to share routes. Remove it if the intended security model is possession of the revocable token. Keep application-wide controls such as trusted proxies or rate limiting if they do not require an account.

## A revoked share still works

Confirm the request is reaching the current application release and that the share lookup is not cached beyond the revocation boundary. A share is checked on every request so revocation should take effect immediately.

## A scheduled report did not arrive

Check that the scheduler and queue worker are running, the report has an eligible next-run time, mail is configured, recipients are valid and the export format is permitted by the installation's license. Inspect failed jobs before retrying.

## XLSX or scheduled delivery is unavailable

CSV is available on every plan. XLSX and scheduled email are licensed capabilities. See [limits](/docs/limits). License checks are offline and do not disable ordinary report rendering.

## The docs build succeeds locally but fails during deploy

Run the same command as the static site deployment:

```bash
PATH="$PWD/node_modules/.bin:$PATH" bun node_modules/@stacksjs/buddy/dist/cli.js build docs
test -d dist/docs/.bunpress
```

The explicit path matters on a clean runner because the docs build launches the local `bunpress` executable by name.
