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

- [ ] Query engine fixture audit: hand-computed expected values for every
      measure/grain/dimension combination on a frozen dataset
- [ ] Rollup-vs-raw equivalence at production scale factor
- [ ] Timezone and DST edges: a schedule at 02:30 on a DST-change day, a
      month-grain query across a year boundary

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

- [ ] Ingest sustained-load test against a documented target
- [ ] Builder preview latency budget
- [ ] Public share under burst, with the cache holding

Numbers to be recorded in this repo when measured. Nothing here is ticked from
reasoning about the code.

---

## Design

- [x] No em-dash or separator en-dash in any user-visible string. The only hits
      were scaffold: a starter partial and a demo quotes job, both since removed
      or unreachable
- [ ] `stacks-design-taste` Section 14 pre-flight across marketing, app shell,
      builder, chart gallery and emails, both themes, three viewports
- [ ] Accessibility sweep: keyboard-only builder session, focus order, contrast
      against the token docs, reduced-motion honoured

**Fixed while checking.** The scaffold shipped a simulated desktop UI: taskbar,
draggable windows, start menu, fake login screen, 2,224 lines of script. Its
layout was referenced by no view, so none of it had ever rendered. Removed with
the two Stacks blog posts that would have been this product's blog had anything
served `/blog`.

---

## Docs

- [ ] Quickstart executed verbatim on a clean machine profile
- [ ] Every doc code sample runs

---

## Ops

- [x] Deploy is push-to-deploy from CI only, gated on lint, typecheck and both
      dialect suites (`docs/deploy.md`)
- [x] Backups: nightly, plus one taken before every migration
- [ ] Rollback drill, actually exercised rather than documented
- [ ] Backup restore drill: restore the Postgres backup to a scratch database and
      boot the app against it
- [ ] On-call notes for the known failure modes

---

## Sign-off

Not yet. Correctness, performance, docs and the two ops drills are open, and
billing is blocked on #17. The security pass is complete and its findings are
fixed.
