# Plan limits

What each plan allows, and exactly what happens when a project reaches a limit.

The numbers here are not a copy of the numbers in the product. `app/Billing/limits.ts` is the only place a limit is defined; this page, the pricing page and every gate read that file. A marketing table maintained separately from enforcement is a promise somebody eventually breaks by editing one of them, and the person who finds out is a customer who paid for a number that turned out not to be true.

## The plans

| | Free | Hobby | Pro |
|---|---|---|---|
| Price | free | $9/month | $29/month |
| Events per month, per project | 50,000 | 500,000 | 5,000,000 |
| Projects | 1 | 3 | 25 |
| Reports per project | 5 | 25 | 200 |
| Members per project | 1 | 3 | 25 |
| Share links per project | 1 | 10 | 100 |
| Raw events kept | 30 days | 90 days | 365 days |
| Share links | yes | yes | yes |
| Embeds | | yes | yes |
| Scheduled delivery | | yes | yes |
| XLSX export | | | yes |
| Unbranded shares | | | yes |

Members include the project owner, who holds no seat row internally but is a person on the project. A plan that said "1 member" and in fact allowed an owner plus one other person would be a limit nobody could reason about.

## What happens at the event quota

Three states, and the middle one is the whole policy.

**Below the quota.** Everything is accepted.

**At the quota, and up to 10% past it.** Everything is still accepted, and the ingest response carries a warning:

```json
{
  "ok": true,
  "stored": 50,
  "warning": "over_quota",
  "message": "This project is past its 50,000 events for the month and is inside its grace allowance. Collection stops when that runs out."
}
```

A project that crosses its limit mid-month is usually having a good week, and cutting its data off at exactly 100% means the report that would have shown them the good week is the one with a hole in it. The grace band is a stated allowance, not a surprise.

**Past the grace band.** Writes are refused with `429` and a machine-readable body:

```json
{
  "ok": false,
  "error": "quota_exceeded",
  "message": "This project has used its 50,000 events for the month, plus its grace allowance. Upgrade to keep collecting.",
  "plan": "free",
  "used": 55000,
  "allowance": 50000,
  "rejected": 50,
  "resets_in": 1209600
}
```

`Retry-After` carries `resets_in`, which is the number of seconds until the project's month rolls over **in the project's own timezone**. A project in Auckland has its month end when Auckland says it does.

`rejected` is the number of events in the refused request, and it is counted against the month. Nothing is dropped without being accounted for: the meter and the database always have the same explanation for the difference between what was sent and what was stored.

### Quota is not rate limiting

They are different refusals that both return `429`, and the body says which is which:

- `"error": "rate_limited"` means too fast. Retry in seconds.
- `"error": "quota_exceeded"` means too much this month. Retrying will not help; a larger plan or a new month will.

Conflating them would tell somebody to slow down when what they need is a larger plan.

## What is counted

Events are counted as they are **stored**, not as they are received. A request whose events fail validation is not billed for them.

The count lives in a monthly counter rather than being a `COUNT(*)` over the events table, for two reasons. The ingest path cannot afford a table scan, and the count has to outlive retention: a project that sent four million events in March and had them pruned in June still used four million events in March, and its bill should say so.

Projects, reports, members and shares are counted live from their rows. They are small numbers over indexed columns, and a counter for each would be four more things that can drift from what they claim to describe.

## Months

A month is a calendar month in the project's timezone, so a month boundary means the same thing to the customer as it does to the invoice. Changing a project's timezone changes which month subsequent writes count against; it does not move writes already recorded.

## Retention

Raw events older than the plan's window are pruned by a scheduled job. Daily rollups outlive the raw events they were built from, so a report over a range older than the retention window still shows correct totals; only the ability to drill into individual events goes away.

Downgrading does not delete anything immediately. The next pruning run applies the new, shorter window, and the downgrade is warned about at the time it is made.

## When a limit is reached

Limits fail soft. Being over a quota is a billing conversation, not an outage:

- Nothing throws, and no limit check returns a `500`.
- Reading is never blocked. A project past its quota keeps serving every report it already has.
- Creating a report, project, member or share past a limit is refused in the interface with the tier that would lift it named, not with an error page.

## Upgrading

An upgrade takes effect on the next write. The plan lives on the account row, and every gate reads it there rather than asking the payment provider, so a checkout that has completed is a limit that has already moved.
