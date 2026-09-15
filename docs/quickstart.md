# Quickstart

ReportsHQ runs reporting queries inside the application that owns the data. The current reporting implementations live in this repository under `packages/stacks/` and `packages/laravel/`. Neither needs a hosted collector for reports.

## Check the release before installing

As of September 2026, npm serves `@reportshq/stacks` 0.1.0 and Packagist serves `reportshq/laravel` v0.1.0. Those published artifacts predate the reporting rewrite. Installing either version does **not** give you the reporting API described below. The TypeScript reporting source is versioned 0.2.0 in this checkout, but it has not been published. The Laravel reporting source also differs from its published artifact.

Do not use `bun add @reportshq/stacks` or `composer require reportshq/laravel` as a reporting setup step until releases containing the current source are available. You can inspect and test the current implementations in a working checkout of this repository:

```bash
cd packages/stacks
bun test ./tests
```

```bash
cd ../..
php packages/laravel/tests/run.php
```

The following steps describe the current source and what a host application must supply when the reporting packages are released. They are not a claim that a fresh customer install works today.

## 1. Describe queryable models

Name only the tables and columns a report may read. This is the security boundary for query identifiers.

```ts
// Stacks: config/reportshq.ts
import type { ModelDescription } from '@reportshq/stacks'

export const models: Record<string, ModelDescription> = {
  order: {
    table: 'orders',
    measures: {
      revenue: { aggregate: 'sum', column: 'total_amount', unit: 'currency' },
      orders: { aggregate: 'count' },
    },
    time: { placed: 'created_at' },
    dimensions: { status: 'status' },
  },
}
```

```php
// Laravel: config/reportshq.php, inside the returned array
'models' => [
    'order' => [
        'class' => App\Models\Order::class,
        'label' => 'Order',
        'grain' => 'one row per order',
        'dimensions' => [
            'status' => ['label' => 'Status', 'type' => 'string'],
            'placed' => ['label' => 'Placed', 'type' => 'date', 'column' => 'created_at'],
        ],
        'measures' => [
            'revenue' => ['label' => 'Revenue', 'aggregate' => 'sum', 'column' => 'total_amount'],
            'orders' => ['label' => 'Orders', 'aggregate' => 'count'],
        ],
    ],
],
```

Compiled SQL does not apply ORM scopes or soft deletes automatically. Declare the same row restrictions in the reporting model description when those rows must be excluded.

## 2. Decide where reports are stored

The Stacks package brings no report tables. Supply a `ReportStore` with `list`, `find`, `blocks`, and `saveLayout`, backed by code or your own persistence. Write methods are optional. This site defines its one Accounts report in `config/reportshq.ts` and keeps the viewer read-only. See [the Stacks integration](/docs/stacks) for the store and route descriptions.

The Laravel package source ships migrations for reports, blocks, revisions, shares, and schedules. Its `Builder` creates and publishes reports. The standalone pages are off by default; enable them only after choosing middleware that protects the data they expose. See [the Laravel integration](/docs/laravel).

## 3. Build a first report

A block names a model and one of that model's described measures. A time key or dimension is optional:

```ts
{ model: 'order', measure: 'revenue', time: { key: 'placed' }, grain: 'day' }
```

In a Stacks host, put this query in a stored block and mount the package's route descriptions behind your application's auth policy. In a Laravel host using the current source, `Builder::create('Commerce')` creates a draft; `Builder::addBlock()` adds a block; `Builder::publish()` records the published revision. The Laravel browser editor exists only when the standalone routes are enabled. This site's viewer does not mount an editor.

The compiler returns an explicit refusal on a block when a query names an undeclared field or would multiply a measure across a fan-out relation. It does not send a query to ReportsHQ servers.

## 4. Export or distribute

The Stacks package currently downloads CSV only. The Laravel source supports CSV and XLSX, plus local sharing and scheduled delivery. Those Laravel features require the host's route, middleware, queue, and mail decisions. See [exports and schedules](/docs/schedules-exports) and [sharing](/docs/sharing) for the package-specific behavior.

## What next

- [Reporting concepts](/docs/concepts) explains measures, dimensions, time grains, and fan-out.
- [The builder](/docs/builder) gives the current block and query vocabulary.
- [Configuration](/docs/configuration) shows the separate route and API switches.
