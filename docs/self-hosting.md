# Self-hosting

ReportsHQ is a Stacks application and the source is public, including the parts
that enforce billing. What you run yourself is the same code, not a hobbled
community edition with the useful half removed.

## Requirements

- Bun 1.3 or newer
- SQLite 3.47.2 or newer, or Postgres
- A mail server, if you want scheduled delivery to work

## Getting it running

```bash
git clone https://github.com/stacksjs/reportshq
cd reportshq
bun install
cp .env.example .env
./buddy key:generate
./buddy migrate
./buddy dev
```

`buddy migrate` creates the schema from the models. Migrations are generated
from `app/Models/`, so there is no hand-written SQL to keep in step.

## Every limit falls away

Leave the billing keys unset and no tier limit applies.

This is not generosity. The gates read a plan, the plan comes from a billing
provider, and with no provider configured there is nothing to enforce a limit
against. Pretending otherwise would just be a nag screen in software you are
already running.

What that means concretely: no event quota, no project or report caps, and
every capability available, including scheduled delivery, XLSX export and
unbranded shares.

## Database

SQLite is the default and is genuinely fine for a single project of moderate
volume. Events are the table that grows, and retention pruning keeps it bounded.

For anything busy, point `DATABASE_URL` at Postgres. The query builder targets
both, and the test suite runs against both.

## Ingest hygiene

The ingest endpoint is public by design: it authenticates with a project key
that ships inside your application. Two things are worth setting up.

**Retention.** The prune job deletes raw events past their retention window and
leaves the daily rollups, so old reports still show correct totals. Without a
plan there is no configured window, so set one deliberately rather than letting
the table grow forever.

**A rate limit at the edge.** The application bounds batch sizes and payloads,
but a reverse proxy is the right place to stop a flood before it reaches Bun.

## Mail

Scheduled delivery, quota notices and password resets all need mail. Configure
`config/email.ts` with your SMTP details. Without it, the application runs
normally and those features do not send.

## Upgrades

```bash
git pull
bun install
./buddy migrate
```

Migrations are additive and generated from the models. Review the generated
file before applying it in production, the same as you would any migration.

## What you take on

Your own database, your own backups, your own mail server, and your own
upgrades. That is the real cost of self-hosting anything, and it is worth
stating plainly rather than letting somebody discover it the first time a
report fails to send.

The hosted plans exist so that this is somebody else's evening. Both are
legitimate choices.
