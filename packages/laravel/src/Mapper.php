<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

/**
 * Laravel events, translated into the ReportsHQ taxonomy.
 *
 * Deliberately plain PHP with no Illuminate dependency. The translation is the
 * part most likely to be wrong and the part that must agree, byte for byte,
 * with the Stacks SDK; keeping it free of the framework means it can be tested
 * without booting an application, and the cross-SDK fixture suite can run it
 * directly.
 *
 * The mapping table mirrors `packages/stacks/src/mappers.ts`. Both are checked
 * against `docs/fixtures/sdk-events.json`, which is what actually stops them
 * drifting: two implementations agreeing today is not the same as two
 * implementations that cannot silently disagree tomorrow.
 *
 * **Extend `docs/events.md` before adding a name here.** That doc is what the
 * report templates, the app's validation and the builder's labels are written
 * against, and a name in one place and not the others is a report that is
 * quietly always empty.
 */
final class Mapper
{
    /**
     * Every event this package understands.
     *
     * Keyed by the name the listener dispatches. Model observers use
     * `Model:action` (`Order:created`); Laravel's own auth events use their
     * class short name (`Registered`, `Login`), since those are what an
     * application already fires without writing anything.
     *
     * @var array<string, array{domain: string, to: string, value?: string[], properties?: array<string, string[]>, propertyTypes?: array<string, string>}>
     */
    public const MAPPINGS = [
        'Order:created' => [
            'domain' => 'commerce',
            'to' => 'commerce.order.created',
            'value' => ['total', 'total_amount', 'value'],
            'properties' => [
                'order_id' => ['id', 'uuid'],
                'items' => ['item_count', 'items'],
                'status' => ['status'],
            ],
            'propertyTypes' => ['items' => 'number'],
        ],
        'Order:paid' => [
            'domain' => 'commerce',
            'to' => 'commerce.order.paid',
            'value' => ['total', 'total_amount', 'value'],
            'properties' => [
                'order_id' => ['id', 'uuid'],
                'method' => ['payment_method', 'method'],
            ],
        ],
        'Order:refunded' => [
            'domain' => 'commerce',
            'to' => 'commerce.order.refunded',
            'value' => ['refunded_amount', 'total', 'value'],
            'properties' => [
                'order_id' => ['id', 'uuid'],
                'reason' => ['reason'],
            ],
        ],
        'Order:cancelled' => [
            'domain' => 'commerce',
            'to' => 'commerce.order.cancelled',
            'properties' => ['order_id' => ['id', 'uuid']],
        ],
        'Checkout:started' => [
            'domain' => 'commerce',
            'to' => 'commerce.checkout.started',
            'value' => ['total', 'value'],
        ],
        'Cart:updated' => [
            'domain' => 'commerce',
            'to' => 'commerce.cart.updated',
            'properties' => ['items' => ['item_count', 'items']],
            'propertyTypes' => ['items' => 'number'],
        ],
        'Product:viewed' => [
            'domain' => 'commerce',
            'to' => 'commerce.product.viewed',
            'properties' => ['sku' => ['sku', 'id']],
        ],
        'Customer:created' => [
            'domain' => 'commerce',
            'to' => 'commerce.customer.created',
        ],

        'Registered' => [
            'domain' => 'users',
            'to' => 'user.registered',
            'properties' => [
                'plan' => ['plan'],
                'source' => ['source', 'referrer'],
            ],
        ],
        'Login' => [
            'domain' => 'users',
            'to' => 'user.login',
        ],
        'Logout' => [
            'domain' => 'users',
            'to' => 'user.logout',
        ],
        'User:deleted' => [
            'domain' => 'users',
            'to' => 'user.deleted',
        ],
        'User:invited' => [
            'domain' => 'users',
            'to' => 'user.invited',
            'properties' => ['invited_by' => ['invited_by']],
        ],
        'Subscription:created' => [
            'domain' => 'users',
            'to' => 'user.subscription.started',
            'value' => ['amount', 'price', 'value'],
            'properties' => [
                'plan' => ['plan', 'plan_name'],
                'interval' => ['interval'],
            ],
        ],
        'Subscription:cancelled' => [
            'domain' => 'users',
            'to' => 'user.subscription.cancelled',
            'properties' => [
                'plan' => ['plan', 'plan_name'],
                'reason' => ['reason'],
            ],
        ],

        'Post:published' => [
            'domain' => 'cms',
            'to' => 'cms.post.published',
            'properties' => [
                'post_id' => ['id', 'uuid'],
                'author' => ['author', 'author_id'],
                'category' => ['category'],
            ],
        ],
        'Post:viewed' => [
            'domain' => 'cms',
            'to' => 'cms.post.viewed',
            'properties' => ['post_id' => ['id', 'uuid']],
        ],
        'Comment:created' => [
            'domain' => 'cms',
            'to' => 'cms.comment.created',
            'properties' => ['post_id' => ['post_id', 'commentable_id']],
        ],
    ];

    /**
     * Translate one event, or null when it is not one we map.
     *
     * Returning null rather than inventing a name is the point: an application
     * fires dozens of events that mean nothing to a reporting taxonomy, and
     * forwarding them under made-up names fills a project with vocabulary no
     * report template can read.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, bool>  $domains
     * @return array<string, mixed>|null
     */
    public static function map(string $event, array $payload, array $domains): ?array
    {
        $mapping = self::MAPPINGS[$event] ?? null;

        if ($mapping === null || ($domains[$mapping['domain']] ?? false) !== true) {
            return null;
        }

        $mapped = ['name' => $mapping['to']];

        $value = isset($mapping['value']) ? self::firstNumber($payload, $mapping['value']) : null;

        if ($value !== null) {
            $mapped['value'] = $value;

            // Only where there is a value to denominate. A currency on a login
            // is noise a filter will eventually be written against.
            $currency = self::firstString($payload, ['currency']);
            if ($currency !== null) {
                $mapped['currency'] = strtoupper($currency);
            }
        }

        $userKey = self::firstString($payload, ['user_key', 'user_id', 'customer_id']);
        if ($userKey !== null) {
            $mapped['user_key'] = $userKey;
        }

        $sessionKey = self::firstString($payload, ['session_key', 'session_id']);
        if ($sessionKey !== null) {
            $mapped['session_key'] = $sessionKey;
        }

        $properties = [];
        foreach ($mapping['properties'] ?? [] as $name => $sources) {
            $wantsNumber = ($mapping['propertyTypes'][$name] ?? 'string') === 'number';

            $found = $wantsNumber
                ? self::firstNumber($payload, $sources)
                : self::firstString($payload, $sources);

            if ($found !== null) {
                $properties[$name] = $found;
            }
        }

        if ($properties !== []) {
            $mapped['properties'] = $properties;
        }

        $occurredAt = self::firstString($payload, ['created_at', 'occurred_at']);
        if ($occurredAt !== null) {
            $mapped['occurred_at'] = $occurredAt;
        }

        return $mapped;
    }

    /** The event names this package listens for, given the enabled domains.
     *
     * @param  array<string, bool>  $domains
     * @return string[]
     */
    public static function names(array $domains): array
    {
        $names = [];

        foreach (self::MAPPINGS as $event => $mapping) {
            if (($domains[$mapping['domain']] ?? false) === true) {
                $names[] = $event;
            }
        }

        return $names;
    }

    /**
     * The first of these keys holding something that reads as a number.
     *
     * @param  array<string, mixed>  $payload
     * @param  string[]  $keys
     */
    private static function firstNumber(array $payload, array $keys): int|float|null
    {
        foreach ($keys as $key) {
            $value = self::scalarise($payload[$key] ?? null);

            if (is_int($value) || is_float($value)) {
                return $value;
            }

            if (is_string($value) && is_numeric($value)) {
                // Kept as an int when it is one, so a total of 4250 does not
                // arrive as 4250.0 and fail a byte-comparison against the
                // other SDK.
                return str_contains($value, '.') ? (float) $value : (int) $value;
            }
        }

        return null;
    }

    /**
     * The first of these keys holding a non-empty string.
     *
     * Numbers are stringified, because an id is an identifier whichever type
     * the ORM handed it over as, and the two SDKs must agree on which.
     *
     * @param  array<string, mixed>  $payload
     * @param  string[]  $keys
     */
    private static function firstString(array $payload, array $keys): ?string
    {
        foreach ($keys as $key) {
            $value = self::scalarise($payload[$key] ?? null);

            if ($value === null || is_bool($value) || is_array($value)) {
                continue;
            }

            $text = trim((string) $value);

            if ($text !== '') {
                return $text;
            }
        }

        return null;
    }

    /**
     * Whatever an application handed us, reduced to something castable.
     *
     * An application does not necessarily pass `toArray()` output. It may pass
     * `getAttributes()`, or merge a model attribute in by hand, and either of
     * those carries the objects Eloquent casts to: a backed enum for a status,
     * a `DateTimeInterface` for a timestamp, a money or value object for a
     * total. Casting one of those to string is a fatal `Error`, thrown from
     * inside the analytics package, on the request path of somebody else's
     * checkout.
     *
     * That is the one failure mode this package exists to never have. The
     * transport catches throwables from the *sender*, but mapping happens
     * inline in the listener, long before anything is buffered, so nothing was
     * catching this. Unwrap what has an obvious scalar reading and discard the
     * rest: a missing property is a report with a gap in it, and a fatal is an
     * order that did not get placed.
     */
    private static function scalarise(mixed $value): mixed
    {
        if ($value instanceof \BackedEnum) {
            return $value->value;
        }

        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d\TH:i:sP');
        }

        if (is_object($value)) {
            return method_exists($value, '__toString') ? (string) $value : null;
        }

        return $value;
    }
}
