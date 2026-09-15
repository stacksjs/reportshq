# Schedules and exports

Two ways to get numbers out: a file you download now, and an email that arrives
without anybody asking.

## Exports

The current Stacks source exports CSV only. Its handler rejects XLSX. The
current Laravel source exports both CSV and XLSX. The published package
versions still predate this reporting source, so check [release status](/docs/quickstart)
before using either as a customer installation.

CSV is one long table with block, point, series and value columns. Laravel XLSX
uses a separate sheet per query-bearing block, with point, series and value
columns. The two formats are deliberately different.

| block | point | series | value |
|---|---|---|---|
| Signups | 2026-08-01 | pro | 4250 |
| Signups | 2026-08-01 | starter | 1180 |
| Signups | 2026-08-02 | pro | 3990 |

CSV suits anything that reads text. XLSX gives a workbook with the types
already correct, so dates are dates rather than strings that need coercing.
Both are generated from the rendered report result. The offline licence does
not gate either format in the current source. See [limits](/docs/limits).

## Nothing is stored to expire

An export is generated on the request and streamed straight out. Nothing is
written to disk and nothing is linked.

The hosted product did store a file, sign a URL for it and expire it after an
hour - all of which existed because the file lived on a different machine from
the reader. Here it does not: the numbers are one query away, so generating on
demand has nothing to clean up and cannot serve somebody a stale copy.

## Schedules

The current Laravel source can send a report by email on a schedule, optionally
with a spreadsheet. The Stacks package has no schedule runner. Laravel registers
the `reportshq:send` command but the host must put it on its own scheduler and
run a queue worker for queued mail.

### The hour stays the hour

The schedule is evaluated in the report's timezone rather than by adding a
fixed offset to UTC. That means 09:00 stays 09:00 after the clocks change,
which is the whole reason to store a timezone rather than an offset.

### Recipients are not validated - review them yourself

Be explicit about this one. `recipients` is a free-text column;
`Schedule::recipientList()` splits it on commas and `Delivery` hands the result
straight to `Mail::to(...)->queue(...)`. Nothing checks that an address belongs
to anyone in particular.

A reporting tool that emails on a timer is worth the same review you would give
any other outbound mail. Restrict who may create or edit a schedule, in your own
application, since the package does not do it for you.

### What a run records

`last_run_at` is stamped, and that is all - it is what decides whether a
schedule is due, so it is written *before* the mail is queued. A send that
fails afterwards still leaves the schedule looking like it ran. There is no
failure log here: if you need one, watch your queue's failed jobs.

The current offline licence does not gate scheduled delivery. Pricing copy may
describe a commercial tier, but the host remains responsible for mail access,
recipients and delivery monitoring. See [limits](/docs/limits).
