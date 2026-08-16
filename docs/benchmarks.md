# Benchmarks

Numbers, and the machine they came from. Re-measure rather than trusting these:
a benchmark without its hardware is a rumour.

```bash
DB_CONNECTION=postgres DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=reportshq DB_USERNAME=reportshq BENCH_EVENTS=250000 bun scripts/benchmark.ts
```

The script creates its own project, writes into it, and deletes everything on the
way out, including after a failure. It is not a test on purpose: a threshold
asserted in CI measures whatever hardware the runner was given that morning, and
a suite that fails because a shared runner was busy teaches people to re-run it
until it goes green.

## Last measured

**2026-08-15**, Apple M3 Pro, 11 cores, 18 GB, Postgres 17.10 on the same
machine, Bun 1.3.14, 250,000 events across 30 days in one project.

Local Postgres over a unix socket is faster than the production box, and the
absence of network latency flatters every number here. Treat them as a ceiling
and a shape, not a promise.

### Ingest

| | |
|---|---|
| 250,000 events, batches of 500, sequential | 7.7 s |
| **Sustained rate, one worker** | **~32,000 events/s** |

Sequential rather than concurrent on purpose: this is what one request does, and
capacity planning multiplies it. The rate limit sits at 120 requests per project
per 10 seconds with a 500-event batch cap, so the ceiling a single project can
present is around 6,000 events/s, comfortably inside what one worker absorbs.

### Report queries, raw table

Each row is **one block** on a report. A page is several, so the budget that
matters is the number below times the blocks on it.

| Query | 250k events |
|---|---|
| count, 30 days, daily | 440 ms |
| sum, 30 days, daily | 478 ms |
| count_unique, 30 days, daily | 668 ms |
| count by plan (dimension), 30 days, daily | 652 ms |
| filtered count, 30 days, daily | 397 ms |
| count, 30 days, hourly | 393 ms |

### Report queries, via rollups

| Query | 250k events | vs raw |
|---|---|---|
| count, 30 days, daily | 99 ms | 4.4x |
| sum, 30 days, daily | 96 ms | 5.0x |
| Rebuilding 32 days of rollups | 639 ms | |

Only the shapes the pre-aggregate may answer are listed. A dimension, a filter,
an hourly grain or `count_unique` goes to the raw table by design, and the
reasons are in `app/Models/EventRollup.ts`.

## What the numbers say

**The rollups earn their keep at scale and not before.** At 20,000 events the raw
scan is already so cheap that the pre-aggregate is within noise of it, and
occasionally slower. That is fine: the fixed cost is a coverage lookup, and it is
the same whether it saves 5 ms or 400.

**Reports are the cost, not ingest.** One worker absorbs far more than a single
project can legally send, while a six-block report on a busy project is several
hundred milliseconds of database work without the pre-aggregate.

## A trap this benchmark fell into first

The first version built its range by hand as `now + 24 hours`. That ends a day in
the future, the rollups do not cover tomorrow, `rollupsCover` correctly returned
false, and **every query silently fell back to the raw table**. The benchmark then
measured the raw path twice and reported that the pre-aggregate made no
difference at all: 1.1x, 0.9x, nothing to see.

Nothing was broken. The fallback is exactly right, and it is quiet by design,
which is what made the measurement so convincing. The script now builds its range
with `resolveRange`, the way a report does.

The application itself does not have this problem: `resolveRange` ends a range at
the exclusive start of tomorrow, and no route accepts a raw range from a caller.
Worth knowing anyway, because the failure mode is a performance feature that
appears to do nothing while everything reports success.
