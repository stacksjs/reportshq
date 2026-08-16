<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Delivering a batch on the queue.
 *
 * The batch travels as plain arrays rather than as models, so the job body is
 * exactly what will be sent and cannot change between being queued and being
 * run. A job that re-derived its payload from a model would send whatever the
 * model looks like when the worker gets to it, which is not what happened.
 *
 * Failures do not retry at the job level. The transport already retries with
 * backoff and distinguishes a refusal from an outage; a second retry policy on
 * top would multiply out to a lot of requests to an endpoint that has already
 * said no.
 */
final class SendEvents implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 1;

    /** @param array<int, array<string, mixed>> $events */
    public function __construct(private array $events) {}

    public function handle(Config $config): void
    {
        if ($this->events === []) {
            return;
        }

        $transport = new Transport($config);

        foreach ($this->events as $event) {
            $transport->track($event);
        }

        $transport->flush();
    }
}
