# Quickstart

Empty application to first report, in about five minutes. Nothing here talks to
a service, because there is not one: everything below runs on your machine
against your own database.

## 1. Install the package

Two ecosystems, one engine. Pick yours; everything after this step is the same
report either way.

```bash
# Stacks. No migration: the package ships no tables and asks your
# application where reports are kept. See /docs/stacks.
bun add @reportshq/stacks
```

```bash
# Laravel
composer require reportshq/laravel
php artisan vendor:publish --tag=reportshq-config
php artisan migrate
```

In Laravel the migration creates the tables the reports themselves live in: the
report, its blocks, its revisions, its share links and its schedules. In Stacks
there is no migration, because the package keeps no tables of its own and asks
the application where reports live instead. Either way your own tables are never
touched, read-only or otherwise altered.

## 2. Describe a model

Name something you already have.

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
    time: {
      placed: 'created_at',
    },
    dimensions: {
      status: 'status',
    },
  },
}
```

```php
// Laravel: config/reportshq.php
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

That is the whole description. A measure says what to add up and how, a
`time` column is what a date range applies to, and every dimension is something
you may group by. Where a relation would multiply rows, saying so is what lets
the compiler refuse a question that would double-count rather than answer it
approximately.

**Only what you name is reachable.** The compiler will not touch a column that
is not in this file, which is why a password hash cannot end up as a dimension
by somebody typing its name into a URL.

## 3. Open the reports

The routes are off until you say otherwise, because the package cannot know
which of your users may see a total of everybody's orders. Turn them on:

```bash
REPORTSHQ_ROUTES=true
```

```bash
php artisan serve
```

Visit `/reports`. It is empty -- nothing creates a report for you, and the page
says as much. Make the first one:

```php
use ReportsHQ\Laravel\Reports\Builder;

// The slug is derived from the name, and kept unique for you.
$report = app(Builder::class)->create('Commerce');
```

Or post the same thing from the page itself, which is what the "New report"
form does.

## 4. Build it

Visit `/reports/commerce/edit`. Drag a block from the palette onto the grid,
pick a measure and a dimension, and it redraws as you change it. Drag a corner
to resize, or nudge with the arrow keys.

There is no data to accumulate and nothing to wait for: a block reads rows that
are already in your database, so the first one you drop covers everything you
have ever sold.

Publish when it looks right. A draft stays yours until you do, so a teammate
never opens a half arranged grid.

## 5. Share it, or send it

A published report can be given a link that works for somebody with no account:

```php
use ReportsHQ\Laravel\Reports\Share;

$share = Share::create([
    'report_id' => $report->id,
    'token' => Share::newToken(),
    'label' => 'For the board',
    'expires_at' => now()->addDays(30),
]);
```

Or emailed on a cadence, from your own queue, in the report's own timezone:

```php
use ReportsHQ\Laravel\Reports\Schedule;

Schedule::create([
    'report_id' => $report->id,
    'cadence' => 'weekly',
    'hour' => 8,
    'recipients' => 'ops@example.com',
    'format' => 'xlsx',
]);
```

Add the runner to `routes/console.php` and the application does the rest:

```php
Schedule::command('reportshq:send')->hourly();
```

It is registered by the package but scheduled by you, on purpose. A package that
adds itself to your scheduler is a package that sends email nobody asked for.

## What next

- [The Stacks package](/docs/stacks) or [the Laravel package](/docs/laravel)
  for the full description format in your own language.
- [The query API](/docs/api) for the JSON the charts read.
- [What a licence covers](/docs/limits), and why none of it gates a report.
