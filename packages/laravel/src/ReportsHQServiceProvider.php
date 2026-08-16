<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Auth\Events\Registered;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;

/**
 * Wiring the integration into a Laravel application.
 *
 * This is the only file in the package that knows Laravel exists. The mapper,
 * the transport, the sampler and the config are plain PHP, which is what lets
 * them be tested without booting an application and lets the cross-SDK fixture
 * suite run the mapper directly.
 *
 * Two things happen here and nothing else: listeners are registered for the
 * events Laravel already fires, and delivery is arranged for after the response
 * has gone out.
 */
final class ReportsHQServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/reportshq.php', 'reportshq');

        $this->app->singleton(Config::class, function (Application $app): Config {
            /** @var array<string, mixed> $values */
            $values = $app['config']->get('reportshq', []);

            return Config::fromArray($values);
        });

        $this->app->singleton(Transport::class, fn (Application $app): Transport => new Transport($app->make(Config::class)));

        $this->app->singleton(ReportsHQ::class, fn (Application $app): ReportsHQ => new ReportsHQ(
            $app->make(Config::class),
            $app->make(Transport::class),
        ));
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/reportshq.php' => $this->app->configPath('reportshq.php'),
        ], 'reportshq-config');

        $config = $this->app->make(Config::class);

        // Nothing is registered at all when there is no key. An unconfigured
        // application does not pay for listeners that would discard everything
        // they receive, and nothing appears in a debug dump looking broken.
        if (! $config->enabled()) {
            return;
        }

        $this->listenForAuthEvents($config);
        $this->arrangeDelivery($config);
    }

    /**
     * Laravel's own auth events, which an application already fires without
     * writing anything. This is what makes the quickstart one line.
     */
    private function listenForAuthEvents(Config $config): void
    {
        if (($config->domains['users'] ?? false) !== true) {
            return;
        }

        /** @var Dispatcher $events */
        $events = $this->app->make(Dispatcher::class);
        $reports = fn (): ReportsHQ => $this->app->make(ReportsHQ::class);

        $events->listen(Registered::class, function (Registered $event) use ($reports): void {
            $reports()->handle('Registered', $this->subject($event->user));
        });

        $events->listen(Login::class, function (Login $event) use ($reports): void {
            $reports()->handle('Login', $this->subject($event->user));
        });

        $events->listen(Logout::class, function (Logout $event) use ($reports): void {
            // A logout can arrive with no user, when a session expired rather
            // than somebody choosing to leave.
            if ($event->user !== null) {
                $reports()->handle('Logout', $this->subject($event->user));
            }
        });
    }

    /**
     * The payload for an auth event, with the person named.
     *
     * On these three events the subject *is* the authenticated user, so its own
     * identifier is the `user_key`. Nothing else can supply it: a model's
     * `toArray()` holds `id`, and the mapper reads `user_key`, `user_id` or
     * `customer_id`, none of which an ordinary `User` has. Passing the
     * attributes alone therefore produced `user.registered` and `user.login`
     * events with no subject at all, for every Laravel application, from the
     * one-line integration that is the whole quickstart. They still arrived and
     * still counted, so signups looked right, while unique users and the
     * retention grid quietly stayed empty.
     *
     * `getAuthIdentifier()` is the primary key, which is what a pseudonymous
     * key should be. The email sitting next to it in the same array is never
     * read, and must not be: this is not a table that should accumulate
     * identities.
     *
     * @return array<string, mixed>
     */
    private function subject(mixed $user): array
    {
        $attributes = $this->attributesOf($user);

        if (is_object($user) && method_exists($user, 'getAuthIdentifier')) {
            $identifier = $user->getAuthIdentifier();

            if (is_scalar($identifier) && (string) $identifier !== '') {
                // Only when the application has not already said who this is.
                // A custom user provider may carry its own `user_key`, and its
                // answer is better than ours.
                $attributes['user_key'] ??= (string) $identifier;
            }
        }

        return $attributes;
    }

    /**
     * Deliver after the response, or through the queue.
     *
     * PHP has no long-lived process to flush from, so the buffer would
     * otherwise die with the request. `terminating` runs after the response has
     * been sent to the browser, which means the person is already looking at
     * the page while this happens. Naming a queue moves it off the web process
     * entirely, which is what a busy application should do.
     */
    private function arrangeDelivery(Config $config): void
    {
        $this->app->terminating(function (): void {
            $transport = $this->app->make(Transport::class);

            if ($transport->pending() === 0) {
                return;
            }

            $config = $this->app->make(Config::class);

            if ($config->queue !== null && class_exists(\Illuminate\Support\Facades\Bus::class)) {
                \Illuminate\Support\Facades\Bus::dispatch(
                    (new SendEvents($transport->take()))->onQueue($config->queue),
                );

                return;
            }

            $transport->flush();
        });
    }

    /**
     * The attributes of whatever the event carried.
     *
     * An Eloquent model, an array, or something else entirely: an application
     * may authenticate against anything, and an integration that assumes
     * Eloquent breaks on the ones that do not.
     *
     * @return array<string, mixed>
     */
    private function attributesOf(mixed $subject): array
    {
        if (is_array($subject)) {
            return $subject;
        }

        if (is_object($subject) && method_exists($subject, 'toArray')) {
            /** @var array<string, mixed> */
            return $subject->toArray();
        }

        if (is_object($subject)) {
            return get_object_vars($subject);
        }

        return [];
    }
}
