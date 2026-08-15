# Laravel integration

`reportshq/laravel` sends a Laravel application's own events to ReportsHQ. Your
app keeps firing the events it already fires; the package listens, translates
them into [the taxonomy](/docs/events), and ships them after the response has
gone out.

## Install

```bash
composer require reportshq/laravel
```

```bash
# .env
REPORTSHQ_KEY=rhq_your_project_key
```

That is the whole integration for signups and sign-ins: the package listens to
Laravel's own `Registered`, `Login` and `Logout` events, which your application
already fires without you writing anything.

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

The second argument is the name in the mapping table, so orders living in
`App\Models\Purchase` still map onto `commerce.order.created` without renaming
anything.

## What gets sent

Only the events in [the taxonomy](/docs/events). Anything unmapped is ignored,
because forwarding an application's whole event stream under invented names
fills a project with vocabulary no report template can read.

| Your app fires | ReportsHQ receives |
|---|---|
| `Illuminate\Auth\Events\Registered` | `user.registered` |
| `Illuminate\Auth\Events\Login` / `Logout` | `user.login` / `user.logout` |
| `Order:created` / `:paid` / `:refunded` / `:cancelled` | the matching `commerce.order.*` |
| `Checkout:started`, `Cart:updated`, `Product:viewed` | `commerce.checkout.started`, `commerce.cart.updated`, `commerce.product.viewed` |
| `Customer:created` | `commerce.customer.created` |
| `Subscription:created` / `:cancelled` | `user.subscription.started` / `.cancelled` |
| `Post:published` / `Post:viewed` / `Comment:created` | the matching `cms.*` |

The subject is taken from `user_key` / `user_id` / `customer_id` and
`session_key` / `session_id`. Send a **stable internal id**, never an email or a
name: it is only ever compared for equality, so anything more identifying is
data nobody needed.

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

**With no key set, the package registers nothing**: no listeners, no terminating
callback, no requests. The same code runs in tests and on a laptop without
sending anything or complaining about it.

## Delivery happens after the response

PHP has no long-lived process to flush from, so a buffer would otherwise die
with the request. Events are delivered from Laravel's `terminating` callback,
which runs after the response has already been sent to the browser: the person
is looking at the page while this happens.

Naming a `queue` moves delivery off the web process entirely, which is what a
busy application should do. The batch travels as plain arrays rather than as
models, so what gets queued is exactly what gets sent and cannot change between
the two.

## It cannot slow your app down

- `track` appends to an in-memory buffer and returns.
- The buffer is bounded. At the limit the **oldest** events are dropped, because
  if delivery has been failing, the recent events are the ones describing what
  is happening now.
- Failures never throw into your code. A sender that raises is caught, reported
  through `on_error`, and treated as a failed attempt.
- `5xx` and `429` retry with backoff. `4xx` does not: a bad key is bad every
  time, and retrying is a slower way to fail while blocking everything behind
  it.
- The queued job does not retry on top of that. Two retry policies multiply out
  to a lot of requests to an endpoint that has already said no.

## Sampling keeps subjects whole

`sample_rate` keeps a fraction of **subjects**, not of events. Sampling events
independently is the obvious implementation and it quietly ruins the reports it
feeds: a funnel asks how many people who viewed a product went on to check out,
and if each of those events is kept by its own coin flip, the steps stop
belonging to the same people and every conversion rate becomes noise.

Subjects are hashed with the same FNV-1a the Stacks SDK uses, so the two agree
about who is in a sample, and an application migrating between them keeps a
continuous history rather than a step change at the switchover.

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

`docs/fixtures/sdk-events.json` states, for each logical event, the one taxonomy
payload every SDK must produce. This package asserts it from PHP and the Stacks
package asserts it from TypeScript. Without that fixture the two drift, and the
drift is invisible until somebody compares a Laravel application's reports with
a Stacks application's.

## Tests

```bash
php packages/laravel/tests/run.php
```

A plain runner rather than phpunit, and deliberately: the mapper, sampler,
config and transport are plain PHP with no Illuminate dependency, which is what
lets them be tested without booting an application. Running them needs `php` and
nothing else: no composer install, no vendor directory, no network. The service
provider's listener registration genuinely needs a booted application and is not
covered there.

## See also

- [Stacks integration](/docs/stacks), which sends the identical payload
- [Ingestion API](/docs/ingest) for anything that speaks HTTP
- [Event taxonomy](/docs/events)
