<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Query;

/**
 * MySQL and MariaDB, which have no `date_trunc`.
 *
 * Truncation is done by formatting away the parts below the grain, which is
 * the usual idiom. A week starts on Monday: `%v` with `%x` is the ISO week
 * pair, and mixing `%V`/`%X` in would silently start weeks on Sunday for half
 * the report.
 */
final class MySqlDialect extends Dialect
{
    public function quote(string $identifier): string
    {
        return '`'.str_replace('`', '``', $identifier).'`';
    }

    public function bucket(string $column, string $grain, float $offsetHours): string
    {
        $this->assertGrain($grain);

        $shifted = $offsetHours === 0.0
            ? $column
            : "DATE_ADD({$column}, INTERVAL ".(int) round($offsetHours * 60).' MINUTE)';

        return match ($grain) {
            'hour' => "DATE_FORMAT({$shifted}, '%Y-%m-%d %H:00:00')",
            'day' => "DATE_FORMAT({$shifted}, '%Y-%m-%d 00:00:00')",
            // Back up to the Monday, then truncate to the day.
            'week' => "DATE_FORMAT(DATE_SUB({$shifted}, INTERVAL WEEKDAY({$shifted}) DAY), '%Y-%m-%d 00:00:00')",
            'month' => "DATE_FORMAT({$shifted}, '%Y-%m-01 00:00:00')",
        };
    }

    public function contains(string $column): string
    {
        // MySQL's default collations are already case insensitive, and LIKE
        // follows the collation, so no folding is needed here.
        return "{$column} LIKE ?";
    }
}
