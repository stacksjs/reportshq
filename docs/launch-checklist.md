# Launch checklist

The pre-launch gate for reportshq.org. Each pass below records what was checked,
how, and what it found. A tick means somebody ran something and read the output,
not that the code looked right.

Two rules for reading this document. **Findings are listed even when they were
fixed in the same hour**, because a checklist that only records successes is a
record of nothing. And **anything still open is stated as open**, with what it
blocks, rather than being quietly dropped from the list.

---

## Security

### Cross-tenant isolation

`tests/feature/tenant-isolation.test.ts` builds two tenants with deliberately
distinctive markers and asserts that every data-read path scoped to one never
returns the other's rows: event listings, event names, property keys and values,
the report engine (totals, dimensions, named events), share tokens, ingest-key
resolution and the usage meter.

The assertions are "A's read never contains B's value", never "A's read has N
rows". A count can match by accident; a foreign tenant's marker cannot.

Verified by mutation: removing the project predicate from `eventNamesFor` and
the project check from `revokeShare` each fails a test here.

- [x] Cross-project isolation, every read path: 17 tests, green on SQLite and Postgres

### The authz matrix across every surface

`tests/feature/route-gates.test.ts` reads the route table as text and asserts
every handler mentions something that establishes who is asking. Routes that are
deliberately open are named in an allowlist **with the reason they are safe**, so
a new unauthenticated route reaches a reviewer instead of a diff.

The open set is the sign-in surface only: register, login, forgot, reset, logout.
Each is throttled by `app/Support/signin-limits.ts`, and the credential each one
checks is its gate.

Verified by adding an ungated route and watching it fail.

- [x] Every project-scoped route resolves permission
- [x] Ingest key vs bearer vs share token vs anonymous, each covered by its own test

**Found and fixed.** `routes/buddy.ts` declared `POST /jobs/{id}/retry` and
`/cancel` with no gate, on the assumption that something upstream applied one.
Nothing did. It was never registered in `app/Routes.ts` and 404s in production,
so it was never reachable, but it was one registry line away from being an
unauthenticated job-control API. Removed, along with two other unregistered
scaffold route files.

### Share-link leakage

Verified against the running pages, not only the source. A share renders its
report, and the HTML contains no ingest key, owner address, project name or
project id. A revoked token returns HTML **byte-identical** to a token that never
existed, so a link cannot be used to learn whether it once worked.

`tests/feature/public-surface.test.ts` keeps it that way with an import
allowlist on `s.stx` and `embed.stx`. The failure to guard against is not
today's code but the later edit that adds a "shared by {project.name}" heading,
which looks correct in every screenshot, and which had to fetch the row the
ingest key lives on.

- [x] A token buys one report's published snapshot and nothing else
- [x] Revoked, expired and never-issued are indistinguishable
- [x] Public pages cannot reach a project, member or event query

### Secrets hygiene

- [x] No log statement writes a key, token or password (three call sites mention
      the concept, none the value)
- [x] The ingest key reaches a payload or a screen in exactly three places, each
      behind an administration check; pinned by test
- [x] `GET /projects/{id}` builds its body field by field rather than spreading
      the row, so the key is added only for administrators and nothing else leaks
- [x] `.env.production` is committed encrypted; the private key exists only as a
      CI secret

### Rate limits under concurrency

- [x] Ingest ceilings hold when the whole burst arrives at once: 4 tests

**Found and fixed, in `ts-rate-limiter` (released 0.4.6).** Every existing test
charged the limiter one awaited call at a time, which is the one traffic shape a
flood never has. `checkSlidingWindow` recorded a request through one awaited call
and read the window's count through a second; concurrent callers all finished the
first before any reached the second, so each read the total after the whole burst
had landed and each concluded it was over the limit.

A limiter configured for 120 admitted **none** of 180 simultaneous requests. Not
the over-admission a racy limiter is expected to produce. The inverse, and worse:
a customer's page firing 40 events at once, well inside a ceiling of 120, got 40
refusals. Fixed with an atomic `consumeSlidingWindow` that returns each caller its
own position in the window.

---

## Correctness

- [x] Postgres and SQLite suites both green (619 tests, both dialects, every push)

**Found and fixed.** `propertyValuesFor` referred to a select alias in `HAVING`.
Postgres resolves aliases in `GROUP BY` and `ORDER BY` but not in `HAVING`, so the
query ran in SQLite and raised `column "property_value" does not exist` on
Postgres. Production runs Postgres, which means the property-value dropdown in the
report filter bar was failing there and only there. Nothing caught it because that
function had no Postgres coverage until the isolation suite exercised it.

- [x] Timezone and DST edges, both directions and both hemispheres: 11 tests

**Found and fixed.** A schedule is stored as a local hour and matched against the
local hour of whatever instant the scan is running at. On the day a clock springs
forward, one local hour does not happen: New York goes 01:59:59 to 03:00:00 on
2026-03-08, and no instant that day has a local hour of 2. A daily report set to
02:00 matched nothing and was **silently skipped once a year**. No error, no
retry, no log line. The only evidence would have been a customer noticing a
missing morning email.

Fixed narrowly: the hour immediately after may stand in for the configured one,
but only when the configured hour genuinely did not occur. A blanket "run if we
are past the hour" would also fire a newly created 02:00 schedule at four in the
afternoon, which is a worse surprise than the problem it solves. The autumn
direction, where an hour happens twice, was already correct: the record of the
first run stops the second delivery.

Verified by mutation: three of the eleven tests fail against the unfixed
scheduler, including the southern-hemisphere case.

- [x] Month-grain across a year boundary, on both dialects: 4 tests

The bucket label is built in SQL by two different drivers from a format string.
A month format that dropped the year would fold December 2025 and December 2026
into one bar, and the chart would look entirely plausible: one tall December, no
error, no gap. It does not, and now that is asserted rather than assumed.

- [x] Rollup-vs-raw equivalence at scale: 1,800 fractional values across 45 days,
      every measure, every grain, compared bucket by bucket rather than only on
      the headline total

**Found and fixed, and this one was live.** The existing equivalence tests use
about fifty events with whole-number values, which is enough to catch a rollup
that groups wrongly and not enough to catch this. `value_sum`, `value_min` and
`value_max` were declared `schema.number()`, which maps to an `integer` column.
On Postgres a day totalling 111.40 was stored as 111.

So every report answered from the rollups showed **truncated money**, while the
same report with any filter went to the raw table and showed the real figure.
SQLite is loosely typed enough to keep the fraction, so the entire class of bug
was invisible in development and present in production. It is the same mistake
as the one fixed earlier on `Event.value`; fixing that column did not propagate
to the three rollup columns that mirror it.

**A schema fix is not a data fix**, which is the more important half. Widening
the columns corrects what gets written next and leaves every row already written
wrong, and the rebuild job only revisits a trailing three days. The rest would
have stayed quietly wrong forever, and the fix would have looked like it worked.

`rollup_states.build` now records which version of the computation produced a
project's rows, exactly as `timezone` already recorded which zone did. Rows from
an older build are not trusted, so queries fall back to the raw table until
rebuilt: slower, and right. The column defaults to 0 and the current build is 1,
so the invalidation applies itself on deploy rather than depending on anyone
remembering a step.

- [x] Query engine fixture audit on a frozen dataset: every measure, every
      grain, all eight filter operators, dimensions against the same arithmetic.
      28 tests, expected values worked out by hand from a six-event table

The dataset is frozen on fixed dates in February and March 2026, not anchored on
today, so the week and month buckets are not a judgement call: 2026-02-02 is a
Monday and 2026-02-09 is the next one. The engine tests next door anchor on
today, which is why `week` and three of the eight operators had no coverage at
all before this.

**Found and fixed.** `min` took the extreme over every bucket in the range,
including the empty ones, which are zero. So the minimum order value over any
range with a quiet day in it was reported as **0**: a month of orders between 10
and 50 showing a minimum of zero because a Sunday had none. `max` fails the same
way in the rarer, worse case, where a series of refunds is negative throughout
and the largest of those and a phantom zero is the zero. `avg`, immediately
beside them, had always excluded empty buckets.

The fix exposed a second copy. The rollup reader carried its own version of the
same rule, so correcting the engine made the two paths disagree, and the
equivalence tests caught it within one run. Both now call one shared fold, so
they agree by construction rather than by two people remembering the same thing.

Two of my expectations disagreed with the engine on `count_unique` and `avg`,
and I recorded the engine as correct because the existing tests documented that
behaviour as deliberate. **That was the wrong call, and the headline numbers were
wrong.** Folded from buckets, `count_unique` added daily distinct counts together
so a customer who ordered on five days counted five times, and `avg` took a mean
of daily means so a Tuesday with one order weighed the same as a Saturday with
forty. The Customers report read 97 buying customers for 40 real ones.

Both headlines are now asked as their own question over the whole range, with no
bucketing, while the series keeps its per-bucket values because a chart of unique
buyers per day genuinely is per day. The total is not the sum of the bars for
these two measures, and it never should have been.

The lesson worth keeping: "the existing tests say this is intentional" is not
evidence that it is right. A documented behaviour is still a behaviour somebody
chose once, and a headline that disagrees with the question it answers is a
defect however carefully it was commented.

---

## Billing

- [ ] Full Stripe test-mode lifecycle with a simulated clock
- [ ] Tier resolution and limit enforcement asserted at every step
- [ ] Month-rollover metering

**Blocked** on #17 (Stripe keys). Usage metering itself is covered:
`tests/feature/limits.test.ts` asserts concurrent writes do not lose each other,
that a new month starts from zero, and that the month is the project's rather
than the server's.

---

## Performance

- [x] Ingest sustained rate measured, against the rate limit that bounds it
- [x] Report query latency measured, raw and via the pre-aggregate
- [x] Public share under burst, with the cache holding: 4 tests

**Found and fixed.** The cache had a hole exactly the width of the query. `get`
missed, the query ran, `set` filled it, and every request arriving in between
missed too and started its own copy. Sequentially it looked perfect: one miss,
then hits. Measured under a burst, **fifty concurrent identical requests ran the
query fifty times**.

That window is the shape of a shared report link posted somewhere busy, which is
the most public surface this product has, viewed by strangers who did not choose
to wait. At 250,000 events each of those runs is ~440 ms of database work.

Requests for a key already being computed now wait for that answer instead of
asking again. Per process, so a fleet computes once per worker rather than once
per request, and no coordination between machines is needed for that to be true.
The in-flight entry is cleared even when the computation throws, so one bad query
cannot become a permanent outage for one report.

Numbers and the machine they came from are in `docs/benchmarks.md`, produced by
`scripts/benchmark.ts`. Nothing here is ticked from reasoning about the code.

At 250,000 events on an M3 Pro against local Postgres: one worker sustains about
32,000 events/s, which is far more than a single project can legally send through
the rate limit; a 30-day daily count costs ~440 ms against the raw table and
~99 ms through the rollups.

**The first version of the benchmark reported that the rollups made no difference
at all**, 1.1x and 0.9x. It built its range by hand as `now + 24 hours`, which
ends a day in the future; the rollups do not cover tomorrow, coverage correctly
returned false, and every query fell back to the raw table. The benchmark was
measuring the raw path twice. Nothing was broken and everything reported success,
which is the only reason it was convincing. The application does not have this
problem, because `resolveRange` ends at the exclusive start of tomorrow and no
route accepts a raw range from a caller.

---

## Design

- [x] No em-dash or separator en-dash in any user-visible string. The only hits
      were scaffold: a starter partial and a demo quotes job, both since removed
      or unreachable
- [x] Contrast measured, not eyeballed: every text node on the landing page,
      pricing, sign-in and the chart gallery, against its real computed
      background, in both themes. Zero failures at AA
- [x] Keyboard walk of the sign-in form: logical order, and every stop paints a
      focus ring
- [x] Reduced-motion honoured by every animated view and chart
- [x] No horizontal overflow at 375px on the marketing pages
- [x] Tap targets at 375px, against WCAG 2.2 target size including its spacing
      exception
- [x] Keyboard-only session through the builder, on a signed-in fixture

The builder audits clean: no contrast failures, no unlabelled inputs, no
controls without an accessible name, and no positive `tabindex` to break the
natural order. The tab order runs breadcrumb, View, Publish, the nine block
types, then the blocks themselves, and every stop paints a focus ring. Each
block is a `role="group"` carrying its grid position in its accessible name
("Orders block, column 0, row 0"), which is exactly what a drag-and-drop canvas
owes a screen reader.

**Found and fixed.** Everything needed to arrange a report by keyboard was
present except one line. Tiles are focusable, the keydown handler moves and
deletes the selected block, there are focus-visible styles for it, and the help
text on screen says "arrow keys move the selected block". But `select` was only
ever called from `pointerdown`, so a keyboard user could tab to a block, read
the instructions, press an arrow, and watch nothing happen. Selection now
happens on focus as well, which is what a click already does.

Verified in a browser rather than asserted: tab to the block and it selects, two
ArrowRight presses move it from column 0 to column 2, the accessible name
updates to match, and the new position is in the database.

**Found and fixed.** 22 footer links were 18px tall with 10px between them, so a
24px target circle centred on one overlapped its neighbour: a fail of WCAG 2.2
target size (2.5.8, AA) on the page every visitor lands on. They now carry real
padding, which takes them to 24px and above, and the same measurement afterwards
reports zero failures at 375px with no horizontal overflow and no change to the
desktop layout.

**A false alarm worth writing down.** The first focus check called `.focus()` on
every focusable element and reported that not one of them showed an indicator,
on every page. Programmatic focus does not match `:focus-visible`, which is the
selector a well-built page uses, so the audit was measuring its own method. Real
keyboard navigation shows the ring everywhere. Six "failures" that were not.

**Fixed while checking.** The scaffold shipped a simulated desktop UI: taskbar,
draggable windows, start menu, fake login screen, 2,224 lines of script. Its
layout was referenced by no view, so none of it had ever rendered. Removed with
the two Stacks blog posts that would have been this product's blog had anything
served `/blog`.

---

## Docs

- [x] Every documented event payload is one the ingest actually accepts, every
      JSON sample parses, and the samples name the header and endpoints the
      routes really read: 5 tests, run on every commit

The first thing a new customer does is paste the quickstart curl into a
terminal. A stale sample is not cosmetic there: it is the product failing at the
one moment the customer has no reason to assume the fault is theirs.

**Worth recording, because the first version of this test was useless.** It told
a request sample from a response sample by checking that every entry carried a
`name` field. So a sample with `nmae` was not a broken sample, it was an
unrecognised one: skipped in silence, suite green. The check now identifies a
request by the shape of its wrapper and never by whether its contents look
valid. Caught only by mutation testing, because a passing test looks identical
either way.

- [x] Quickstart's API claims executed against production, and its response
      shapes checked against the routes

**Found and fixed.** The quickstart told a new customer the ingest call answers
`{ "ok": true, "stored": 1, "rejected": 0 }`. It answers `dropped`, not
`rejected`; `rejected` belongs to the quota-exceeded body, which is a different
response entirely. The prose then explained that "rejected is never silently
non-zero", about a field that response has never carried. The very first thing
somebody does with this product is paste that curl and read the answer.

Every existing docs check passed on it: the JSON parsed, the payload was valid,
the endpoint was real. Only the answer was imaginary. The new test matches each
documented success body against the keys of the specific response literal that
produces it, rather than against the file, because the file does contain
`rejected` and would have called the sample correct. Verified by reintroducing
the exact bug and watching it fail.

- [ ] Quickstart run end to end on a clean machine, including the sign-up and
      builder steps a script cannot check

---

## Ops

- [x] Deploy is push-to-deploy from CI only, gated on lint, typecheck and both
      dialect suites (`docs/deploy.md`)
- [x] Backups: nightly, plus one taken before every migration

**This was ticked before it was true, which is worth recording.** The
pre-migration dump is spliced in front of the first preStart entry mentioning
"migrate", and the invocation is derived from that entry. The echo markers added
between preStart steps, to make a remote deploy log readable, meant
`echo "[reportshq] preStart: migrate"` matched first. The backup could not be
derived from an echo, so it was skipped, with a warning in the deploy output:

> No pre-migration backup for "main": its migrate step (echo "[reportshq]
> preStart: migrate") is not a buddy invocation this can reuse.

Every deploy since those markers were added migrated production with no dump in
front of it, and reported success. Fixed at the source in Stacks 0.70.378:
quoted text is removed before looking for the migrate step, because what a
command says is not what it does. Confirmed by watching the warning disappear
from a real deploy.
- [x] Backup restore drill, actually run: `pg_dump` the database, drop and
      recreate a scratch one, restore, and boot the app against it. 38 tables,
      zero errors, a sentinel row intact, the migrations table complete, and the
      report engine answering from the restored data
- [x] On-call notes for the known failure modes, in `docs/on-call.md`, built from
      what has actually gone wrong here rather than from imagination
- [ ] Rollback drill on production

The restore drill turned up no defect, and it did turn up a gap in the runbook:
the procedure ended at "run psql" with nothing about checking the result. A
restore that exits 0 is not a restore that worked, and the moment to discover
otherwise is not the second command, which drops the live database. The runbook
now carries the verification steps and says to restore into a scratch database
first whenever the situation allows.

The rollback drill stays open deliberately rather than being quietly ticked. The
documented procedure is a revert and a push, which is exercised by every deploy
in the sense that reverts are ordinary commits, but nobody has rolled production
back and watched it. That is a live-site exercise and it should be somebody's
decision, not a side effect of a QA pass.

---

## Blockers

Things that must be true before this is sellable, which no amount of testing
here can make true.

### The integration packages are not published

`docs/quickstart.md` step 4 tells a new customer:

```bash
bun add @reportshq/stacks
composer require reportshq/laravel
```

Both commands fail today. `@reportshq/stacks` returns 404 from the npm registry
and there is no `@reportshq` scope at all; `reportshq/laravel` returns 404 from
Packagist and there is no `reportshq` vendor. Both packages exist in this repo
at `packages/stacks` and `packages/laravel`, at version 0.1.0, unpublished.

So the documented path from "I tried the curl" to "it is wired into my app"
stops dead, at the step where somebody had decided to adopt the product. The
docs are not wrong about what the packages do; they are wrong that you can
install them.

Either publish both, or say plainly on the page that they are not out yet.
Publishing is a decision about a namespace and a release, not a QA fix, so it is
recorded here rather than done.

## Sign-off

Not yet, and the nearest blocker is not a test result: the two integration
packages the quickstart tells customers to install are not published anywhere.

Security, correctness, docs and most of the design and ops work are done, with
findings fixed and recorded above. Billing is blocked on #17. Still open: a
burst test of the public share cache is done but the wider performance work is
partial, the quickstart has not been run end to end on a clean machine by a
person, and the production rollback has been documented but never exercised.
