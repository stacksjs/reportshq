<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * Something to group or filter by.
 *
 * The type is not decoration: it decides whether the builder offers a date
 * range or a text match, whether a value is quoted, and whether a column can
 * carry a time grain at all. Getting it from the model's casts rather than
 * from the column name is what keeps `created_at` a date and `order_number` a
 * string even though both end in something that looks like a hint.
 */
final class Dimension
{
    public const TYPES = ['string', 'number', 'date', 'boolean'];

    public function __construct(
        public readonly string $key,
        public readonly string $label,
        public readonly string $model,
        public readonly string $column,
        public readonly string $type = 'string',
    ) {
        if (! in_array($type, self::TYPES, true)) {
            throw new \InvalidArgumentException(
                "Unknown dimension type '{$type}'. Known: ".implode(', ', self::TYPES).'.'
            );
        }
    }

    /** Only a date can be bucketed by day, week or month. */
    public function isTemporal(): bool
    {
        return $this->type === 'date';
    }
}
