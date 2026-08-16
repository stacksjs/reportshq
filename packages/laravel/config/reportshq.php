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

    /*
     * The models the report builder may query.
     *
     * Empty means nothing is queryable, which is the right default: a builder
     * is a SELECT with a drag handle on it, and an application should say what
     * it is willing to expose rather than discover it has exposed everything.
     *
     * `php artisan reportshq:discover` writes a draft of this from your own
     * Eloquent models, with every sensitive looking column already left out.
     * The draft is a starting point and not an answer: it can see that a column
     * is an integer and it cannot see that the integer is cents, or that one
     * of two foreign keys is the customer and the other is the login.
     *
     * Each entry is:
     *
     *   'order' => [
     *       'class' => App\Models\Order::class,
     *       'label' => 'Order',
     *       'grain' => 'one row per order',
     *       'dimensions' => ['status' => ['label' => 'Status', 'type' => 'string']],
     *       'measures' => [
     *           'revenue' => ['label' => 'Revenue', 'aggregate' => 'sum', 'column' => 'total_amount'],
     *       ],
     *       'relations' => ['member' => ['model' => 'member', 'cardinality' => 'one', ...]],
     *   ],
     */
    'models' => [],

    /*
     * Which connection reports are read from.
     *
     * Null means the application's default. Naming a read replica here is the
     * answer to the one operational objection to embedded reporting: an
     * analytical query scanning orders on every page load is competing with the
     * transaction that pays for the company.
     */
    'connection' => env('REPORTSHQ_CONNECTION'),

    'batch_size' => (int) env('REPORTSHQ_BATCH_SIZE', 50),
    'max_buffer_size' => (int) env('REPORTSHQ_MAX_BUFFER', 10000),
    'max_retries' => (int) env('REPORTSHQ_MAX_RETRIES', 3),
    'retry_base_ms' => (int) env('REPORTSHQ_RETRY_BASE_MS', 500),
];
