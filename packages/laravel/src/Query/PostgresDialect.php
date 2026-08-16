<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Query;

/**
 * Postgres, which has `date_trunc` and means it.
 *
 * The offset is applied as an interval rather than through `AT TIME ZONE`,
 * because the column may be `timestamp` or `timestamptz` and the two behave
 * differently under that operator. Adding an interval is the same arithmetic
 * either way.
 */
final class PostgresDialect extends Dialect
{
    public function quote(string $identifier): string
    {
        return '"'.str_replace('"', '""', $identifier).'"';
    }

    public function bucket(string $column, string $grain, float $offsetHours): string
    {
        $this->assertGrain($grain);

        $shifted = $offsetHours === 0.0
            ? $column
            : "({$column} + INTERVAL '{$this->interval($offsetHours)}')";

        return "date_trunc('{$grain}', {$shifted})";
    }

    public function contains(string $column): string
    {
        // ILIKE rather than LOWER() on both sides, so an index on the column
        // still has a chance of being used.
        return "{$column} ILIKE ?";
    }

    private function interval(float $hours): string
    {
        return rtrim(rtrim(number_format($hours, 2, '.', ''), '0'), '.').' hours';
    }
}
