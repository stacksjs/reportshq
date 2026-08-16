<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Query;

/**
 * SQLite, which is the scaffold's default and every Laravel test suite.
 *
 * `strftime` does the truncation. The week case is the awkward one: SQLite
 * counts `%w` from Sunday, so a Monday start needs the Sunday case mapped to 6
 * rather than 0, which is what the `%w = 0` branch below is for. Getting it
 * wrong moves a seventh of every week's rows into the wrong bucket, which
 * looks like a quiet Monday rather than like a bug.
 */
final class SqliteDialect extends Dialect
{
    public function quote(string $identifier): string
    {
        return '"'.str_replace('"', '""', $identifier).'"';
    }

    public function bucket(string $column, string $grain, float $offsetHours): string
    {
        $this->assertGrain($grain);

        $shift = $offsetHours === 0.0
            ? ''
            : ", '".($offsetHours >= 0 ? '+' : '-').abs($offsetHours)." hours'";

        return match ($grain) {
            'hour' => "strftime('%Y-%m-%d %H:00:00', {$column}{$shift})",
            'day' => "strftime('%Y-%m-%d 00:00:00', {$column}{$shift})",
            'week' => "strftime('%Y-%m-%d 00:00:00', {$column}{$shift}, "
                ."'-' || ((strftime('%w', {$column}{$shift}) + 6) % 7) || ' days')",
            'month' => "strftime('%Y-%m-01 00:00:00', {$column}{$shift})",
        };
    }

    public function contains(string $column): string
    {
        // SQLite's LIKE is case insensitive for ASCII only. Folding both sides
        // is the portable answer and these are short values.
        return "LOWER({$column}) LIKE LOWER(?)";
    }
}
