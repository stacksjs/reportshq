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
      preStart: [
        'bun install --frozen-lockfile',
        'bun node_modules/@stacksjs/buddy/dist/cli.js migrate',
      ],
      env: {
        APP_ENV: 'production',
        NODE_ENV: 'production',
        PORT_API: String(PORT_API),
        API_URL: `http://127.0.0.1:${PORT_API}`,
      },
    },

    api: {
      root: '.',
      start: 'bun node_modules/@stacksjs/actions/dist/serve/api.js',
      port: PORT_API,
      preStart: ['bun install --frozen-lockfile'],
      env: {
        HOST: '127.0.0.1',
        APP_ENV: 'production',
        NODE_ENV: 'production',
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
