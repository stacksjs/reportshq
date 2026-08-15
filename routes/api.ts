/**
 * This file is the entry point for your application's API routes.
 * The routes defined here are automatically registered. Last but
 * not least, you may also create any other `routes/*.ts` files.
 *
 * Every route in this file is mounted under `/api`. The prefix comes from
 * the `'api'` key in `app/Routes.ts` and lines up with the path the dev
 * proxy forwards (`/api/*`), so `route.get('/thing', ...)` here answers
 * `GET /api/thing`. Paths at the document root belong in a route file
 * whose registry entry sets `prefix: ''`.
 *
 * Framework routes (auth, dashboard, commerce, CMS, etc.) are loaded
 * automatically from storage/framework/defaults/routes/dashboard.ts.
 * You do NOT need to define them here — only add your own custom routes.
 *
 * @see https://docs.stacksjs.com/routing
 */

// This app's own API lives in routes/projects.ts, routes/reports.ts,
// routes/ingest.ts and routes/auth.ts, each mounted with its own prefix and
// middleware from app/Routes.ts. Nothing belongs at a bare `/api/*` path.
//
// `GET /api/health` is NOT defined here on purpose: the framework already
// serves it, and its answer covers the database and the cache rather than just
// whether the process replied. Uptime monitoring points at that one.

// `/coming-soon` is served as an STX view from
// `storage/framework/defaults/resources/views/coming-soon.stx`. The
// view auto-resolves through stx-serve, so no route registration is
// needed here. To activate the holding page across the whole app:
//
//   ./buddy coming-soon [--secret=my-magic-token]
//
// Launch the site with `./buddy launch`. Maintenance mode (503 page,
// distinct cookie + state file) is the separate `./buddy down` /
// `./buddy up` pair.
