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

## Download links expire

A generated file is reachable through a signed link with a deadline on it, and
the file is deleted when the link dies. Keeping somebody's numbers on disk past
the life of the only URL that reaches them is storage nobody asked for.

The signature is verified in constant time, so a wrong token cannot be
distinguished from a right one by how long the answer takes.

## Schedules

A schedule sends a report's headline numbers by email, daily, weekly or
monthly, at an hour you choose, optionally with a spreadsheet attached.

### The hour stays the hour

The schedule is evaluated in your project's timezone rather than by adding a
fixed offset to UTC. That means 09:00 stays 09:00 after the clocks change,
which is the whole reason to store a timezone rather than an offset.

### Recipients are checked

A schedule can only send to addresses tied to the project. A reporting tool
that will email anything to anywhere on a timer is a data exfiltration feature
with a friendly name.

### Runs are recorded

Each run is recorded, including failures, so a report that stopped arriving is
a question with an answer rather than a mystery.

Scheduled delivery is a paid-tier capability. See [limits](/docs/limits).
