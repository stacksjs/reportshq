# The Laravel package

`reportshq/laravel` puts the reports inside your application. It reads the
models you already have, queries them in place on the connection your
application already holds, and renders through the routes you already guard.

Nothing leaves the application. There is no endpoint to send to, no connection
to hand out, and the licence check is offline.

## Install

```bash
composer require reportshq/laravel
php artisan vendor:publish --tag=reportshq-config
php artisan migrate
```

The migration creates the tables the reports live in: reports, blocks,
revisions, shares and schedules. Your own tables are only ever read.

## Describing a model

```php
// config/reportshq.php
'models' => [
    'order' => [
        'class' => App\Models\Order::class,
        'label' => 'Order',
        'grain' => 'one row per order',
        'dimensions' => [
            'status' => ['label' => 'Status', 'type' => 'string'],
            'placed' => ['label' => 'Placed', 'type' => 'date', 'column' => 'created_at'],
            'shipped' => ['label' => 'Shipped', 'type' => 'date', 'column' => 'shipped_at'],
        ],
        'measures' => [
            'revenue' => ['label' => 'Revenue', 'aggregate' => 'sum', 'column' => 'total_amount'],
            'orders' => ['label' => 'Orders', 'aggregate' => 'count'],
            'average_order' => ['label' => 'Average order', 'aggregate' => 'avg', 'column' => 'total_amount'],
        ],
    ],
],
```

**The description is an allowlist, not a hint.** The compiler will not touch a
column that is not named here, which is why a password hash cannot become a
dimension by somebody typing its name into a URL. Adding a field to a model does
not expose it; adding it to this file does.

`time` is a map because a model usually has more than one meaningful date, and
"orders per day" means something different for placed than for shipped. Naming
them forces the report to say which it meant.

## Measures the compiler will refuse

A measure belongs to the table it is declared on. Summing an order total across
joined line items counts the order once per line, so:

```php
// Refused, and says so on the block.
['model' => 'order', 'measure' => 'revenue', 'dimension' => ['model' => 'product', 'key' => 'name']]

// Correct: the measure belongs to the line, so the join does not multiply it.
['model' => 'order_item', 'measure' => 'line_revenue', 'dimension' => ['model' => 'product', 'key' => 'name']]
```

The refusal reaches the tile with the reason on it. A plausible wrong number is
worse than an empty block, because nobody checks a number that looks right.

## It reads what you declared, not the whole table

A block can only reach the measures and dimensions the description names, so a
column nobody meant to expose is not one click away.

Be aware of what this does *not* do. The compiler builds SQL and the runner
executes it on the application's existing connection, not through Eloquent, so
global scopes and soft deletes do **not** apply on their own. If rows are
excluded by a scope in your application, declare the same condition as a filter
on the model here, or the report will count them. A soft-deleted order is still
a row.

## Timezone

Buckets are computed in the report's timezone, which defaults to the
application's. A daily chart in the wrong zone is wrong by one bucket at both
ends, and nobody notices until a total is quoted next to a different total.

## Where it renders

Standalone pages under `/reports`, behind whatever middleware you configure. A
Filament plugin, if you run one:

```php
->plugin(\ReportsHQ\Laravel\Filament\ReportsHQPlugin::make())
```

It mounts at `admin/reportshq` rather than `admin/reports`, because Filament
resolves a route collision by first registration rather than by complaining: an
application that already has a Reports page would silently keep it and this one
would never appear. Change `reportshq.filament.slug` if the nicer path is free.

Or [the JSON API](/docs/api), for a front end of your own. The charts are the
same compiled components in all three, so they cannot drift.

## Exports, sharing, schedules

CSV and XLSX are generated on demand rather than stored and linked. The numbers
are one query away, so there is nothing to clean up and no way to serve a stale
copy.

Sharing and scheduling are documented in [sharing](/docs/sharing) and
[schedules and exports](/docs/schedules-exports).

## Requirements

PHP 8.2+, Laravel 11+. `stacksjs/php-spreadsheets` is a dependency and is not on
Packagist yet, so your `composer.json` needs its repository entry as well as
this package's: composer reads repositories only from the root package.
