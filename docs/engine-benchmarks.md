# Engine benchmarks

Measured, not estimated. Re-run these before claiming a change made anything
faster, and record the new numbers here with the date and the machine.

## 2026-08-14, one million events

SQLite, WAL, on an Apple Silicon laptop. One project holding 1,000,000 events
spread across 30 days, three event names, a `plan` property with three values,
and 50,000 distinct `user_key` values. Ten runs per query after a warm-up,
straight through the engine with no cache.

| Query | p95 | median |
|---|---:|---:|
| 30-day daily line, `sum(value)` | 467ms | 422ms |
| The same with a previous-period comparison | 445ms | 411ms |
| 30-day daily, split by `properties.plan`, top 6 | 773ms | 469ms |
| Unique customers, 30 days, `count_unique` | 711ms | 583ms |

For scale, the same queries against the 1,603-event demo seed run in 11ms to
23ms, so these numbers are the shape of the data rather than fixed overhead.

## What the numbers say

**A single block is fine. A page of blocks is not.** A report with eight blocks
runs eight of these, and at roughly half a second each that is a page which
takes several seconds to fill even though every individual query is defensible.
The 5-second cache in `app/Reports/cache.ts` covers a second reader and a tab
switch, but the first person to open a report each time still pays in full.

**The comparison is nearly free.** Two range queries cost about what one costs,
because both are index scans over the same rows and the second is warm.

**Grouping by a JSON property is the expensive one.** `json_extract` runs per
row and cannot use the index, so the top-N split costs roughly 65% more at p95
than the same query without a dimension. This is the first thing a rollup table
would fix.

**`count_unique` is expensive for the same reason a `DISTINCT` always is.** It
cannot be answered from a running total, so it is the one measure a daily
rollup cannot fully pre-compute; a rollup can only narrow the range it runs
over.

## What has not been done yet

Rollups. A daily pre-aggregate maintained by a queued job, used automatically
for day, week and month grains over long ranges, is what turns the table above
into single-digit milliseconds for the common case. It is the remaining piece
of #10 and is deliberately not claimed as done. Two things it will need:

- An equivalence test asserting the rollup answer matches the raw answer for
  every measure, because a rollup that is subtly wrong is worse than no rollup:
  it is wrong quickly and consistently, which reads as correct.
- Care with `count_unique`, which does not compose from daily totals. Summing
  daily uniques double-counts anyone who appears on two days.

## Reproducing

The benchmark script is deliberately not committed: it writes a million rows
into the development database and deletes them afterwards, and a script like
that living in the repository is one accidental run away from someone's real
data. Recreate it by inserting events in 5,000-row batches with
`INSERT INTO events (...) VALUES ...`, then timing `runQuery` over ten runs
after a warm-up. The demo seed (`bun scripts/seed-demo.ts`) is the fixture for
everything smaller.
