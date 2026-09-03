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

## Read this first: the product pivoted

ReportsHQ was a hosted event collector until August 2026. It is now a **self-hosted reporting
library** that runs inside the customer's own application and queries the customer's own database in
process. The hosted pipeline was deleted from this app in `b3dbf0b` ("feat!: retire the hosted
pipeline"): `routes/ingest.ts`, `app/Events/`, `app/Reports/`, `resources/views/report-edit.stx` and
thirteen models are gone.

**The hosted collector at `https://reportshq.org/ingest` is not currently answering.** The Laravel
package's event forwarder no longer defaults to it; as of `78d5523` an endpoint must be configured
explicitly or the whole event side stays unregistered. Whether the collector is retired or merely
absent is an **unmade product decision**, so do not delete the event code and do not write docs that
assume either answer.

Consequences for you:

- The GitHub roadmap issues (including #1) predate the pivot and describe the deleted product. Read
  every one of them against what is in the tree, not the other way round.
- Anything in `docs/` that mentions ingestion, an event taxonomy file, or the in-app builder is
  stale in the same way this file was. Verify before quoting it.
- `database/migrations/` still creates the thirteen retired tables, and no committed migration
  removes them. Production still has them. Your local SQLite may not.

## 1. What ReportsHQ is

**Reports that run inside your own application, against your own database.** A customer installs a
package, describes which models and columns are queryable, and gets reports rendered from their own
rows. Nothing is sent anywhere. Two published artifacts carry the product, and neither of them is
this app:

- **`@reportshq/stacks`** (`packages/stacks/`) - the Stacks/TypeScript library. A semantic `Registry`
  (an allowlist of measures and dimensions), a `Compiler` that turns a block's configuration into one
  SQL query, a `Runner`, grid layout, custom-element rendering, CSV export, HTTP route
  *descriptions* the host application mounts itself, and an offline `License`. Its own top docblock
  is the summary: nothing here reaches the network, and a test asserts the source contains no
  `fetch(`, `XMLHttpRequest`, `WebSocket` or `Bun.connect`.
- **`reportshq/laravel`** (`packages/laravel/`, on Packagist) - the same product for Laravel, plus a
  second thing. It exports both CSV and XLSX (`src/Reports/Export.php`), which the TypeScript package
  does not. The service provider keeps **two independent halves** apart on purpose, separated by a
  single early return in `boot()`:
  - the **reports half** (`src/Query/`, `src/Semantic/`, `src/Reports/`, `src/Charts/`,
    `src/Filament/`, `src/Console/`, `src/License.php`) - in-process, always registered, reads the
    application's own connection;
  - the **event half** (`src/Mapper.php`, `src/Sampler.php`, `src/Transport.php`, `src/Sender.php`,
    `src/SendEvents.php`) - the optional forwarder that maps Laravel events onto the shared taxonomy
    and POSTs them to a collector. It is live, tested (the cross-SDK contract lives in
    `docs/fixtures/sdk-events.json` and is replayed by `packages/laravel/tests/run.php`), and it
    registers **nothing** unless a key, an endpoint and a sample rate above zero are all configured.

**This app is not the product.** `reportshq.org` is now a marketing site, an auth flow, an account
page and a read-only report viewer that dogfoods `@reportshq/stacks` against its own `users` table.
Its one report is hand-written in `config/reportshq.ts` and served through `app/Support/reports.ts`,
whose `saveLayout` throws on purpose: reports here are edited in a file and reviewed, not dragged in
a browser. The builder still exists, in the packages, for customers whose reports live in tables.

Licensing is **offline and gates nothing**. A key is `rhq_lic_` plus 32 hex characters, shape-checked
locally; an absent or malformed key changes only the notice printed under a report. Free, Hobby and
Pro are priced per *installed application* in `app/Billing/limits.ts` (per event died with the
pipeline: there is no ingest to count), and that file is a pricing-page data source, not an enforcer.
Some tier lines there describe capabilities that do not exist yet (XLSX export from the TypeScript
package among them); treat it as pricing copy, not as an inventory of shipped features. No checkout
is wired: `config/payment.ts` and `config/saas.ts` are still untouched Stacks scaffold.

The whole roadmap lives as GitHub issues on `stacksjs/reportshq`, tracked from
[issue #1](https://github.com/stacksjs/reportshq/issues/1). **Read the issue before starting its
work** - and read it sceptically. Most of the open issues were written for the hosted collector and
their acceptance criteria name deleted surfaces; the issue text is history plus intent, not a
description of the tree.

The sibling product [loghq](https://github.com/stacksjs/loghq) solves the same shape of problem for
logs, and is also a dependency here (`@loghq/stacks`). Its marketing architecture is the reference to
study, not to copy verbatim.

## 2. Architecture

| Concern | Where it lives |
|---|---|
| What this app serves | `resources/views/` - marketing (`index`, `pricing`, `features/`, `use-cases/`, `compare/`), auth (`login`, `register`, `forgot`, `reset`), `account.stx`, and the read-only viewer `reports/index.stx` + `reports/[slug].stx` |
| This app's routes | `app/Routes.ts` registers `routes/auth.ts` (5 POSTs under `/api/auth`) and `routes/reports.ts` (mounts 8 of the package's 10 route descriptions under `/api/reports`, behind `auth`). `routes/api.ts` is comment only, and says why |
| This app's reports | `config/reportshq.ts` - the model allowlist and the one code-defined report; read through `app/Support/reports.ts`, which builds the Registry, Runner, store and handlers |
| Query engine (TS) | `packages/stacks/src/compiler.ts`, `runner.ts`, `semantic.ts` - block config in, one query and one answer out |
| Query engine (PHP) | `packages/laravel/src/Query/` (`Compiler.php` plus a dialect per database), `src/Semantic/`, `src/Reports/` |
| HTTP surface of the package | `packages/stacks/src/http/routes.ts` describes routes, `handlers.ts` implements them over a `ReportStore`. The package never calls the router; the application mounts it |
| Charts | `resources/components/charts/` - 8 stx elements over `@ts-charts/*` (through `resources/functions/charts.ts`), published as `@reportshq/elements` per `config/library.ts`, bundled to `public/reportshq/charts.js` |
| Builder | `packages/stacks/resources/views/builder.stx` and the Laravel package's Blade equivalent, sharing `resources/js/reportshq-builder.js`. **Not mounted in this app** |
| Event forwarder | `packages/laravel/src/{Mapper,Sampler,Transport,Sender,SendEvents}.php`, gated by `Config::enabled()`; taxonomy contract in `docs/fixtures/sdk-events.json` |
| Licence | `packages/stacks/src/license.ts`, `packages/laravel/src/License.php` - offline shape check, `rhq_lic_` prefix |
| Plan limits | `app/Billing/limits.ts` - the single source of truth for every tier number, and it gates nothing |
| Marketing copy and SEO | `app/Marketing/pages.ts`, `app/Marketing/seo-files.ts` (sitemap, robots) |
| Sessions and sign-in | `app/Middleware/Auth.ts`, `app/Support/session.ts`, `app/Support/signin-limits.ts` |

Credentials, and what each one actually does. A **session cookie** built in `routes/auth.ts`
authenticates a person on the pages; a **bearer token** (`request.bearerToken()` into
`Auth.getUserFromToken`, in `app/Middleware/Auth.ts`) authenticates the `/api/reports` routes. The
**licence key** (`rhq_lic_...`) authenticates nothing and never leaves the machine. The Laravel event
half's **write key** travels as `X-ReportsHQ-Key` to whatever endpoint an application configures, and
this app has nothing that would accept one. There is no project ingest key and no project tenancy;
`app/Support/access.ts` still contains the old predicate and is dead apart from one call (see the
traps).

## 3. Non-negotiable rules

These are the house rules. They are not preferences, and "it was quicker" is not a reason to break
one.

1. **No hand-written migrations in the app.** Schema is derived from `app/Models/*` by
   `buddy generate:migrations`, reviewed, then applied with `buddy migrate`. If the generator cannot
   express what a model needs, **fix the generator** in `stacksjs/stacks` and release it. Do not
   hand-write SQL, and do not reshape a model to dodge a generator limitation. The one carve-out is
   `packages/laravel/database/migrations/`: a Composer package installed into somebody else's
   application ships its own PHP migrations (five `reportshq_*` tables) and cannot use the generator.
   Note also that `database/migrations/` still creates thirteen tables whose models were deleted in
   the pivot; that is deliberate residue, not licence to add more.
2. **No workarounds.** When a framework or library gap blocks you, fix it at the root in the owning
   repository, release it, and consume the released version. If the root fix is genuinely out of
   scope, stop and say so plainly rather than papering over it locally. Silent local patches are how
   a framework bug becomes twelve app-specific bugs.
3. **No third-party dependencies.** Only our own packages, from `~/Documents/Stacks/*` and
   `~/Documents/Libraries/*`, published under their own names: `stacks` and `@stacksjs/*`,
   `@ts-charts/{array,format,scale,shape}` (charts), `ts-spreadsheets` (CSV, XLSX),
   `bun-query-builder`, `ts-rate-limiter`, `ts-pantry`, `@loghq/stacks`, and friends. Missing
   capability means improving that package upstream and running `bun run release:patch` there, not
   reaching for npm. The one non-Packagist PHP dependency, `stacksjs/php-spreadsheets`, is pulled
   through a `repositories` entry that an installing application has to repeat.
4. **Design work follows the skills.** `stacks-design-taste` first, then the aesthetic preset and
   `stacks-design-output`. The Section 14 pre-flight is a gate, not a suggestion: if a box cannot be
   ticked honestly, the work is not finished. `dataviz` is required reading before writing chart
   code, because the charts are the product.
5. **No em-dashes** (`-` or `--` style long dashes) in any user-visible string: headlines, body copy,
   labels, buttons, alt text, captions, email content, docs prose. A hyphen, a comma, or two
   sentences instead.
6. **Commits.** Conventional messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`), scoped and
   small, authored under your own git identity (recent history is
   `glennmichael123 <gtorregosa@gmail.com>`), no co-author trailers, pushed to `main`.
7. **Before finishing anything:** `./buddy lint`, `./buddy typecheck`, `./buddy test`, all green.
   Touching `packages/laravel/` also means the six PHP suites CI runs:
   `for suite in run compiler layout license semantic filament; do php packages/laravel/tests/$suite.php; done`.
   For UI work, add the design pre-flight. Report honestly when something fails.

## 4. Traps that have already cost time here
- **stx drops every prop passed from one component to another**
  (stacksjs/stx#1937, closed 2026-08-17, unverified against the installed
  0.2.265): an array, a boolean and a plain string attribute all arrive as their
  defaults, silently. Page-to-component passing works fine, which is what makes
  it easy to miss. Shared chrome goes in a **partial**, which is included into
  the page's own scope; chart components inline their frame for the same reason.
  Re-test before relying on the fix; the partials are cheap and still correct
  either way.
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
  the body explicitly. The surviving example is `routes/auth.ts`, whose `body()`
  helper does `await request.text()` and `JSON.parse` for exactly this reason.
  A handler relying on `input()` sees empty values and answers "not found" for a
  record that is right there.
- **Never anchor a test fixture to "today".** A fixture at "today 08:00" lands in
  a different bucket depending on when the suite runs, and it broke CI once. The
  original cause (ingest clamping future timestamps) is gone with the pipeline;
  the rule survives because bucketing is timezone-dependent. Anchor to fixed
  absolute dates, as `packages/stacks/tests/compiler.test.ts` does.
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
- **Timezone is a property of the query, not a label on the result.** The
  compiler applies it inside the bucket expression, per dialect (`AT TIME ZONE`,
  `CONVERT_TZ`, a fixed-minute shift on SQLite), because a day that starts at
  midnight in Berlin is a different set of rows from one that starts at midnight
  in UTC and no relabelling afterwards fixes which rows landed where. Resolution
  is `report.timezone ?? config.timezone`, defaulting to `'UTC'`
  (`packages/stacks/src/config.ts`), and an unusable value means UTC rather than
  an error. This app's store returns no per-report timezone, so the configured
  default is the live path. Do not go looking for a `projects.timezone`: there
  is no project.
- **SQLite will not tell you the shift was wrong.** `datetime(col, '+12:00
  hours')` returns NULL rather than erroring, every bucket collapses to NULL, and
  the chart shows one bar holding everything. It looks like a grouping bug and it
  is a modifier typo, which is why `sqliteShift()` emits minutes.
- **`app/Support/access.ts` queries tables that may not exist.** `projectsFor()`
  is imported by `resources/views/account.stx` and runs a raw `SELECT` against
  `projects`, a table the pivot left in the migrations and in production but not
  in a freshly migrated local database. Combined with the `<script server>` trap
  below, that blanks the whole account page locally. The other five exports in
  that file have no callers at all.
- **Never declare a bare-local-part forward on the shared mail server.** The
  bare form is not domain-scoped, and the box hosts a dozen domains: a `support`
  key catches support@ for every tenant with no real mailbox at that address.
  Use full-address keys only, which means an alias only works for an address
  that is also a real mailbox. Provisioning writes the bare form automatically
  for any forward whose address is not a *password-bearing* mailbox, so this
  fires on a first provision before passwords are set.
- **Mail submission is port 587 with STARTTLS, never 465.** The SMTP driver
  opens a plain socket and negotiates, so implicit-TLS 465 hangs and fails with
  `SMTP connection timed out after 30000ms` and nothing else. A raw TLS client
  talks to 465 happily, which makes the driver look innocent.
- **A mailbox declared in `config/email.ts` needs a `MAIL_PASSWORD_<LOCALPART>`
  in the target environment or it is not created.** That is deliberate upstream
  (a deploy must not conjure credentials nobody can retrieve) but it used to be
  silent: provisioning reported success having created nothing. Fixed in
  stacksjs/stacks to warn and name the variable, but check the server rather
  than the exit code until that release lands.
- **`buddy env:encrypt` with no argument encrypts `.env`**, the development one,
  not `.env.production`. Pass `--env production`. An encrypted `.env` without
  `DOTENV_PRIVATE_KEY_DEVELOPMENT` silently falls back to defaults for every
  variable, which looks like the app losing its configuration.
- **Any error in an stx `<script server>` block silently blanks every binding
  in the view.** The page still returns 200 and the only symptom is an
  `[Foreach Error]` comment naming whatever variable the template happened to
  loop over first, which is rarely the thing that broke. A missing import, an
  undeclared variable, a stale cached module: all present identically. When
  several bindings go blank at once, wrap the suspect section in a try/catch and
  render the message rather than reading the template.
- **A new export from an app module is invisible to stx until you clear its
  build cache.** `rm -rf storage/framework/stx/cache` (the directory appears
  once the server has run) and restart. Until then the import is `undefined` and
  the page reports `X is not a function` **only if you catch it**: uncaught, stx
  discards the entire server script, so *every* binding in the view is empty at
  once and the page renders as a structurally correct shell with no data. The
  visible symptom is an unrelated `[Foreach Error]` comment about a different
  variable, which sends you hunting in the wrong place. If several bindings go
  blank together, suspect the cache before suspecting the template.
- **A new `.stx` view needs a dev server restart.** The route table is built at
  boot, so a freshly added view 404s while its path is listed on the 404 page's
  own "available pages", which is a confusing way to find out.
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
  emitted on the stx serve path, and 0.74 dropped it from the scaffold config
  entirely. They live in `public/tokens.css`, linked from `config/ui.ts`.
- **`buddy migrate:fresh` has burned this scaffold before**
  (stacksjs/stacks#2323, closed 2026-08-27; the command has since been reworked
  and now carries `--seed` and a guarded `--force`): it failed partway and left
  duplicate migrations behind. Re-test before trusting it. The safe reset is
  still `rm database/stacks.sqlite && ./buddy migrate`.
- **loghq attaches through a preload here, not a config key.** The attachment
  lives in `app/Support/loghq.ts`, wired through the `resources/plugins/loghq.ts`
  entry that `bunfig.toml` preloads, and wraps the `log` singleton in place. It
  must stay a preload: a wrap only captures what is logged after it, so anything
  later has already let the framework's own startup lines past. The original
  reason for avoiding the sibling apps' declarative `transports` key has
  expired - this app is now on `@stacksjs/logging` 0.74.5, which exports
  `registerTransport`, and `LoggingConfig` declares `transports`. The comments in
  `config/logging.ts` and `app/Support/loghq.ts` still cite 0.70.378 and are
  wrong. `captureStruct: false` is still set in `app/Support/loghq.ts` for that
  same expired version reason, and its own comment says to revisit it if the app
  upgrades, which it now has. Both that flag and the move to the declarative seam
  are open decisions rather than bug fixes; if you take either, check that the
  preload ordering guarantee survives.

## 5. Known upstream state

- **The 0.74 line is uninstallable from scratch**
  ([stacksjs/stacks#2425](https://github.com/stacksjs/stacks/issues/2425)). A clean install fails;
  this app survives on its committed lockfile and on 73 entries in `package.json`'s `overrides`,
  which pin the framework packages by hand. **Those overrides must all be removed once the release
  is fixed** - they are a workaround with an expiry date, not configuration. Do not add app
  dependencies that force new ones.
- **`LibraryBuildOptions` does not declare the fields its own resolver reads**
  ([stacksjs/stacks#2426](https://github.com/stacksjs/stacks/issues/2426)). `include`, `exclude` and
  `prefix` are augmented locally in `app/library.d.ts`. `config/library.ts` needs all three: the
  chart elements live one directory down in `resources/components/charts/`, which only a recursive
  glob reaches, and `prefix` must be pinned because 0.74 derives the custom-element prefix from the
  package name - renaming would quietly re-register every chart as `elements-*` and leave them
  blank. Delete `app/library.d.ts` when the framework declares the fields.
- **`deps:lockfile:check` is wired to a script that does not exist.** `package.json` declares
  `"deps:lockfile:check": "bun .github/scripts/check-lockfile-version.ts"`, but `.github/scripts/`
  is not in the tree, so the command exits with `Module not found`.
  The Bun pin below is therefore unguarded. Write the script or drop the wiring; do not assume the
  check is protecting you.
- `config/mobile.ts` is deliberately absent. ReportsHQ ships no native application, and there is
  nothing to configure. The old blocker
  ([stacksjs/stacks#2322](https://github.com/stacksjs/stacks/issues/2322)) is closed:
  `@stacksjs/mobile` is installed and `MobileConfig` is published, so the file could be added if a
  native surface ever became a product decision. It has not.
- `@reportshq/stacks` is **not** published in its current form. npm still serves `0.1.0`, which is
  the deleted event SDK; the local rewrite carries the same version number, so publishing needs a
  bump. `packages/stacks/resources/dist/builder.js` is also copied in by the *root* `build:charts`
  script rather than by the package's own build, so a naive publish ships a tarball missing it.
- `reportshq/laravel` v0.1.0 is live on Packagist. Its README still prints the pre-`78d5523` endpoint
  default and still links `docs/events.md`, which does not exist.

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
- Dependency updates arrive through **renovate** (`.github/renovate.json`, extending
  `ow3org/renovate-config`), and its dashboard is issue #25. `config/buddy-bot.ts` exists but still
  targets `stacksjs/stacks` and has no workflows in `.github/workflows/`, so treat buddy-bot as
  unwired here rather than as the mechanism.
- **better-dx** bundles the shared dev tooling (`typescript`, `pickier`, `bun-plugin-dtsx`,
  `bun-git-hooks`, `@stacksjs/gitlint`, `bunfig`, `@types/bun`, ...). If `better-dx` is in a
  `package.json`, do not also declare what it ships - two ranges for one tool only drift. A package
  that *imports* one of them at runtime declares it as a real `dependency` instead.
- If `better-dx` is in `package.json`, ensure `bunfig.toml` sets `linker = "hoisted"`.
- Do not use Bun's `catalog:` protocol. Every dependency carries its version range in the
  `package.json` that declares it, so vendored apps and update bots both see a resolvable range.

### Commits
- Use conventional commit messages (`fix:`, `feat:`, `chore:`, ...).
- Only commit or push when asked. If on the default branch, branch first.

### Requirements
- **Bun is pinned exactly at 1.3.14** in `deps.yml`, not floored. `^1.3.14` resolves through
  pantry's `v1` symlink and can land on 1.4.x, which writes `lockfileVersion: 2` that 1.3.x cannot
  parse. Nothing currently enforces this (see the missing lockfile-check script above), so do not
  loosen the pin.
- SQLite >= 3.47.2. TypeScript throughout. PHP >= 8.2 for `packages/laravel` (its suites run on a
  bare `php`, with no composer install and no network).

---

## Repository map

| Path | What lives here |
|---|---|
| `app/` | Your application code (see the override model below): `Actions/`, `Jobs/`, `Listeners/`, `Middleware/`, `Mail/`, `Commands/`, `Models/`, plus this app's own `Billing/`, `Marketing/`, `Support/`, and top-level `Routes.ts`, `Events.ts`, `Gates.ts`, `Scheduler.ts`, `Middleware.ts`, `Commands.ts`, `Listener.ts`, `library.d.ts` |
| `packages/` | **The product.** `packages/stacks/` is `@reportshq/stacks` (src, tests, shipped stx views); `packages/laravel/` is `reportshq/laravel` (src, config, routes, database/migrations, resources, six PHP test suites) |
| `routes/` | `api.ts` (comment only, and it explains why), `auth.ts`, `reports.ts`, registered via `app/Routes.ts` |
| `config/` | 49 typed config files (`app.ts`, `database.ts`, `auth.ts`, `queue.ts`, `cache.ts`, `email.ts`, `payment.ts`, `cloud.ts`, `ui.ts`, `crosswind.ts`, `library.ts`, ... and `reportshq.ts`, which is where this app's queryable models and its one report are declared) |
| `database/` | `migrations/` (209 `.sql` files, including thirteen tables the pivot orphaned) and the local SQLite files |
| `resources/` | stx frontend and assets: `views/` (with `views/layouts/`), `components/` (including `components/charts/`), `partials/`, `emails/`, `functions/`, `js/`, `plugins/`, `assets/` |
| `storage/framework/` | Framework internals + **defaults** (`defaults/app/` including the built-in `Models/` and `Actions/`, `defaults/ai/` with 115 agent skills, `defaults/views/`, `defaults/routes/`, `libs/`, `server/`, and the auto-import manifests); read-only reference, do not edit unless working on the framework |
| `storage/` | Also holds all machine-local runtime state: `framework/stx/` (stx build cache), `framework/runtime/` (migration lock, temp bundles), `cloud/` (cloud driver state). All gitignored, all safe to delete |
| `tests/` | This app's Bun test suites (the packages carry their own) |
| `cloud/` | AWS infrastructure (CDK / CloudFormation) for deploys |
| `content/`, `docs/`, `locales/`, `public/` | CMS/markdown content, docs site, i18n strings, static assets (including `public/tokens.css` and the built `public/reportshq/`) |

This is a **package-based** app, not a vendored one, which is why there is no `storage/framework/core/`.
`buddy core:status` is the command that tells you which kind you are in. Anything in `package.json`
that reaches into `storage/framework/core/` cannot work here - `typecheck:framework` is one such
script, and it fails on a missing directory.

### The `app/` override model
Stacks resolves files from `app/` first and falls back to `storage/framework/defaults/app/`. To
customize a framework default (e.g. a CMS action), create the same path under `app/`
(`app/Actions/Cms/PostIndexAction.ts`) and it wins. New files you add under `app/` are available to
the app (e.g. `app/Actions/MyAction.ts` is referenced as `'Actions/MyAction'` in routes). There are
roughly 700 default actions and 97 built-in models you can use or override. This app overrides almost
none of them: `app/Models/` contains exactly one file, `User.ts`.

---

## Building features: feature → skill index

Read the skill before building. The full list lives in `storage/framework/defaults/ai/skills/`; run
`buddy setup:ai` to expose it to your agent.

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
- The stx client API, which is *not* in the browser manifest: it is destructured from `window.stx`
  by a prelude the engine injects. That is where the signal primitives (`state`, `derived`,
  `effect`) and `ref` / `computed` / `watch` come from, so do not go looking for them in the JSON.
- The 340 globals the browser manifest does carry: `useFetch`, `useDark` / `useColorMode`,
  `useStorage`, `useLocalStorage`, `useToggle`, `useCounter`, `useIntersectionObserver`, `useScroll`,
  `useMouse`, `useParallax`, `usePreferredReducedMotion`, utilities (`debounce`, `throttle`, `sleep`,
  `clamp`), `useAuth`, and the Stripe helpers (`loadCardElement`, `confirmPayment`, ...).
- Your components under `resources/components/` (write `<Card />` directly, resolved by the stx
  plugin) and your functions under `resources/functions/` (e.g. `increment`, `toggleDark`).

Browser auto-imports are injected into the STX script entry only. A TypeScript
module imported by that script must explicitly import every function, store,
and type it uses; entry bindings do not leak into bundled module scope.

**Server** (routes, `app/Actions/`, `app/Jobs/`, models) - injected into `globalThis`:
- The built-in model names (`User`, `Product`, `Order`, ...), so `await User.find(1)` works with no
  import. Only the bare names: the manifest carries no `Model` / `Request` / `RequestModel` variants,
  so import those.
- Everything exported from `app/Jobs/`. `resources/functions/` exports are **browser only** and are
  not server globals, despite appearing in both docs and intuition.

**Import these explicitly (the framework does).** `storage/framework/types/auto-imports.d.ts` also
declares `Action`, `route`, `response`, `schema`, `slug`, `path`, `storage`, `log`, and `Auth` as
ambient global types, but the built-in actions and models import them from their packages anyway
(`@stacksjs/actions`, `@stacksjs/router`, `@stacksjs/validation`, ...), and so should you.
`defineModel` is always imported from `@stacksjs/orm`. When unsure, copy the import pattern from
`storage/framework/defaults/app/`. Add your own auto-imports by exporting from `resources/functions/`
(browser) or the auto-import barrel, then run `buddy generate`.

---

## Data layer: models, ORM, query builder, migrations

Stacks is Laravel-like (models, relationships, traits, factories, a fluent query builder), with one
big difference: **migrations are derived from your models, not hand-written.** You describe the
schema once in the model; Stacks diffs it against the database and generates the SQL. See
`stacks-orm`, `stacks-models`, `stacks-migrations`, `stacks-database`, `stacks-query-builder`.

This app barely exercises any of it - it defines one model, `app/Models/User.ts` - so the example
below is the framework's shape, not a description of this repository.

### Define a model
Models live in `app/Models/` (your custom models and overrides) and
`storage/framework/defaults/app/Models/` (97 built-ins, grouped into `commerce/`, `Content/`, etc.).
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
`buddy make:migration <name>` still exists for hand-written migrations, and `database/migrations/`
currently holds 209 `.sql` files. `buddy migrate` verifies models exist before running - which is
why the thirteen orphaned tables from the pivot are worth knowing about before you run anything that
diffs the schema.

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

All of `./buddy`, `bud`, and `stacks` invoke the same CLI, and this repo's `package.json` also maps
`stx` to `./buddy`. Run `buddy list` for everything (318 commands) and `buddy <command> --help` for
flags. Full reference with every flag: `stacks-buddy`.

**Develop & serve**
- `buddy dev [frontend|api|docs|dashboard|desktop]` start dev server(s) + reverse proxy; `buddy dev:components` component playground
- `buddy down` / `buddy up` enter / exit maintenance mode

**Build & generate**
- `buddy build [components|functions|frontend|docs|cli|server|stacks]` production builds (views are the `--views` / `--pages` flags on the frontend build, not a subcommand)
- `buddy generate[:types|:openapi-spec|:migrations|:entries|:ide-helpers]` types, OpenAPI spec, migration diffs, IDE helpers

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
- Type check what you touched: `./buddy typecheck` (an alias for `buddy test:types`) covers `app/`,
  `config/`, `resources/` and `routes/`. It resolves `node_modules/.bin/tsc`, which is TypeScript
  5.9.3, not the native compiler - a few seconds, not instant. Do not reach for
  `bun run typecheck:framework`: it `cd`s into `storage/framework/core/orm`, which a package-based
  app does not have, and exits 1 every time.
- Touching `packages/stacks/`: `cd packages/stacks && bun test ./tests` (49 tests, 8 files).
  Touching `packages/laravel/`: run all six suites, as CI does -
  `for suite in run compiler layout license semantic filament; do php packages/laravel/tests/$suite.php; done`
  (133 tests). `tests/server.php` is not a suite; `run.php` spawns it.
- For UI work, run the pre-flight check in `stacks-design-taste` (Section 14). If a box cannot be
  honestly ticked, the work is not done.
