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

  // The public write endpoint, at the document root and deliberately not
  // behind `auth`: it authenticates with a project's ingest key, which ships
  // inside the customer's application and can only append events. Declared
  // with an empty prefix so the documented URL is `/ingest` rather than
  // `/ingest/ingest`.
  'ingest': { path: 'ingest', prefix: '' },

  // The builder's write surface. Behind `auth` for the same reason as
  // projects, and every handler resolves the project before touching a report,
  // so a report id from another tenant never resolves to anything.
  'reports': { path: 'reports', prefix: '/api/reports', middleware: ['auth'] },

  // Project tenancy: creation, membership, invites, ingest key rotation.
  // Behind `auth` at the registry level rather than per route, so a route added
  // to that file later cannot be published unauthenticated by omission. Every
  // handler still resolves per-project permission through app/Support/access.ts,
  // because being signed in says nothing about which projects are yours.
  'projects': { path: 'projects', prefix: '/api/projects', middleware: ['auth'] },
} satisfies RouteRegistry
