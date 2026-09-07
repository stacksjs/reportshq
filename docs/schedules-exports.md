# Schedules and exports

Two ways to get numbers out: a file you download now, and an email that arrives
without anybody asking.

## Exports

Export any report as CSV or XLSX.

Both come out in **long format**: one row per series per period, rather than a
grid that looks right on screen and fights every pivot table. A wide export is
easier to read and harder to use, and an export exists to be used.

| period | series | value |
|---|---|---|
| 2026-08-01 | pro | 4250 |
| 2026-08-01 | starter | 1180 |
| 2026-08-02 | pro | 3990 |

CSV suits anything that reads text. XLSX gives a workbook with the types
already correct, so dates are dates rather than strings that need coercing.
Both come from the same query the chart ran, so an exported number and a drawn
number cannot disagree.

XLSX is a paid-tier capability; CSV is on every plan. See [limits](/docs/limits).

## Nothing is stored to expire

An export is generated on the request and streamed straight out. Nothing is
written to disk and nothing is linked.

The hosted product did store a file, sign a URL for it and expire it after an
hour — all of which existed because the file lived on a different machine from
the reader. Here it does not: the numbers are one query away, so generating on
demand has nothing to clean up and cannot serve somebody a stale copy.

## Schedules

A schedule sends a report's headline numbers by email, daily, weekly or
monthly, at an hour you choose, optionally with a spreadsheet attached.

### The hour stays the hour

The schedule is evaluated in your project's timezone rather than by adding a
fixed offset to UTC. That means 09:00 stays 09:00 after the clocks change,
which is the whole reason to store a timezone rather than an offset.

### Recipients are not validated — review them yourself

Be explicit about this one. `recipients` is a free-text column;
`Schedule::recipientList()` splits it on commas and `Delivery` hands the result
straight to `Mail::to(...)->queue(...)`. Nothing checks that an address belongs
to anyone in particular.

A reporting tool that emails on a timer is worth the same review you would give
any other outbound mail. Restrict who may create or edit a schedule, in your own
application, since the package does not do it for you.

### What a run records

`last_run_at` is stamped, and that is all — it is what decides whether a
schedule is due, so it is written *before* the mail is queued. A send that
fails afterwards still leaves the schedule looking like it ran. There is no
failure log here: if you need one, watch your queue's failed jobs.

Scheduled delivery is a paid-tier capability. See [limits](/docs/limits).
