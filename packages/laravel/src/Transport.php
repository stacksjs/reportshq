<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

/**
 * Getting events out of the application and into ReportsHQ.
 *
 * One rule governs every decision here: **the host application must never be
 * slower, or less available, because of analytics.** Nothing on the request
 * path waits for our HTTP call, nothing grows without a bound, and nothing
 * throws into somebody else's controller. A dropped event is a bad outcome; a
 * checkout page hanging on our endpoint is a catastrophic one, and the two are
 * not close enough to weigh carefully.
 *
 * PHP has no long-lived process to flush from, which is the real difference
 * from the Stacks SDK. A request ends and the buffer dies with it, so delivery
 * happens either on Laravel's `terminating` callback (after the response has
 * been sent to the browser, so the person is already looking at the page) or
 * through the queue when one is configured.
 *
 * The sender is injected. That keeps this class free of Illuminate and lets the
 * tests assert what would go over the wire without one.
 */
final class Transport
{
    /** @var array<int, array<string, mixed>> */
    private array $buffer = [];

    private bool $stopped = false;

    /** @var array{queued: int, sent: int, dropped: int, failed: int} */
    public array $stats = ['queued' => 0, 'sent' => 0, 'dropped' => 0, 'failed' => 0];

    /** @var callable(string, string, array<string, mixed>): int */
    private $sender;

    public function __construct(
        private Config $config,
        ?callable $sender = null,
    ) {
        // Defaults to the built-in sender so an application gets working
        // delivery without wiring anything; tests pass their own.
        $this->sender = $sender ?? Sender::default();
    }

    /**
     * Accept an event.
     *
     * Appends to an array and returns. Everything that can fail happens later.
     *
     * @param  array<string, mixed>  $event
     */
    public function track(array $event): void
    {
        if ($this->stopped || ! $this->config->enabled()) {
            return;
        }

        if (! Sampler::keep($event, $this->config->sampleRate)) {
            $this->stats['dropped']++;

            return;
        }

        if (count($this->buffer) >= $this->config->maxBufferSize) {
            // The oldest goes, not the newest. If delivery has been failing,
            // the recent events are the ones describing what is happening now.
            array_shift($this->buffer);
            $this->stats['dropped']++;
        }

        if (! isset($event['occurred_at'])) {
            $event['occurred_at'] = gmdate('Y-m-d\TH:i:s\Z');
        }

        $this->buffer[] = $event;
        $this->stats['queued']++;
    }

    /**
     * Send everything buffered.
     *
     * Called from `terminating`, from the queued job, or directly in a console
     * command. Returns the number of events delivered, so a caller that wants
     * to log something has a number to log.
     */
    public function flush(): int
    {
        if ($this->buffer === []) {
            return 0;
        }

        // Taken before the first attempt, so an event arriving mid-flush
        // belongs to the next batch rather than being sent twice.
        $batch = $this->buffer;
        $this->buffer = [];

        $delivered = 0;

        foreach (array_chunk($batch, $this->config->batchSize) as $chunk) {
            if ($this->deliver($chunk)) {
                $this->stats['sent'] += count($chunk);
                $delivered += count($chunk);
            } else {
                $this->stats['failed'] += count($chunk);
            }
        }

        return $delivered;
    }

    /** @param array<int, array<string, mixed>> $chunk */
    private function deliver(array $chunk): bool
    {
        $body = ['events' => $chunk];

        for ($attempt = 1; $attempt <= $this->config->maxRetries; $attempt++) {
            $status = 0;

            try {
                $status = ($this->sender)($this->config->endpoint, $this->config->key, $body);
            } catch (\Throwable $error) {
                // Never rethrown. A failure to deliver analytics is not the
                // host application's problem to handle.
                ($this->config->onError)($error->getMessage());
                $status = 0;
            }

            if ($status >= 200 && $status < 300) {
                return true;
            }

            // 4xx means this batch is wrong and will be wrong every time: a bad
            // key, or events the server refuses. Retrying is a slower way to
            // fail. 429 is the exception, since it means later, not no.
            if ($status >= 400 && $status < 500 && $status !== 429) {
                ($this->config->onError)("ReportsHQ refused a batch: {$status}");

                return false;
            }

            if ($attempt < $this->config->maxRetries) {
                usleep($this->config->retryBaseMs * 1000 * (2 ** ($attempt - 1)));
            }
        }

        ($this->config->onError)('ReportsHQ did not accept a batch after '.$this->config->maxRetries.' attempts');

        return false;
    }

    /** Events waiting to be sent. */
    public function pending(): int
    {
        return count($this->buffer);
    }

    /** The buffered events, for the queued job to carry. */
    public function take(): array
    {
        $batch = $this->buffer;
        $this->buffer = [];

        return $batch;
    }

    /** Stop accepting events. Used when a process is shutting down. */
    public function stop(): void
    {
        $this->stopped = true;
    }
}
