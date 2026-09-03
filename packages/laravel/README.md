# reportshq/laravel

Two independent halves, and an application may use either, both or neither.

**Reports** run inside your own application, against your own database. Nothing leaves the machine: the query engine compiles a block to SQL, the charts are compiled components rendered in the reader's browser, and the licence is checked offline. This half needs no key, no account and no network.

**Events** translate the events your app already fires into the reserved taxonomy and ship them to a collector. This half needs somewhere to send them.

> **The hosted collector is not currently accepting events.** `https://reportshq.org/ingest` used to be the default destination and no longer answers. The event half therefore stays switched off unless you set `REPORTSHQ_ENDPOINT` to a collector you run. Until then a key alone registers nothing, which is deliberate: the previous default meant one queued job per login posting into a 404, reported through `onError` inside a queued job where an application without a failed-job handler never saw it. The reports half is unaffected and needs none of this.

## Install

```bash
composer require reportshq/laravel
```

For reports, nothing else is required — see [Reports](#reports) below, which run entirely inside your application.

For events, both variables are needed:

```bash
# .env
REPORTSHQ_KEY=rhq_your_project_key
REPORTSHQ_ENDPOINT=https://collector.example.com/ingest
```

With those set, that is the whole integration for signups and sign-ins: the package listens to Laravel's own `Registered`, `Login` and `Logout` events, which your application already fires without writing anything.

For your own models, name them once:

```php
// app/Providers/AppServiceProvider.php
use App\Models\Order;
use ReportsHQ\Laravel\ReportsHQ;

public function boot(): void
{
    app(ReportsHQ::class)->observe(Order::class, 'Order');
}
```

The second argument is the name in the mapping table, so orders living in `App\Models\Purchase` still map onto `commerce.order.created` without renaming anything.

## Reports

Reports read your application's own database, in process. No key, no account and no network.

Name the tables you are willing to report on:

```php
// config/reportshq.php
'models' => [
    'order' => [
        'class' => App\Models\Order::class,
        'label' => 'Order',
        'grain' => 'one row per order',
        'dimensions' => ['status' => ['label' => 'Status', 'type' => 'string']],
        'measures' => [
            'revenue' => ['label' => 'Revenue', 'aggregate' => 'sum', 'column' => 'total_amount'],
        ],
    ],
],
```

Nothing is reportable until it is listed. A report is a `SELECT` with a drag handle on it, so the package asks you to say what may be exposed rather than discovering that everything already is.

`php artisan reportshq:discover` writes a draft of that block from your Eloquent models, leaving out anything that looks sensitive. Treat it as a starting point: it can see that a column is an integer, not that the integer is cents, nor which of two foreign keys is the customer.

Then pick a surface. All three are off until asked for:

| Surface | Switch it on with |
|---|---|
| Filament plugin | register the plugin; the panel slug defaults to `reportshq` |
| Standalone pages | `REPORTSHQ_ROUTES=true`, and set `routes.middleware` to your own authorisation |
| Query engine only | resolve `ReportsHQ\Laravel\Reports\Runner` and use it directly |

The routes stay off by default because a package that mounts pages unasked publishes something you find out about from a security review. When you do switch them on, `routes.middleware` is where you say who may read a total of everybody's orders — the package cannot know, so it does not guess.

`REPORTSHQ_LICENSE` is checked offline and never sent anywhere. It gates nothing: an unlicensed application reports on its own data exactly as a licensed one does, and the pages say they are unlicensed. A reporting tool that blanks a dashboard over a billing state is one nobody can rely on for the dashboard.

## What gets sent

Only the events in [the taxonomy](https://github.com/stacksjs/reportshq/blob/main/docs/events.md). An application fires dozens of events that mean nothing to a reporting taxonomy, and forwarding them under invented names would fill your project with vocabulary no report template can read, so anything unmapped is ignored.

| Your app fires | ReportsHQ receives |
|---|---|
| `Illuminate\Auth\Events\Registered` | `user.registered` |
| `Illuminate\Auth\Events\Login` / `Logout` | `user.login` / `user.logout` |
| `Order:created` / `:paid` / `:refunded` / `:cancelled` | the matching `commerce.order.*` |
| `Checkout:started`, `Cart:updated`, `Product:viewed` | `commerce.checkout.started`, `commerce.cart.updated`, `commerce.product.viewed` |
| `Customer:created` | `commerce.customer.created` |
| `Subscription:created` / `:cancelled` | `user.subscription.started` / `.cancelled` |
| `Post:published` / `Post:viewed` / `Comment:created` | the matching `cms.*` |

The subject is taken from `user_key` / `user_id` / `customer_id` and `session_key` / `session_id`. Send a **stable internal id**, never an email or a name: it is only ever compared for equality, so anything more identifying is data nobody needed.

## Configuration

```bash
php artisan vendor:publish --tag=reportshq-config
```

```php
// config/reportshq.php
return [
    'key' => env('REPORTSHQ_KEY', ''),
    'endpoint' => env('REPORTSHQ_ENDPOINT', 'https://reportshq.org/ingest'),
    'domains' => ['commerce' => true, 'users' => true, 'cms' => true],
    'sample_rate' => 1.0,
    'queue' => env('REPORTSHQ_QUEUE'),
];
```

**With no key set, the package registers nothing**: no listeners, no terminating callback, no requests. The same code runs in tests and on a laptop without sending anything or complaining about it.

## Delivery happens after the response

PHP has no long-lived process to flush from, so a buffer would otherwise die with the request. Events are delivered from Laravel's `terminating` callback, which runs after the response has already been sent to the browser: the person is looking at the page while this happens.

Naming a `queue` moves delivery off the web process entirely, which is what a busy application should do. The batch travels as plain arrays rather than as models, so what gets queued is exactly what gets sent and cannot change between the two.

## It cannot slow your app down

- `track` appends to an in-memory buffer and returns.
- The buffer is bounded. At the limit the **oldest** events are dropped, because if delivery has been failing, the recent events are the ones describing what is happening now.
- Failures never throw into your code. A sender that raises is caught, reported through `on_error`, and treated as a failed attempt.
- `5xx` and `429` retry with backoff. `4xx` does not: a bad key is bad every time, and retrying is a slower way to fail while blocking everything behind it.
- The queued job does not retry on top of that. Two retry policies multiply out to a lot of requests to an endpoint that has already said no.

## Sampling keeps subjects whole

`sample_rate` keeps a fraction of **subjects**, not of events. Sampling events independently is the obvious implementation and it quietly ruins the reports it feeds: a funnel asks how many people who viewed a product went on to check out, and if each of those events is kept by its own coin flip, the steps stop belonging to the same people and every conversion rate becomes noise.

Subjects are hashed with the same FNV-1a the Stacks SDK uses, so the two agree about who is in a sample and an application migrating between them keeps a continuous history rather than a step change at the switchover.

## Sending your own events

```php
app(ReportsHQ::class)->track([
    'name' => 'commerce.order.created',
    'value' => 4250,
    'currency' => 'USD',
    'user_key' => (string) $customer->id,
    'properties' => ['plan' => 'pro'],
]);
```

## Both SDKs produce the same payloads

`docs/fixtures/sdk-events.json` in the main repository states, for each logical event, the one taxonomy payload every SDK must produce. This package asserts it from PHP and the Stacks package asserts it from TypeScript. Without it the two drift, and the drift is invisible until somebody compares a Laravel app's reports with a Stacks app's.

## Tests

```bash
php packages/laravel/tests/run.php
```

A plain runner rather than phpunit, and deliberately: the mapper, sampler, config and transport are plain PHP with no Illuminate dependency, which is what lets them be tested without booting an application. Running them needs `php` and nothing else - no composer install, no vendor directory, no network. The service provider's listener registration genuinely needs a booted application and is not covered here.

## License

MIT
