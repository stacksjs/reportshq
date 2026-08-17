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

  /*
   * The write endpoint, the builder's API and project tenancy all lived here
   * and are gone. They belonged to the hosted pipeline: events arrived over
   * `/ingest`, were rolled up, and were read back through `/api/reports`
   * against a project that owned them.
   *
   * None of that is how the product works now. An application keeps its own
   * data and reports on it in place, through reportshq/laravel, so there is no
   * endpoint here to send anything to and no tenant to send it as.
   */

  // Signing in, up and out. The one surface deliberately not behind `auth`,
  // since requiring a session to create one would be a short conversation. It
  // carries its own rate limits instead; see app/Support/signin-limits.ts.
  'auth': { path: 'auth', prefix: '/api/auth' },
} satisfies RouteRegistry
