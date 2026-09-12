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
    'timezone' => env('REPORTSHQ_TIMEZONE', 'UTC'),
    'routes' => [
        'enabled' => env('REPORTSHQ_ROUTES', true),
        'prefix' => env('REPORTSHQ_PREFIX', 'reports'),
        'middleware' => ['web', 'auth'],
        'share_middleware' => ['web'],
    ],
    'api' => [
        'enabled' => env('REPORTSHQ_API', false),
        'prefix' => env('REPORTSHQ_API_PREFIX', 'api/reportshq'),
        'middleware' => ['api', 'auth:sanctum'],
    ],
];
```

Publish the package configuration and migrations using the commands documented in [the Laravel guide](/docs/laravel). Review generated routes before enabling the JSON API.

## Model descriptions

Keep the registry narrow:

- Declare only tables and columns intended for reporting.
- Put row-level restrictions in the reporting description. ORM global scopes and soft-delete behavior do not automatically apply to compiled SQL.
- Mark fan-out relations accurately.
- Use explicit currency and timezone semantics.
- Bound high-cardinality dimensions.

## Middleware

Page, API and share routes have separate middleware because they serve different callers. Page routes commonly use sessions, API routes use tokens, and a share link may be intentionally public to anyone holding its revocable token.

An empty share middleware list does not make every report public. Only an active share token exposes its published report. Add rate limiting, trusted proxy and application-specific policy middleware when required.

## Environment values

Common Laravel environment settings include:

| Variable | Purpose |
| --- | --- |
| `REPORTSHQ_LICENSE` | Optional offline license key |
| `REPORTSHQ_TIMEZONE` | Default report timezone |
| `REPORTSHQ_ROUTES` | Enable packaged page routes |
| `REPORTSHQ_PREFIX` | Page route prefix |
| `REPORTSHQ_API` | Enable the JSON API |
| `REPORTSHQ_API_PREFIX` | JSON API route prefix |

The exact configuration surface is versioned with each package. Treat the installed package's typed config or published config file as the final source of truth.
