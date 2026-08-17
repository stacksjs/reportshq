# Quickstart

Empty application to first report, in about five minutes. Nothing here talks to
a service, because there is not one: everything below runs on your machine
against your own database.

## 1. Install the package

```bash
composer require reportshq/laravel
php artisan vendor:publish --tag=reportshq-config
php artisan migrate
```

The migration creates the tables the reports themselves live in: the report, its
blocks, its revisions, its share links and its schedules. Your own tables are
never touched, read-only or otherwise altered.

## 2. Describe a model

Open `config/reportshq.php` and name something you already have.

```php
'models' => [
    'order' => [
        'model' => App\Models\Order::class,
        'measures' => [
            'revenue' => 'sum:total_amount',
            'orders' => 'count',
        ],
        'time' => [
            'placed' => 'created_at',
        ],
        'dimensions' => [
            'status' => 'status',
        ],
    ],
],
```

That is the whole description. A measure says what to add up, a time key says
which column a date range applies to, and a dimension says what you may group
by.

**Only what you name is reachable.** The compiler will not touch a column that
is not in this file, which is why a password hash cannot end up as a dimension
by somebody typing its name into a URL.

## 3. Open the reports

```bash
php artisan serve
```

Visit `/reports`. The Commerce report is already there with real numbers in it,
because everything it needed was in the description above, and your orders were
already in the database. There is nothing to wait for and no data to accumulate:
the first report covers everything you have ever sold.

## 4. Build one of your own

Visit `/reports/commerce/edit`. Drag a block from the palette onto the grid,
pick a measure and a dimension, and it redraws as you change it. Drag a corner
to resize, or nudge with the arrow keys.

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

- [The Laravel package](/docs/laravel) for the full description format.
- [The query API](/docs/api) for the JSON the charts read.
- [What a licence covers](/docs/limits), and why none of it gates a report.
