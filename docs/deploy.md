# Deploying

**This is about `reportshq.org`, not about running reports.** The site is a
marketing site, an account, and a licence. Reports run inside the customer's own
application through [the package](/docs/laravel), which deploys with their app
and needs nothing here. If you arrived looking for how to run this yourself, you
want [self-hosting](/docs/self-hosting).

`reportshq.org` deploys on every push to `main`. There is nothing to run by
hand, and running it by hand is worse than not: `buddy deploy` builds its
release tarball from the **working directory, not the commit**, so a deploy
from a laptop ships whatever happens to be checked out, including a
half-finished edit. From CI the release is exactly the commit that triggered it.

## The pipeline

The deploy job lives in `.github/workflows/ci.yml`, not a workflow of its own,
so the gates are `needs: [lint, typecheck, test]` rather than a second copy of
them that can drift. A red build means no deploy, silently and by construction.

```
push to main → lint + typecheck + test → deploy → verify the site serves
```

Deploys are queued rather than cancelled (`cancel-in-progress: false`). Two runs
racing to write the same systemd unit and rpx fragment on a box shared with a
dozen other tenants is worse than one slow deploy.

The last step is not decoration: it fails the job unless seven pages return 200
and an unauthenticated request to a guarded route returns 401. A deploy exiting 0 does not
mean the site works.

## Where it runs

A **tenant** on the Hetzner box owned by the `stacks` project
(`178.105.248.188`), not a server of its own. `cloud.attachTo: 'stacks'` in
`config/cloud.ts` is what makes that true. Without it ts-cloud finds no server
labelled for this project and provisions a brand new box.

Three things that bite on a shared box, all handled in `config/cloud.ts`:

- **The slug must be unique.** It names the files this deploy owns:
  `/etc/rpx/sites.d/reportshq.json` and `rpx-cert-renew-reportshq.*`. The
  fragment is replaced wholesale, so a colliding slug takes over another
  tenant's routes and TLS.
- **Ports come from `ss -lntp` on the box**, never from another tenant's config.
  Two services binding one port is silent: the second crash-loops and its routes
  serve the first one's app. This app uses 3150 (site) and 3158 (API).
- **State lives outside the release.** Deploys are atomic, so anything written
  inside a release directory is destroyed by the next one.

## Secrets

Split by blast radius, deliberately.

| What | Where | Why |
|---|---|---|
| Application secrets (`APP_KEY`, mail, DB) | `.env.production`, committed **encrypted** | Versioned with the code that reads them |
| `DOTENV_PRIVATE_KEY_PRODUCTION` | GitHub secret | The one key that opens the above |
| `HCLOUD_TOKEN` | GitHub secret | Resolves the server through the Hetzner API, needed even when attaching |
| `PORKBUN_API_KEY` / `PORKBUN_SECRET_KEY` | GitHub secret | DNS reconcile for the zone |
| `DEPLOY_SSH_KEY`, `DEPLOY_HOST` | GitHub secret | SSH to the box |

Infrastructure credentials are **not** in `.env.production`. That file is
shipped to the box, and a release sitting on disk should not carry a token that
can delete servers.

The SSH key is dedicated to this tenant, tagged `reportshq-github-actions` in
the box's `authorized_keys`. Write access to this repository must not equal root
over every other site on the machine. Its public half is derived in-job with
`ssh-keygen -y` rather than stored as a second secret, because two secrets that
have to agree eventually stop agreeing.

### Changing a secret

```bash
./buddy env:set SOME_KEY "value" --env production
git commit -am "chore(env): rotate SOME_KEY" && git push
```

`env:set` encrypts in place. The plaintext never enters git, and the next deploy
picks it up.

## The database

**Postgres**, on the box, reached over loopback. It runs as
`postgresql-pantry.service` and is shared with the other tenants, each of which
owns one role and one database. `reportshq` owns `reportshq` and nothing else,
and the server does not listen on a public interface.

Credentials are in the encrypted `.env.production` with everything else.
Nothing about the database is set in `config/cloud.ts`, deliberately: a value in
a site's `env` block becomes the authoritative runtime environment and would
override the encrypted file rather than defer to it.

```bash
# on the box
su - postgres -c "psql -d reportshq"
```

## Persistent state

The database is not a file, so the only shared path is the one the app itself
writes:

```
storage/backups/database → /var/lib/reportshq/backups
```

`storage/exports` used to sit beside it, holding generated CSV and XLSX files
for the hosted reports. Exports now happen inside the customer's application and
are streamed rather than stored, so there is nothing here to keep.

ts-cloud keeps the real directory outside the releases and symlinks it into each
one, so the release pruner cannot delete a night's dump.

The target is absolute because `main` and `api` are two sites of one project and
each gets its own `shared/` directory; a plain-string entry would give them two
separate directories. `seed: true` marks `main` as the one site allowed to
create and populate it.

## Backups

Two dumps, both kept outside every release tree so the release pruner cannot
delete them at the moment they would be needed.

**Before every migration.** `buddy deploy` takes one immediately before it
migrates. That covers a migration that did something nobody meant.

It works by splicing a `db:backup` in front of the preStart step that migrates,
and by deriving the invocation from that step, so **how the preStart is written
decides whether the dump happens at all**. It silently did not for a stretch of
this project: the echo markers between preStart steps meant
`echo "[reportshq] preStart: migrate"` was found first, a backup could not be
derived from an echo, and it was skipped. The deploy said so and passed:

> No pre-migration backup for "main": its migrate step (echo "[reportshq]
> preStart: migrate") is not a buddy invocation this can reuse.

Fixed in Stacks 0.70.378, which ignores quoted text when looking for the migrate
step. **When a deploy log carries that warning, the dump was not taken**, whatever
this page or the launch checklist says. Grep for it after changing preStart.

**Nightly at 02:40 UTC**, keeping seven, from `app/Scheduler.ts`. That covers
the day nobody deployed. It runs before `PruneEvents` at 03:20 so a night's dump
is taken while the rows retention is about to delete are still in it.

Both are deliberately **not** offsite. They survive a bad migration or a bad
query; they do not survive losing the box, and saying otherwise would be worse
than having no backup, because somebody would rely on it.

Dumps are taken with `pg_dump` and land in `/var/lib/reportshq/backups`. To
restore one:

```bash
# on the box, with the app stopped
systemctl stop 'reportshq-main@*' 'reportshq-api@*'
su - postgres -c "dropdb reportshq && createdb -O reportshq reportshq"
su - postgres -c "psql -d reportshq -f /var/lib/reportshq/backups/<dump>.sql"
systemctl start 'reportshq-main@*' 'reportshq-api@*'
```

`buddy db:backups` lists what is there.

### Verify the restore, do not assume it

A restore that runs without error is not a restore that worked. Drilled on
2026-08-15 against a scratch database, the sequence above completed cleanly and
carried 38 tables; what proved it was the checks afterwards, not the exit code.

```bash
# 1. Does the data exist, and is it the data you expected?
psql -d reportshq_scratch -c "select count(*) from projects"
psql -d reportshq_scratch -c "select count(*) from information_schema.tables where table_schema='public'"

# 2. Does the app read it? Point the app at the scratch database and run a
#    report query. A schema that restored and an app that cannot use it look
#    identical until somebody opens a page.
DB_DATABASE=reportshq_scratch bun -e "import {db} from '@stacksjs/database'; console.log((await db.unsafe('select count(*) as n from projects'))[0])"

# 3. Is the migrations table intact? If it is empty, the next deploy will try to
#    replay every migration against a populated database.
psql -d reportshq_scratch -c "select count(*) from migrations"
```

Restore into a scratch database first whenever the situation allows it. The
sequence above drops the live database as its second command, and a dump that
turns out to be short or truncated is discovered one command too late.

## Rolling back

Releases are atomic and the previous one is kept. A release that fails its
health gate never becomes `current`, so a broken deploy leaves the previous
release serving untouched and there is nothing to undo.

To go back from a release that passed its gate but is wrong, push a revert:

```bash
git revert <sha> && git push
```

That is preferred over repointing `current` by hand, because the next deploy
would otherwise ship the bad commit again.

## Verifying by hand

```bash
curl -sI https://reportshq.org | head -1
curl -s https://reportshq.org/sitemap.xml | head -3
curl -s -o /dev/null -w '%{http_code}\n' https://reportshq.org/account          # expect 302
```

Check the rendered `APP_URL` is a real origin rather than ciphertext, a known
framework foot-gun where a release loads the wrong env file and bakes
`https://encrypted:…` into every canonical and feed URL:

```bash
curl -s https://reportshq.org | grep -o 'rel="canonical" href="[^"]*"'
```

On the box:

```bash
systemctl status reportshq-main@*.service
journalctl -u reportshq-main@* -n 50 --no-pager
cat /etc/rpx/sites.d/reportshq.json
systemctl list-timers 'rpx-cert-renew-reportshq*'
```

Every `sites.d/<slug>.json` should have a matching `rpx-cert-renew-<slug>` timer.
A fragment without one has certificates with no renewal path.

## DNS

The zone is at Porkbun. `reportshq.org` and `www` have A records pointing at the
box and AAAA records at its IPv6 address.

`mail.reportshq.org` is **A only, on purpose**. The mail server binds IPv4 and
that IPv6 address has no PTR, so publishing an AAAA for a mail host turns
deliveries into deferrals.
