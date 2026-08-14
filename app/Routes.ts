import type { RouteRegistry } from '@stacksjs/router'

export type { RouteDefinition, RouteRegistry } from '@stacksjs/router'

/**
 * Application route registry.
 *
 * The key becomes the URL prefix. Framework bundles (auth, dashboard, CMS) are
 * mounted separately by the defaults bootstrap and are not listed here.
 */
export default {
  // Auto-prefixed with /api by the route loader, matching the path the dev
  // proxy forwards.
  'api': 'api',

  // Project tenancy: creation, membership, invites, ingest key rotation.
  // Behind `auth` at the registry level rather than per route, so a route added
  // to that file later cannot be published unauthenticated by omission. Every
  // handler still resolves per-project permission through app/Support/access.ts,
  // because being signed in says nothing about which projects are yours.
  'projects': { path: 'projects', prefix: '/api/projects', middleware: ['auth'] },
} satisfies RouteRegistry
