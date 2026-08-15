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
 * Deploys are atomic: each one activates a NEW directory and the old one goes
 * away. Anything written inside it is therefore destroyed on the next deploy,
 * so the database would be wiped every time somebody pushed to main, and the
 * only symptom would be that all the customer data was gone. It lives here
 * instead, and the deploy creates the directory before migrating into it.
 *
 * Generated exports sit beside it for a smaller version of the same reason: a
 * download link handed out minutes before a deploy should still resolve.
 */
const STATE_DIR = '/var/lib/reportshq'
const DB_PATH = `${STATE_DIR}/reportshq.sqlite`
const EXPORT_DIR = `${STATE_DIR}/exports`

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
      // Each step announces itself. The remote log interleaves every command's
      // output with no markers, so when a step fails the error arrives with no
      // indication of which command produced it: the first deploy died on
      // `Module not found "storage/framework/core/buddy/src/cli.ts"` directly
      // beneath the output of `bun install`, which is not the command that
      // raised it.
      preStart: [
        'echo "[reportshq] preStart 1/3: install"',
        'bun install --frozen-lockfile',
        'echo "[reportshq] preStart 2/3: state dirs"',
        // Before migrating, so the first deploy has somewhere to migrate into.
        `mkdir -p ${STATE_DIR} ${EXPORT_DIR}`,
        'echo "[reportshq] preStart 3/3: migrate"',
        'bun node_modules/@stacksjs/buddy/dist/cli.js migrate',
        'echo "[reportshq] preStart complete"',
      ],
      env: {
        APP_ENV: 'production',
        NODE_ENV: 'production',
        PORT_API: String(PORT_API),
        API_URL: `http://127.0.0.1:${PORT_API}`,
        DB_CONNECTION: 'sqlite',
        DB_DATABASE_PATH: DB_PATH,
        EXPORT_DIR,
      },
    },

    api: {
      root: '.',
      start: 'bun node_modules/@stacksjs/actions/dist/serve/api.js',
      port: PORT_API,
      preStart: ['echo "[reportshq] api preStart: install"', 'bun install --frozen-lockfile'],
      env: {
        HOST: '127.0.0.1',
        APP_ENV: 'production',
        NODE_ENV: 'production',
        // The same database and the same export directory as the site above.
        // These two processes serve one application, and pointing them at
        // different files would mean the API writes an event the page cannot
        // read, which looks like the app losing data rather than a config bug.
        DB_CONNECTION: 'sqlite',
        DB_DATABASE_PATH: DB_PATH,
        EXPORT_DIR,
      },
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
