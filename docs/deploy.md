# Deploying

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
and an unauthenticated `POST /ingest` returns 401. A deploy exiting 0 does not
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

## Persistent state

`config/cloud.ts` declares shared paths with an **explicit absolute target**:

```
database      → /var/lib/reportshq/database
storage/exports → /var/lib/reportshq/exports
```

ts-cloud keeps the real directory outside the releases and symlinks it into each
one, so a rollback finds the same data rather than an empty directory.

The target is absolute because `main` and `api` are two sites of one project and
each gets its own `shared/` directory. A plain-string entry would give them two
separate databases drifting apart forever: the API writing an event the page
cannot read, which reads as the app losing data rather than a config mistake.
`seed: true` marks `main` as the one site allowed to create and populate them,
since it is the site that runs the migration.

## Backups

`buddy deploy` dumps the database immediately before it migrates, into a
project-level directory outside every release tree. That covers the case this is
most likely to need: a migration that did something nobody meant.

It is deliberately **not** offsite. It survives a bad migration; it does not
survive losing the box.

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
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://reportshq.org/ingest   # expect 401
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
