import type { CloudConfig } from '@stacksjs/types'
import type { CloudConfig as TsCloudConfig } from '@stacksjs/ts-cloud'
import { env } from '@stacksjs/env'

/**
 * The slug names the files this deploy OWNS on the box:
 * `/etc/rpx/sites.d/<slug>.json` and the `rpx-cert-renew-<slug>.*` units. The
 * fragment is replaced wholesale, so a slug that collides with another tenant's
 * silently takes over its routes and TLS. It must be unique across every
 * project attached to the same server, and it must never equal `attachTo`.
 */
const APP_SLUG = 'reportshq'
const APP_DOMAIN = env.APP_DOMAIN || 'reportshq.org'

/**
 * Ports on the shared box.
 *
 * Chosen from what was actually free (`ss -lntp`), not from a config file:
 * two tenants binding one port is a silent failure where the second service
 * crash-loops and its routes serve the first one's app. 3150/3158 were unused
 * as of 2026-08-15; the neighbours sit on 3140/3148 and 3130/3131.
 */
const PORT_MAIN = 3150
const PORT_API = 3158

/**
 * State that must outlive a release.
 *
 * Deploys are atomic: each activates a NEW release directory and the old one
 * goes away, so anything written inside it is destroyed by the next deploy.
 * ts-cloud's shared paths keep the real directory outside the releases and
 * symlink it into each one, so a rollback finds the same files rather than an
 * empty directory.
 *
 * The database is not here: it is Postgres on the box, reached over loopback.
 * These are the two directories the app itself writes, generated exports and
 * nightly dumps, both of which a release pruner would otherwise delete.
 *
 * The paths stay release-relative because that is where the symlink lands; the
 * `target` is where the bytes actually live.
 */
const STATE_DIR = '/var/lib/reportshq'
const EXPORT_DIR = 'storage/exports'
const BACKUP_DIR = 'storage/backups/database'

/**
 * Shared paths, with an EXPLICIT absolute target.
 *
 * `main` and `api` are two sites of one project, and each gets its own
 * `/var/www/reportshq-<site>/shared`, so a plain-string entry would give them
 * two separate directories. Naming one absolute target makes them the same.
 *
 * `seed` decides which site may create and populate the target. Exactly one
 * should, or whichever site happens to deploy first creates it and the site
 * that actually writes there never seeds it.
 *
 * The database is no longer among these: it lives in Postgres on the box, not
 * in a file inside the release tree. Its credentials come from the encrypted
 * `.env.production`.
 */
function sharedState(seed: boolean) {
  return [
    { path: EXPORT_DIR, target: `${STATE_DIR}/exports`, seed },
    // Nightly dumps. A backup written inside a release is deleted by the
    // release pruner, so it would disappear at exactly the moment the release
    // it could have been restored alongside did.
    { path: BACKUP_DIR, target: `${STATE_DIR}/backups`, seed },
  ]
}

/**
 * Deploy configuration.
 *
 * This app is a TENANT on the Hetzner box owned by the `stacks` project, not a
 * server of its own. `cloud.attachTo` is what makes that true: without it,
 * ts-cloud finds no server labelled `ts-cloud/project=reportshq` and quietly
 * provisions a brand new box, which is an expensive way to discover a missing
 * line of config.
 */
export const tsCloud: TsCloudConfig = {
  project: {
    name: APP_SLUG,
    slug: APP_SLUG,
    region: 'us-east-1',
  },

  stateDir: 'storage/cloud',

  cloud: {
    provider: 'hetzner',
    // The owner project's slug. Its box, its gateway, our fragment.
    attachTo: 'stacks',
  },

  mode: 'server',

  environments: {
    production: {
      type: 'production',
      deployBranch: 'main',
      region: 'us-east-1',
      variables: {
        APP_ENV: 'production',
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
    },
  },

  infrastructure: {
    compute: {
      instances: 1,
      size: 'small',
      disk: {
        size: 20,
        type: 'ssd',
        encrypted: true,
      },
      webServer: 'rpx',
      proxy: {
        engine: 'rpx',
        onDemandTls: true,
      },
    },
  },

  sites: {
    main: {
      root: '.',
      path: '/',
      domain: APP_DOMAIN,
      start: 'bun node_modules/@stacksjs/buddy/dist/serve-entry.js',
      port: PORT_MAIN,
      // The main site owns the state: it runs the migration that creates the
      // database, so it is the one that may seed the target.
      sharedPaths: sharedState(true),
      // Markers between steps, kept deliberately. The remote log interleaves
      // every command with no delimiters, and stdout flushes in chunks while a
      // failing command's stderr goes straight through, so without them an
      // error appears to belong to whichever command last managed to flush.
      // Four deploys were spent misreading exactly that.
      preStart: [
        'echo "[reportshq] preStart: install"',
        'bun install --frozen-lockfile',
        'echo "[reportshq] preStart: migrate"',
        // `buddy deploy` splices a `db:backup --before-migrations` in front of
        // this line, deriving the invocation from it, so how this is written
        // decides how the backup is taken.
        'bun node_modules/@stacksjs/buddy/dist/cli.js migrate',
        'echo "[reportshq] preStart: done"',
      ],
      env: {
        APP_ENV: 'production',
        NODE_ENV: 'production',
        PORT_API: String(PORT_API),
        API_URL: `http://127.0.0.1:${PORT_API}`,
        // Database credentials come from the encrypted .env.production, not
        // from here: a value set in this block becomes the authoritative
        // runtime environment and would override them.
        EXPORT_DIR,
        BACKUP_DIR,
      },
    },

    api: {
      root: '.',
      start: 'bun node_modules/@stacksjs/actions/dist/serve/api.js',
      port: PORT_API,
      // Same files as main, and explicitly NOT the seeder.
      sharedPaths: sharedState(false),
      preStart: ['bun install --frozen-lockfile'],
      env: {
        HOST: '127.0.0.1',
        APP_ENV: 'production',
        NODE_ENV: 'production',
        // Both processes read the same Postgres database, from the same
        // encrypted .env.production. Nothing about the database is set here.
        EXPORT_DIR,
        BACKUP_DIR,
      },
    },

    /**
     * The documentation site, built at deploy time and served as static files.
     *
     * It is a separate bunpress build rather than something the app renders, so
     * without this entry `/docs` is a 404 in production while working perfectly
     * in dev. The landing page and the footer both link into it, and the
     * post-deploy check is what caught it.
     *
     * `test -d` after the build is the guard against a build that quietly
     * produces nothing: without it the deploy walks on and tars a directory
     * that was never written, and the failure surfaces three steps later as
     * something else. bunpress emits into a `.bunpress` subdirectory.
     */
    docs: {
      root: './dist/docs/.bunpress',
      path: '/docs',
      domain: APP_DOMAIN,
      deploy: 'server',
      // The installed CLI directly, not the ./buddy wrapper: the wrapper
      // bootstraps pantry, which the deploy runner neither has nor needs.
      //
      // `node_modules/.bin` is put on PATH because the docs build spawns
      // `bunpress` by name. It resolves locally only because pantry puts a copy
      // on PATH, so without this the build fails on a clean runner with
      // "Executable not found in $PATH" while working on every laptop.
      build: 'PATH="$PWD/node_modules/.bin:$PATH" bun node_modules/@stacksjs/buddy/dist/cli.js build docs && test -d dist/docs/.bunpress',
    },

    // www redirects rather than serving a second copy. One canonical origin
    // means a share link somebody pasted resolves to one place, and the
    // certificate set covers both names.
    www: {
      domain: `www.${APP_DOMAIN}`,
      redirect: `https://${APP_DOMAIN}`,
    },
  },
}

const config: CloudConfig = {}

export default config
