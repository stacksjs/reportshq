<?php

declare(strict_types=1);

return [
    /*
     * The project's ingest key. With this unset the package registers nothing
     * and sends nothing, so the same code runs in tests and on a laptop
     * without either sending analytics or complaining about it.
     */
    'key' => env('REPORTSHQ_KEY', ''),

    /*
     * Where events go. Override for a self-hosted install.
     */
    'endpoint' => env('REPORTSHQ_ENDPOINT', 'https://reportshq.org/ingest'),

    /*
     * Which families of events to forward. Turning one off means its listeners
     * are never registered at all, rather than registered and ignored.
     */
    'domains' => [
        'commerce' => env('REPORTSHQ_COMMERCE', true),
        'users' => env('REPORTSHQ_USERS', true),
        'cms' => env('REPORTSHQ_CMS', true),
    ],

    /*
     * The fraction of *subjects* to keep, 0 to 1.
     *
     * Not a fraction of events: a subject is hashed, so somebody is either
     * wholly in the sample or wholly out and funnels stay coherent. Your
     * totals are then a sample of reality and are not scaled up.
     */
    'sample_rate' => (float) env('REPORTSHQ_SAMPLE_RATE', 1.0),

    /*
     * Delivery happens after the response has been sent. Naming a queue moves
     * it off the web process entirely, which is what a busy application wants;
     * leaving it null uses Laravel's terminating callback, which needs no
     * worker.
     */
    'queue' => env('REPORTSHQ_QUEUE'),

    'batch_size' => (int) env('REPORTSHQ_BATCH_SIZE', 50),
    'max_buffer_size' => (int) env('REPORTSHQ_MAX_BUFFER', 10000),
    'max_retries' => (int) env('REPORTSHQ_MAX_RETRIES', 3),
    'retry_base_ms' => (int) env('REPORTSHQ_RETRY_BASE_MS', 500),
];
