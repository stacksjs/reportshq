# On call

What tends to go wrong, how to tell, and what to do. Every entry here happened
or was found in this codebase; none of it is imagined.

The theme, stated once because it is the thing that will catch you: **this
system's failures are quiet**. Almost none of them raise. The site keeps
serving, the deploy keeps passing, and the only symptom is a number that is
wrong or an email that did not arrive. When something is reported that "cannot
be happening because nothing is failing", believe the report.

## First five minutes

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://reportshq.org/            # expect 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://reportshq.org/ingest  # expect 401
curl -s https://reportshq.org/api/health                                   # expect {"status":"healthy"}
```

`/api/health` is the one that matters: it checks the database and the cache
rather than just whether the process replied. A process that is up with an
unreachable database serves cached pages and reports green to anything that only
asks for a response.

On the box:

```bash
systemctl status 'reportshq-main@*' 'reportshq-api@*'
journalctl -u 'reportshq-main@*' -n 200 --no-pager
ss -lntp | grep -E '3150|3158'
```

## Numbers look wrong on a report

The most likely explanation is the pre-aggregate, and the fastest way to find
out is to ask the same question twice.

Add any filter to the block. A filtered query cannot use the rollups, so it goes
to the raw table. **If the filtered answer differs from the unfiltered one, the
rollups are wrong**, not the engine.

```sql
select build, covered_from, covered_through, timezone from rollup_states where project_id = ?;
```

`build` must equal `ROLLUP_BUILD` in `app/Reports/rollup.ts`. If it is lower, the
rows were produced by an older computation, they are already being ignored, and
queries are answering correctly from the raw table while the nightly job catches
up. That is the system working.

To force it:

```bash
bun -e "import {rebuildProject} from './app/Reports/rollup'; await rebuildProject(<projectId>, 90, '<tz>')"
```

This has been wrong twice, both silently: money truncated to whole units by an
integer column, and a minimum reported as zero because empty buckets counted as
data. If a number is wrong and the rollups are current, compare the two paths
before assuming the customer misread it.

## A scheduled report did not arrive

1. **Was it due?** `isDue` needs the project-local hour to match. Check
   `report_schedules.hour` and the project timezone.
2. **Did it already run?** `last_run_at` in the same local day blocks a second
   send. That is deliberate, and it is what makes an hourly scan safe.
3. **Is it the day the clocks changed?** A spring-forward skips a local hour
   entirely. The schedule now runs at the following hour instead; if this is a
   report timed at 02:00 in a zone that just sprang forward, expect it an hour
   late, not missing.
4. **Recipients.** `assertRecipientsAllowed` refuses addresses outside the
   project's members. A schedule pointed at a departed colleague fails on send,
   not on save.

## Ingest is refusing writes

`429` means the rate limit. Per project it is 120 requests per 10 seconds, per
address 300; both are request ceilings, and the batch cap of 500 events makes
them event ceilings too.

`401` means the key. One answer covers missing, malformed, unknown and revoked,
on purpose, so probing tells the prober nothing. Check
`projects.ingest_key`; if a customer rotated it, their old key stops working
immediately and that is the intended behaviour.

`413` is the body cap. The client is batching too aggressively; over-long
batches are truncated rather than refused, and the response says how many were
skipped.

Storage is not usually the problem: one worker sustains roughly 32,000 events/s
(`docs/benchmarks.md`), far more than a single project can legally send.

## A deploy went green and the site is wrong

Read the deploy log rather than the exit code. Specifically:

- **`No pre-migration backup`** means the dump in front of the migration was not
  taken. Fixed in Stacks 0.70.378, but the warning is the authority, not this
  page.
- **`already up to date`** on a database whose schema is wrong. The migration
  runner only asks which files have not run, never whether the database
  resembles the models. `buddy migrate` prints a schema-drift report beside it;
  read that.
- Migrations run in `preStart`, so a failure there takes the release down before
  it serves. That is the good case: the previous release stays up.

## Rolling back

**Push a revert.** The procedure is in `docs/deploy.md` and it is a revert
rather than repointing `current` by hand, because a hand-repointed symlink is
undone by the next deploy, which ships the bad commit again.

```bash
git revert <sha> && git push
```

A release that fails its health gate never becomes `current` at all, so a deploy
that broke on the way up has already rolled itself back and there is nothing to
undo.

**A rollback moves the code, never the database.** If the release being undone
ran a migration, the schema is still the new one and the older code has to live
with it. That is why migrations are additive wherever possible and why the
pre-migration dump exists. For a migration that cannot be lived with, restore
the dump (`docs/deploy.md`) rather than reverting the code and hoping.

## What is not monitored

Said plainly, because assuming otherwise is worse than knowing:

- **Backups are not offsite.** They survive a bad migration or a bad query. They
  do not survive losing the box.
- **There is no alerting.** Nothing pages anyone. The health endpoint exists so
  something can be pointed at it, and nothing is yet.
- **There is no staging environment.** `main` deploys to production.
