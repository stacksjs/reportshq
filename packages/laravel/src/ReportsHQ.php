<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

use Illuminate\Database\Eloquent\Model;

/**
 * The application-facing entry point.
 *
 * Deliberately small. An application needs three things: to register an
 * observer on one of its own models, to send an event the mappers do not cover,
 * and, occasionally, to force a flush. Everything else is the service
 * provider's business.
 */
final class ReportsHQ
{
    public function __construct(
        private Config $config,
        private Transport $transport,
    ) {}

    /**
     * Translate and queue an event by its mapped name.
     *
     * @param  array<string, mixed>  $payload
     */
    public function handle(string $event, array $payload = []): void
    {
        $mapped = Mapper::map($event, $payload, $this->config->domains);

        if ($mapped !== null) {
            $this->transport->track($mapped);
        }
    }

    /**
     * Queue an event already in taxonomy form.
     *
     * For anything the mappers do not cover. Use a documented name where one
     * fits: a custom name is stored and queryable, but no report template is
     * written against it, so nothing will build itself from it.
     *
     * @param  array<string, mixed>  $event
     */
    public function track(array $event): void
    {
        $this->transport->track($event);
    }

    /**
     * Watch one of the application's own models.
     *
     * ```php
     * ReportsHQ::observe(Order::class, 'Order');
     * ```
     *
     * The second argument is the name in the mapping table, so an application
     * whose orders live in `App\Models\Purchase` can still map them onto
     * `commerce.order.created` without renaming anything.
     *
     * @param  class-string  $model
     * @param  string[]  $events
     */
    public function observe(string $model, string $as, array $events = ['created']): void
    {
        if (! method_exists($model, 'observe') && ! class_exists(Model::class)) {
            return;
        }

        foreach ($events as $action) {
            $name = "{$as}:{$action}";

            // Eloquent's static event registration, used rather than an
            // observer class so an application does not need a file per model.
            $model::{$action}(function ($instance) use ($name): void {
                $this->handle($name, is_object($instance) && method_exists($instance, 'toArray')
                    ? $instance->toArray()
                    : (array) $instance);
            });
        }
    }

    /** Deliver everything buffered. Returns how many events went. */
    public function flush(): int
    {
        return $this->transport->flush();
    }

    public function transport(): Transport
    {
        return $this->transport;
    }

    public function config(): Config
    {
        return $this->config;
    }
}
