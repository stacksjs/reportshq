# AGENTS.md

Canonical guidance for AI coding agents (Claude Code, OpenAI Codex CLI, Cursor, and others) working
in this Stacks application. This is the one file every agent reads, and the only one committed -
`buddy setup:ai` generates the rest (`CLAUDE.md`, `.claude/skills/`, `.cursor/rules/`, ...) from
`storage/framework/defaults/ai/`, and they are gitignored because the agent you use is your choice.

Stacks is a full-stack TypeScript framework that runs on Bun. Almost every subsystem has a dedicated
skill under `storage/framework/defaults/ai/skills/` that documents it authoritatively. **This file is
a map: it states the non-negotiable rules and points you to the right skill for the task.** Read the
relevant `SKILL.md` before doing non-trivial work in that area rather than guessing an API.

---

## 1. What ReportsHQ is

**Reports for people who ship.** Applications send structured events over HTTP, or through the
first-party Stacks and Laravel integration packages, and ReportsHQ turns them into reports. Two ways
a report comes to exist:

- **Auto-created.** Events that match the standard taxonomy (`docs/events.md`) trigger prebuilt
  report templates. Integrate a conventional commerce or SaaS app and the Commerce, Customers and
  Users reports appear on their own, with real numbers, no configuration.
- **Built by hand.** A visual drag-and-drop builder composes blocks (line, bar, donut, big number,
  table, funnel, heatmap, text) on a 12 column grid, each block configured by measure, dimension,
  filter, time grain and comparison range.

Free, Hobby and Pro tiers, billed through Stripe. Self-hosted installs leave `STRIPE_*` unset and
every tier limit falls away.

The whole roadmap lives as GitHub issues on `stacksjs/reportshq`, tracked from
[issue #1](https://github.com/stacksjs/reportshq/issues/1). **Read the issue before starting its
work**; each one carries its own acceptance criteria and the reasoning behind its design.

The sibling product [loghq](https://github.com/stacksjs/loghq) solves the same shape of problem for
logs. Its ingestion discipline, key model and marketing architecture are the reference to study, not
to copy verbatim.

## 2. Architecture

| Concern | Where it lives |
|---|---|
| Event ingestion | `routes/ingest.ts`, `app/Events/` (normalization, bounds, key auth) |
| Domain models | `app/Models/` - every table in the database comes from one of these |
| Query engine | `app/Reports/engine.ts` - block config in, typed series out |
| Report templates | `app/Reports/templates.ts` - the auto-created reports |
| Charts | `resources/components/charts/` - stx components over `ts-charts` |
| Builder | `resources/views/report-edit.stx`, served at `/report-edit` |
| Plan limits | `app/Billing/limits.ts` - the single source of truth for every tier number |

Two token kinds, never confused: a **project ingest key** (`rhq_...`, public, write only, revocable)
authenticates writes to `/ingest`; a **bearer token** authenticates reads and management. Public
share links carry a third principal, scoped to one published report.

## 3. Non-negotiable rules

These are the house rules. They are not preferences, and "it was quicker" is not a reason to break
one.

1. **No hand-written migrations.** Schema is derived from `app/Models/*` by
   `buddy generate:migrations`, reviewed, then applied with `buddy migrate`. If the generator cannot
   express what a model needs, **fix the generator** in `stacksjs/stacks` and release it. Do not
   hand-write SQL, and do not reshape a model to dodge a generator limitation.
2. **No workarounds.** When a framework or library gap blocks you, fix it at the root in the owning
   repository, release it, and consume the released version. If the root fix is genuinely out of
   scope, stop and say so plainly rather than papering over it locally. Silent local patches are how
   a framework bug becomes twelve app-specific bugs.
3. **No third-party dependencies.** Only our own packages, from `~/Code/Libraries/*` and
   `~/Code/Tools/*`, published under their own names: `stacks`, `ts-charts` (charts, drag),
   `ts-spreadsheets` (CSV, XLSX), `bun-query-builder`, `ts-cache`, `ts-rate-limiter`, and friends.
   Missing capability means improving that package upstream and running `bun run release:patch`
   there, not reaching for npm.
4. **Design work follows the skills.** `stacks-design-taste` first, then the aesthetic preset and
   `stacks-design-output`. The Section 14 pre-flight is a gate, not a suggestion: if a box cannot be
   ticked honestly, the work is not finished. `dataviz` is required reading before writing chart
   code, because the charts are the product.
5. **No em-dashes** (`-` or `--` style long dashes) in any user-visible string: headlines, body copy,
   labels, buttons, alt text, captions, email content, docs prose. A hyphen, a comma, or two
   sentences instead.
6. **Commits.** Conventional messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`), scoped and
   small, authored as Chris (`chrisbreuer93@gmail.com`), no co-author trailers, pushed to `main`.
7. **Before finishing anything:** `./buddy lint`, `./buddy typecheck`, `./buddy test`, all green.
   For UI work, add the design pre-flight. Report honestly when something fails.

## 4. Traps that have already cost time here
- **stx drops every prop passed from one component to another** (stacksjs/stx#1937):
  an array, a boolean and a plain string attribute all arrive as their defaults,
  silently. Page-to-component passing works fine, which is what makes it easy to
  miss. Shared chrome goes in a **partial**, which is included into the page's
  own scope; chart components inline their frame for the same reason.
- **`@include` resolves against `partialsDir`**, so it is `@include('AppNav')`.
  The `@include('partials/AppNav')` form renders **nothing at all**, with no
  warning, which is how three pages briefly shipped without their auth guard.
- **stx ships components of its own** (`<Heatmap>` among them) and an app
  component of the same name loses the resolution, silently. Chart components
  here are suffixed `Chart` for that reason.
- **Never name a cookie value `token` in a view.** stx publishes top-level server
  bindings into the HTML as bridge data as soon as the name appears in a client
  script, comments included, so that ships the session credential in the page
  source. Read sessions through `app/Support/session.ts`.
- **Run the dev server through your harness's background mechanism**, not a
  shell `( ... &)`, which is killed when the call returns. `PORT` is pinned in
  `.env`; another project on the same port makes the views server exit without a
  word.
- **Resolve the session cookie name from the framework**, never spell it out.
  `sessionCookieName()` wraps `authCookieName()`, which is what the `auth`
  middleware reads. Picking your own name makes pages authenticate happily while
  every request they make returns 401, which looks like a permissions bug and is
  not one.
- **`request.input()` does not surface JSON body fields** on the API path. Parse
  the body explicitly, as `routes/ingest.ts` and `routes/reports.ts` do. A
  handler relying on `input()` sees empty values and answers "not found" for a
  record that is right there.
- **Never anchor a test fixture to "today".** Ingest clamps future timestamps, so
  a fixture at "today 08:00" collapses into the wrong bucket when the suite runs
  after UTC midnight. It broke CI once. Anchor to yesterday.
- **stx JSON-encodes `{{ }}` inside a `<script>` block**, so the value arrives
  already quoted. Writing `setAttribute('x', '{{ name }}')` renders
  `setAttribute("x", '"auth-token"')` and the value carries literal quote
  characters. This broke every signed-in page: the auth guard looked for a
  cookie named `"auth-token"` including the quotes, never found it, and
  redirected to /login. Write `setAttribute('x', {{ name }})` with no quotes of
  your own. In an HTML *attribute* the same interpolation is HTML-escaped and
  needs the quotes, so the two contexts genuinely differ.
- **curl cannot verify anything that depends on JavaScript.** The bug above
  survived a full HTTP pass: every page returned 200 with correct markup, and
  every one of them bounced in a real browser. Load a page in the browser before
  believing a front-end change works.
- **A new `.stx` view needs a dev server restart.** The route table is built at
  boot, so a freshly added view 404s while its path is listed on the 404 page's
  own "available pages", which is a confusing way to find out.
- **`./buddy lint` only sees files git already tracks**, so a file you just wrote
  is skipped and the project reports clean without it ever being opened. CI reads
  it one commit later and fails. Either `git add` before linting, or run
  `bunx pickier lint .`, which reads the working tree. Fixed upstream in
  stacksjs/stacks@064e38b; this note can go once that release lands here.


- **stx templates take bare variable names, not Blade's `$`.** A server value is
  read as `@foreach (surfaces as surface)` and `{{ surface.note }}`, never
  `@foreach ($surfaces as $surface)` or `{{ $surface['note'] }}`. The `$` form
  does not error: it renders an HTML comment,
  `<!-- [Foreach Error [1102]]: $surfaces is not iterable -->`, so the page
  returns 200 with the section silently empty. Check the rendered HTML, not the
  status code.
- **Crosswind utilities are extracted from rendered HTML**, so a class built by
  interpolation (`bg-series-{{ swatch }}`) only emits once the loop that renders
  it works. A broken loop therefore breaks the CSS too, which makes the first
  symptom look like a styling bug.
- **Design tokens do not belong in Crosswind's `preflights`.** That key is never
  emitted on the stx serve path. They live in `public/tokens.css`, linked from
  `config/ui.ts`.
- **`buddy migrate:fresh` is broken on this scaffold** (stacksjs/stacks#2323): it
  fails partway and leaves duplicate migrations behind. To reset the local
  database, `rm database/stacks.sqlite && ./buddy migrate`.

## 5. Known upstream state

- `config/mobile.ts` is deliberately absent. ReportsHQ ships no native application, and the
  scaffold's copy imports `MobileConfig` from a framework version that is not published yet. See
  [stacksjs/stacks#2322](https://github.com/stacksjs/stacks/issues/2322), which also documents why
  `@stacksjs/mobile` cannot resolve `craft-native/mobile` from npm at all. If this app ever wants a
  native surface, that issue must land first.

---

## Project conventions (mandatory)

### Linting
- Use **pickier** for linting, never eslint directly.
- Lint: `./buddy lint` . Auto-fix: `./buddy lint:fix` . These drive pickier through its SDK, so they
  work the same in a vendored checkout and a package-based app; reach for `bunx --bun pickier .`
  only when you need a flag the command does not expose.
- For unused-variable warnings, prefer `// eslint-disable-next-line` over prefixing with `_`.

### Frontend
- Use **stx** for templating, never vanilla JS (`var`, `document._`, `window._`) in stx templates.
- Use **Crosswind** as the CSS framework (Tailwind-like utility classes).
- stx `<script>` tags may only contain stx-compatible code (signals, composables, directives).

### Dependencies
- **buddy-bot** handles dependency updates, not renovatebot.
- **better-dx** bundles the shared dev tooling (`typescript`, `pickier`, `bun-plugin-dtsx`,
  `bun-git-hooks`, `@stacksjs/gitlint`, `bunfig`, `@types/bun`, ...). If `better-dx` is in a
  `package.json`, do not also declare what it ships - two ranges for one tool only drift. A package
  that *imports* one of them at runtime declares it as a real `dependency` instead.
- If `better-dx` is in `package.json`, ensure `bunfig.toml` sets `linker = "hoisted"`.
- Do not use Bun's `catalog:` protocol. Every dependency carries its version range in the
  `package.json` that declares it, so vendored apps and `buddy-bot` both see a resolvable range.

### Commits
- Use conventional commit messages (`fix:`, `feat:`, `chore:`, ...).
- Only commit or push when asked. If on the default branch, branch first.

### Requirements
- Bun >= 1.3.0, SQLite >= 3.47.2. TypeScript throughout.

---

## Repository map

| Path | What lives here |
|---|---|
| `app/` | Your application code (see the override model below): `Actions/`, `Jobs/`, `Listeners/`, `Middleware/`, `Mail/`, `Commands/`, `Models/`, `Skills/`, and top-level `Routes.ts`, `Events.ts`, `Gates.ts`, `Scheduler.ts`, `Middleware.ts`, `Commands.ts`, `Listener.ts` |
| `routes/` | Route files (`api.ts`, `web`, `v1.ts`, `users.ts`, ...), registered via `app/Routes.ts` |
| `config/` | ~44 typed config files (`app.ts`, `database.ts`, `auth.ts`, `api` via `services.ts`, `queue.ts`, `cache.ts`, `email.ts`, `commerce.ts`, `cms.ts`, `payment.ts`, `ai.ts`, `cloud.ts`, `ui.ts`, `crosswind.ts`, ...) |
| `database/` | `migrations/`, seeders, and the local SQLite files |
| `resources/` | stx frontend: `views/`, `components/`, `layouts/`, `partials/` |
| `storage/framework/` | Framework internals + **defaults** (`defaults/app/` including the 60+ built-in `Models/`, `defaults/ai/` with the agent skills, `core/` packages, `server/`, dashboard, and the auto-import manifests); read-only reference, do not edit unless working on the framework |
| `storage/` | Also holds all machine-local runtime state: `framework/stx/` (stx build cache), `framework/runtime/` (migration lock, temp bundles), `cloud/` (cloud driver state). All gitignored, all safe to delete |
| `tests/` | Test suites (Bun test) |
| `cloud/` | AWS infrastructure (CDK / CloudFormation) for deploys |
| `content/`, `docs/`, `locales/`, `public/` | CMS/markdown content, docs site, i18n strings, static assets |

### The `app/` override model
Stacks resolves files from `app/` first and falls back to `storage/framework/defaults/app/`. To
customize a framework default (e.g. a CMS action), create the same path under `app/`
(`app/Actions/Cms/PostIndexAction.ts`) and it wins. New files you add under `app/` are available to
the app (e.g. `app/Actions/MyAction.ts` is referenced as `'Actions/MyAction'` in routes). There are
80+ default actions and 50+ built-in models you can use or override.

---

## Building features: feature → skill index

Read the skill before building. The full list lives in `storage/framework/defaults/ai/skills/`; run
`buddy setup:ai` to expose it to your agent, and add project-specific skills in `app/Skills/`.

### Backend / API
| Task | Skill |
|---|---|
| End-to-end new feature (model to migration to action to route to test) | `stacks-new-feature` |
| API endpoints, routes, request/response, middleware, OpenAPI, HTTP client | `stacks-api`, `stacks-router`, `stacks-routes` |
| Server actions in `app/Actions/`, auto-generated API actions (`useApi` trait), default actions | `stacks-actions` |
| Data models: `defineModel()`, attributes, relationships, traits, factories, computed | `stacks-models`, `stacks-orm` |
| Database: connections, queries, SQL helpers, SQLite/MySQL/Postgres/DynamoDB | `stacks-database`, `stacks-query-builder` |
| Migrations (create, run, fresh, seed) | `stacks-migrations` |
| Auth: authn/z, passkeys, TOTP/2FA, RBAC, gates (`app/Gates.ts`), policies, sessions, tokens | `stacks-auth`, `stacks-security` |
| Middleware in `app/Middleware/` and the `app/Middleware.ts` registry | `stacks-middleware` |
| Background jobs in `app/Jobs/`, queues, workers, batches, drivers | `stacks-jobs`, `stacks-queue` |
| Scheduling (`app/Scheduler.ts`), cron | `stacks-scheduler`, `stacks-cron` |
| Events (`app/Events.ts`) and listeners (`app/Listeners/`) | `stacks-events`, `stacks-listeners` |
| Mail classes (`app/Mail/`) and the email framework (SES/SendGrid/Mailgun/SMTP) | `stacks-mail`, `stacks-email` |
| Notifications (email/SMS/push/chat/database) | `stacks-notifications`, `stacks-sms`, `stacks-push`, `stacks-chat` |
| Caching (memory/Redis, cache-aside) | `stacks-cache` |
| File storage / uploads (local/S3) | `stacks-storage` |
| Realtime / WebSockets / channels | `stacks-realtime` |
| Full-text search (Meilisearch/Algolia, `useSearch` trait) | `stacks-search-engine` |
| Validation, error handling (Result type, error pages) | `stacks-validation`, `stacks-error-handling` |
| Env vars, config helpers, logging | `stacks-env`, `stacks-config`, `stacks-logging` |
| AI (Anthropic/OpenAI/Bedrock/Ollama), RAG, embeddings, MCP | `stacks-ai` |

### Domain packages
| Task | Skill |
|---|---|
| E-commerce (products, orders, customers, coupons, payments, shipping, tax, ...) | `stacks-commerce`, `stacks-payments` |
| CMS (posts, authors, pages, categories, tags, comments, RSS, sitemap) | `stacks-cms` |
| Admin dashboard pages, model views, widgets (150+ components) | `stacks-dashboard` |
| i18n / translations / formatting | `stacks-i18n` |
| Utilities: strings, arrays, collections, objects, datetime, slugs | `stacks-strings`, `stacks-arrays`, `stacks-collections`, `stacks-objects`, `stacks-datetime`, `stacks-slug` |

### CLI, build, deploy, test
| Task | Skill |
|---|---|
| The `buddy` / `bud` / `stacks` CLI (50+ commands, `make:*` scaffolding, custom commands in `app/Commands/`) | `stacks-buddy`, `stacks-cli`, `stacks-scaffolding` |
| Building (components, CLI binaries, server images, docs) | `stacks-build` |
| Native iOS/Android apps, Craft bridge, mobile builds and components | `stacks-mobile` |
| Deploying (server vs serverless, hooks, first deploy) and cloud infra (EC2/Lambda/CDK/Route53/SES/S3) | `stacks-deploy`, `stacks-cloud` |
| Testing (DB test utils, feature tests, config) | `stacks-testing` |
| Dev server, HMR, reverse proxy, SSL | `stacks-development`, `stacks-server` |
| Technical diagrams (architecture, workflow, sequence, data flow, lifecycle) | `stacks-technical-diagrams` |

The recommended order for a new feature is **model, migration, action, route, test** (see
`stacks-new-feature`).

---

## Auto-imports

Auto-imports let app code skip many `import` statements, but the rules differ by context and the
framework's own code is the source of truth (verified against the manifests, not just the docs).
Manifests: `storage/framework/{browser,server}-auto-imports.json`. Generated types:
`storage/framework/types/*auto-imports.d.ts`. Regenerate with `buddy generate` (`--types` for the
declarations). Full reference: `stacks-auto-imports`.

**stx templates (browser)** - available with no import:
- STX reactivity and 200+ composables: `ref`, `computed`, `watch`, `reactive`,
  `watchEffect`, `useFetch`, `useDark` / `useColorMode`, `useStorage`, `useLocalStorage`, `useToggle`,
  `useCounter`, `useIntersectionObserver`, `useScroll`, `useMouse`, `useParallax`,
  `usePreferredReducedMotion`, plus utilities (`debounce`, `throttle`, `sleep`, `clamp`), `useAuth`,
  and the Stripe helpers (`loadCardElement`, `confirmPayment`, ...).
- Your components under `resources/components/` (write `<Card />` directly, resolved by the stx
  plugin) and your functions under `resources/functions/` (e.g. `increment`, `toggleDark`).

Browser auto-imports are injected into the STX script entry only. A TypeScript
module imported by that script must explicitly import every function, store,
and type it uses; entry bindings do not leak into bundled module scope.

**Server** (routes, `app/Actions/`, `app/Jobs/`, models) - injected into `globalThis`:
- All 60+ models (`User`, `Product`, `Order`, ...) with their `Model` / `Request` / `RequestModel`
  variants, so `await User.find(1)` works with no import.
- Everything exported from `app/Jobs/` and `resources/functions/`.

**Import these explicitly (the framework does).** `types/auto-imports.d.ts` also declares `Action`,
`route`, `response`, `schema`, `slug`, `path`, `storage`, `log`, and `Auth` as ambient global types,
but the built-in actions and models import them from their packages anyway (`@stacksjs/actions`,
`@stacksjs/router`, `@stacksjs/validation`, ...), and so should you. `defineModel` is always imported
from `@stacksjs/orm`. When unsure, copy the import pattern from `storage/framework/defaults/app/`.
Add your own auto-imports by exporting from `resources/functions/` (browser) or the auto-import
barrel, then run `buddy generate`.

---

## Data layer: models, ORM, query builder, migrations

Stacks is Laravel-like (models, relationships, traits, factories, a fluent query builder), with one
big difference: **migrations are derived from your models, not hand-written.** You describe the
schema once in the model; Stacks diffs it against the database and generates the SQL. See
`stacks-orm`, `stacks-models`, `stacks-migrations`, `stacks-database`, `stacks-query-builder`.

### Define a model
Models live in `app/Models/` (your custom models and overrides) and
`storage/framework/defaults/app/Models/` (60+ built-ins, grouped into `commerce/`, `Content/`, etc.).
Use `defineModel()`; the whole schema, validation, factory, relationships, and behavior traits are
declared in one place.

```ts
// app/Models/Product.ts
// Models and app/Jobs are auto-imported as server globals; stx composables and
// resources/components are auto-imported in templates. In a model file you still
// import defineModel and schema explicitly, exactly as the built-in models do.
import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Product',
  table: 'products',

  traits: {
    useUuid: true,
    useTimestamps: true,          // created_at / updated_at
    useSeeder: { count: 20 },     // rows `buddy seed` generates from the factories below
    useApi: {                     // auto-generate REST actions + routes
      uri: 'products',
      routes: ['index', 'store', 'show', 'update', 'destroy'],
    },
    useSearch: { searchable: ['name'], filterable: ['status'] },
    observe: true,                // emit product:created / :updated / :deleted events
  },

  belongsTo: ['Category'],
  hasMany: ['Review'],

  attributes: {
    name: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().maxLength(100) },
      factory: faker => faker.lorem.word(),
    },
    price: {
      fillable: true,
      validation: { rule: schema.number().min(1) },
      factory: faker => faker.datatype.number({ min: 100, max: 10000 }),
    },
    status: {
      fillable: true,
      default: 'draft',
      validation: { rule: schema.enum(['draft', 'published', 'archived']) },
    },
  },
})
```

Traits do real work: `useApi` generates the REST actions and routes for the model, `useAuth` adds
auth columns + passkeys, `useSearch` wires search-engine indexing, `useSeeder` sets how many rows
`buddy seed` generates from the per-attribute `factory` functions, `useSoftDeletes` adds
`deleted_at` plus its query scopes, and `billable` / `taggable` / `categorizable` / `commentable` /
`likeable` add their relations and methods. See `stacks-models` for the full trait and attribute
reference.

### Model-driven migration workflow
```bash
# 1. Define or change a model in app/Models/ (or storage/framework/defaults/app/Models/)
buddy generate:migrations     # 2. diff models vs current schema, emit SQL into database/migrations/
# 3. review the generated migration file
buddy migrate                 # 4. apply pending migrations   (--diff to preview SQL, --auth for auth tables)
buddy migrate:fresh --seed    #    (dev) drop everything, re-migrate, then seed
```
`buddy make:migration <name>` still exists for hand-written migrations, and 96+ migrations ship for
the built-in models. `buddy migrate` verifies models exist before running.

### Query builder
Models expose a fluent, chainable query API (backed by `bun-query-builder`) plus create/update/delete
and eager loading. Exact method surface is in `stacks-query-builder` / `stacks-orm`; typical shape:

```ts
const published = await Product.where('status', 'published').orderByDesc('created_at').all()
const product = await Product.find(id)
const created = await Product.create({ name: 'Widget', price: 1200 })
await transaction(async () => { /_ ... atomic work ... _/ })
```
Eager loading, pagination, and the full method set are in `stacks-query-builder` / `stacks-orm`.

---

## The buddy CLI

All of `./buddy`, `bud`, and `stacks` invoke the same CLI. (The `stx` bin belongs to the stx
template engine, not buddy - see stacksjs/stacks#2081.) Run `buddy list` for everything and
`buddy <command> --help` for flags. Full reference with every flag: `stacks-buddy`.

**Develop & serve**
- `buddy dev [frontend|api|docs|dashboard|desktop]` start dev server(s) + reverse proxy; `buddy dev:components` component playground
- `buddy down` / `buddy up` enter / exit maintenance mode

**Build & generate**
- `buddy build [components|functions|views|docs|cli|server|stacks]` production builds
- `buddy generate[:types|:openapi|:migrations|:entries|:ide-helpers]` types, OpenAPI spec, migration diffs, IDE helpers

**Database**
- `buddy migrate [--diff|--auth]`, `buddy migrate:fresh [--seed]`, `buddy seed`, `buddy generate:migrations`

**Scaffold (`make:*`)**
- `make:model`, `make:migration`, `make:action`, `make:component`, `make:view` (`make:page`), `make:job`, `make:middleware`, `make:notification`, `make:policy`, `make:resource`, `make:command`, `make:factory`, `make:function`, `make:lang`, `make:database`, `make:queue-table`, `make:stack`, `make:certificate`

**Quality & test**
- `buddy lint [--fix]` / `buddy lint:fix` / `buddy format[:check]` (pickier)
- `buddy test [--unit|--feature]` / `test:unit` / `test:feature` / `test:ui` / `test:types` (`typecheck`)

**Environment**
- `buddy env:get|set|encrypt|decrypt|keypair|rotate|check` manage and encrypt `.env` values

**Cloud & deploy**
- `buddy deploy` full deploy workflow (prereqs, env, APP_KEY, AWS, DNS, mail records)
- `buddy cloud [--ssh|--diff|--invalidate-cache]`, `cloud:add --jump-box`, `cloud:remove`, `cloud:cleanup`, `cloud:optimize-cost`

**Domains & DNS**
- `buddy domains:purchase|add|remove` (Route 53), `buddy dns [domain]` DNS query tool

**Email & mail server**
- `buddy email:verify|test|list|logs|status|inbox|reprocess` (SES / S3)
- `buddy mail:user:add|list|delete`, `mail:proxy`, `mail:test`, `mail:credentials`, `mail:logs`, `mail:status`, `mail:server`, `mail:port25:*`

**Project & framework**
- `buddy install` / `fresh` / `clean` / `add` / `outdated`
- `buddy upgrade[:all|:dependencies|:bun|:shell|:binary]` upgrade framework, deps, or Bun
- `buddy about` / `buddy doctor` / `buddy list` info and health checks

Custom commands live in `app/Commands/` and register via `app/Commands.ts` (`make:command` scaffolds
one). See `stacks-cli` for building commands.

---

## Stack essentials (frontend)

- **Templating:** stx `.stx` Single File Components (`<script server|client>`, `<template>`,
  `<style>`; Blade directives `@if` / `@foreach` / `@layout`; `{{ x }}`; filters `{{ x | currency }}`).
- **Never** use `var`, `document._`, or `window._` in stx `<script>` blocks. Use signals
  (`state` / `derived` / `effect`) and composables. See `stacks-stx`, `stacks-composables`.
- **CSS:** Crosswind utilities, `dark:` variant, arbitrary values; dark mode via `useColorMode()` /
  `useDark()`. See `stacks-crosswind`, `stacks-ui`.
- **Icons:** Iconify classes `i-{collection}-{name}` (hugeicons by default). Never hand-roll SVG icon
  paths; never add npm icon packages.
- **Fonts:** the `fonts` config plus `<link>` / `@font-face` with `font-display: swap`. No `next/font`.
- **Images:** `<img>` plus the stx asset pipeline / `@stacksjs/storage`. No `next/image`.
- **Motion:** Stacks ships no animation library. Do NOT import `motion/react`, `framer-motion`, or
  `gsap`. Use Crosswind transitions, CSS keyframes, CSS scroll-driven animations
  (`animation-timeline: view()` / `scroll()`), and composables (`useIntersectionObserver`,
  `useScroll`, `useParallax`, `useMouse`). Gate anything beyond hover with
  `usePreferredReducedMotion()`. Never attach `window.addEventListener('scroll', ...)` in a template.

---

## Design & anti-slop skills (read the SKILL.md before building UI)

For any visually important page (landing, hero, marketing, portfolio, product, redesign), read the
matching skill and follow it. These translate premium design discipline into stx + Crosswind.

| When the task is | Read |
|---|---|
| Any premium / anti-slop frontend (start here) | `stacks-design-taste` |
| Stricter, award-level, high-variance + deterministic motion | `stacks-design-taste-codex` |
| Aesthetic already chosen: expensive / soft | `stacks-design-soft` |
| Aesthetic: editorial / minimalist (Notion / Linear) | `stacks-design-minimalist` |
| Aesthetic: industrial / brutalist | `stacks-design-brutalist` |
| Upgrading an existing UI (audit first) | `stacks-redesign` |
| Agent keeps truncating / placeholder output | `stacks-design-output` |
| Image-first: generate references, then implement | `stacks-image-to-code` |
| Reference images only (web / mobile / brand) | `stacks-imagegen-web`, `stacks-imagegen-mobile`, `stacks-brandkit` |

The flagship (`stacks-design-taste`) carries the shared rules: brief inference, the three dials
(VARIANCE / MOTION / DENSITY), typography / color / layout discipline, the AI-Tells list, the redesign
protocol, and a binding pre-flight check. The others refine it and defer to it.

---

## Hard rule: no em-dashes in user-visible output

Never emit an em-dash (`—`) or a separator en-dash (`–`) in any user-visible string you generate:
headlines, body copy, labels, buttons, alt text, captions. Use a regular hyphen `-`, a comma, or two
sentences. This is the single most common AI design tell and it is a pre-flight failure.

## Before finishing

- Lint: `./buddy lint` (fix with `./buddy lint:fix`). Run relevant tests with `./buddy test`.
- Type check what you touched: `./buddy typecheck` for `app/`, `config/`, `resources/` and
  `routes/`; `bun run typecheck` for framework internals. Both run on TypeScript 7 (`tsc`, the
  native Go compiler) and finish in a couple of seconds.
- For UI work, run the pre-flight check in `stacks-design-taste` (Section 14). If a box cannot be
  honestly ticked, the work is not done.
