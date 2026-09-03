<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

/**
 * How the integration is configured.
 *
 * Plain PHP, so the transport and the mapper can be exercised without booting
 * an application. The service provider builds one of these from
 * `config/reportshq.php`; everything has a default that is safe in production,
 * because the common case is somebody setting one environment variable and
 * never opening the config file.
 */
final class Config
{
    /**
     * @param  array<string, bool>  $domains
     * @param  callable(string): void|null  $onError
     */
    public function __construct(
        public string $key = '',
        public string $endpoint = '',
        public array $domains = ['commerce' => true, 'users' => true, 'cms' => true],
        public float $sampleRate = 1.0,
        public int $batchSize = 50,
        public int $maxBufferSize = 10000,
        public int $maxRetries = 3,
        public int $retryBaseMs = 500,
        public ?string $queue = null,
        public mixed $onError = null,
    ) {
        $this->sampleRate = max(0.0, min(1.0, $this->sampleRate));
        // At least one, or array_chunk() is handed a zero and throws.
        $this->batchSize = max(1, $this->batchSize);
        $this->maxBufferSize = max(1, $this->maxBufferSize);
        $this->maxRetries = max(1, min(10, $this->maxRetries));
        $this->retryBaseMs = max(0, $this->retryBaseMs);
        $this->onError = $this->onError ?? static fn (string $message) => null;
    }

    /**
     * Build from an array, as the service provider does from Laravel's config.
     *
     * @param  array<string, mixed>  $values
     */
    public static function fromArray(array $values): self
    {
        $domains = is_array($values['domains'] ?? null) ? $values['domains'] : [];

        return new self(
            key: (string) ($values['key'] ?? ''),
            endpoint: (string) ($values['endpoint'] ?? ''),
            domains: [
                'commerce' => (bool) ($domains['commerce'] ?? true),
                'users' => (bool) ($domains['users'] ?? true),
                'cms' => (bool) ($domains['cms'] ?? true),
            ],
            sampleRate: (float) ($values['sample_rate'] ?? 1.0),
            batchSize: (int) ($values['batch_size'] ?? 50),
            maxBufferSize: (int) ($values['max_buffer_size'] ?? 10000),
            maxRetries: (int) ($values['max_retries'] ?? 3),
            retryBaseMs: (int) ($values['retry_base_ms'] ?? 500),
            queue: isset($values['queue']) && $values['queue'] !== '' ? (string) $values['queue'] : null,
            onError: is_callable($values['on_error'] ?? null) ? $values['on_error'] : null,
        );
    }

    /**
     * Whether this configuration can send anything at all.
     *
     * A rate of zero counts as off, like an absent key: there is equally
     * nothing to do, and neither should cost the application anything.
     *
     * An endpoint is required for the same reason, and it used to default to
     * the hosted collector at reportshq.org. That endpoint no longer answers,
     * so the default became a way to queue a job per login that posts into a
     * 404 and reports nothing: `onError` fires inside a queued job, where an
     * application that never configured a failed-job handler never sees it.
     * An unset endpoint now switches the event side off exactly as an unset
     * key does. Set it explicitly to send anywhere.
     */
    public function enabled(): bool
    {
        return $this->key !== '' && $this->endpoint !== '' && $this->sampleRate > 0;
    }
}
