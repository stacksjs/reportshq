<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Query;

/**
 * What one block is asking for.
 *
 * Names rather than objects, so a stored report is a row of JSON that survives
 * the registry changing underneath it. Resolving those names against the
 * registry is the compiler's first job, and a name that no longer exists is a
 * block that says so rather than a query that quietly drops a condition.
 */
final class Query
{
    /**
     * @param  string  $measureModel  The grain everything else is checked against.
     * @param  array{model: string, key: string}|null  $dimension  What to split by.
     * @param  array{model: string, key: string}|null  $time  The column a range and a grain apply to.
     * @param  list<Filter>  $filters
     */
    public function __construct(
        public readonly string $measureModel,
        public readonly string $measure,
        public readonly ?array $dimension = null,
        public readonly ?array $time = null,
        public readonly ?string $grain = null,
        public readonly ?string $from = null,
        public readonly ?string $to = null,
        public readonly array $filters = [],
        public readonly int $limit = 0,
        public readonly string $timezone = 'UTC',
    ) {
        if ($grain !== null && $time === null) {
            throw new \InvalidArgumentException('A grain needs a time dimension to apply to.');
        }

        if (($from !== null || $to !== null) && $time === null) {
            throw new \InvalidArgumentException('A range needs a time dimension to apply to.');
        }
    }
}
