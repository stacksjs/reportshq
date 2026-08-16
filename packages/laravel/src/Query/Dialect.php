<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Query;

/**
 * The handful of expressions that are written differently in each database.
 *
 * Only two things genuinely differ: how an identifier is quoted, and how a
 * timestamp is truncated to a day, week or month in somebody's timezone. The
 * second is the one every time series depends on, and getting it wrong moves
 * rows between buckets rather than failing, so it is worth writing out per
 * database instead of hoping one expression works everywhere.
 *
 * The zone is applied as a **fixed offset in hours**, computed once for the
 * range rather than per row. That is exactly correct except across a daylight
 * saving boundary, where one bucket is an hour wide or three. The trade is
 * worth naming, and it is the same one the TypeScript engine made: a chart is
 * off by an hour on two days a year, and is never off by a whole row. Asking
 * the database to resolve a named zone per row means MySQL needs its timezone
 * tables loaded, which plenty of installations do not have, and SQLite cannot
 * do it at all.
 */
abstract class Dialect
{
    public const GRAINS = ['hour', 'day', 'week', 'month'];

    abstract public function quote(string $identifier): string;

    /** Truncate a timestamp column to the start of its bucket. */
    abstract public function bucket(string $column, string $grain, float $offsetHours): string;

    /** Case insensitive containment, which is what a `contains` filter means. */
    abstract public function contains(string $column): string;

    public function qualify(string $table, string $column): string
    {
        return $this->quote($table).'.'.$this->quote($column);
    }

    protected function assertGrain(string $grain): void
    {
        if (! in_array($grain, self::GRAINS, true)) {
            throw new \InvalidArgumentException(
                "Unknown grain '{$grain}'. Known: ".implode(', ', self::GRAINS).'.'
            );
        }
    }

    public static function for(string $driver): self
    {
        return match ($driver) {
            'pgsql' => new PostgresDialect,
            'mysql', 'mariadb' => new MySqlDialect,
            'sqlite' => new SqliteDialect,
            default => throw new \InvalidArgumentException(
                "No dialect for '{$driver}'. Supported: pgsql, mysql, mariadb, sqlite."
            ),
        };
    }
}
