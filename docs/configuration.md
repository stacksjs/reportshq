# Configuration reference

ReportsHQ has two integrations with the same reporting semantics: `@reportshq/stacks` and `reportshq/laravel`. Both require a model registry. Routes, API access, timezone, storage and licensing are explicit application decisions.

## Stacks

```ts
// config/reportshq.ts
export default {
  models,
  license: null,
  timezone: 'UTC',
  routes: {
    enabled: true,
    prefix: '/reports',
    middleware: ['auth'],
    shareMiddleware: [],
  },
  api: {
    enabled: false,
    prefix: '/api/reportshq',
    middleware: ['auth'],
  },
}
```

The Stacks package does not ship database tables. Provide a `ReportStore` backed by code, configuration, your own models or another persistence layer. The optional write methods determine whether the browser builder is editable or read-only.

## Laravel

```php
// config/reportshq.php
return [
    'models' => [/* declared model descriptions */],
    'license' => env('REPORTSHQ_LICENSE'),
    'connection' => env('REPORTSHQ_CONNECTION'),
    'routes' => [
        'enabled' => env('REPORTSHQ_ROUTES', false),
        'prefix' => env('REPORTSHQ_ROUTE_PREFIX', 'reports'),
        'middleware' => ['web', 'auth'],
        'share_middleware' => ['web'],
    ],
    'api' => [
        'enabled' => env('REPORTSHQ_API', false),
        'prefix' => env('REPORTSHQ_API_PREFIX', 'api/reportshq'),
        'middleware' => ['api'],
    ],
];
```

These are values in the current repository source, not the published v0.1.0 package. Once a reporting release exists, publish its configuration with the command in [the Laravel guide](/docs/laravel). The package loads its own migrations. Set page and API middleware for your host before enabling either surface; the source defaults shown here do not add an auth guard.

## Model descriptions

Keep the registry narrow:

- Declare only tables and columns intended for reporting.
- Put row-level restrictions in the reporting description. ORM global scopes and soft-delete behavior do not automatically apply to compiled SQL.
- Mark fan-out relations accurately.
- Use explicit currency and timezone semantics.
- Bound high-cardinality dimensions.

## Middleware

The current Laravel source has separate page, API and share middleware. The page and API defaults are `web` and `api`, respectively, without an application-specific auth guard. Add your own auth policy before enabling them. Its share link may be intentionally public to anyone holding a revocable token. The Stacks package describes no share route today.

An empty share middleware list does not make every report public. Only an active share token exposes its published report in Laravel. Add rate limiting, trusted proxy and application-specific policy middleware when required.

## Environment values

Common Laravel environment settings include:

| Variable | Purpose |
| --- | --- |
| `REPORTSHQ_LICENSE` | Optional offline license key |
| `REPORTSHQ_CONNECTION` | Reporting database connection |
| `REPORTSHQ_ROUTES` | Enable packaged page routes |
| `REPORTSHQ_ROUTE_PREFIX` | Page route prefix |
| `REPORTSHQ_API` | Enable the JSON API |
| `REPORTSHQ_API_PREFIX` | JSON API route prefix |

## Getting a licence key

A licence is issued to an account, one per installed application, and is listed on the account page at reportshq.org.

In a Stacks application, the framework CLI fetches it:

```bash
buddy hq:connect reportshq
```

The command prints an approve link and a short confirmation code. Open the link, sign in, type the code and approve. The licence is then written to the application's `.env` as `REPORTSHQ_LICENSE`. It is never printed in the terminal.

Running the command again for the same application, from any machine, returns the same licence. Set that one key in every environment the application runs in.

A Laravel application copies its key from the account page into `REPORTSHQ_LICENSE`.

The exact configuration surface is versioned with each package. Treat the installed package's typed config or published config file as the final source of truth.
