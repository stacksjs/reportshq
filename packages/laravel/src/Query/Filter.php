<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Query;

/**
 * One condition on a dimension.
 *
 * The same eight operators the events engine shipped, deliberately: reports
 * written against one have to keep meaning the same thing against the other,
 * and an operator that exists in only one of them is a report that cannot move.
 */
final class Filter
{
    public const OPERATORS = ['is', 'is_not', 'contains', 'starts_with', 'gt', 'lt', 'exists', 'not_exists'];

    /** Operators that carry no value, because the test is presence. */
    public const VALUELESS = ['exists', 'not_exists'];

    public function __construct(
        public readonly string $model,
        public readonly string $dimension,
        public readonly string $operator,
        public readonly string|int|float|bool|null $value = null,
    ) {
        if (! in_array($operator, self::OPERATORS, true)) {
            throw new \InvalidArgumentException(
                "Unknown operator '{$operator}'. Known: ".implode(', ', self::OPERATORS).'.'
            );
        }

        // A `is` with no value is not "match anything", it is a filter somebody
        // half filled in, and answering it would quietly widen their report.
        if (! in_array($operator, self::VALUELESS, true) && $value === null) {
            throw new \InvalidArgumentException("Operator '{$operator}' needs a value.");
        }
    }

    public function isValueless(): bool
    {
        return in_array($this->operator, self::VALUELESS, true);
    }
}
