<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Charts;

/**
 * Numbers and dates as a person reads them.
 *
 * Ported from the TypeScript engine's `charts.ts` deliberately rather than
 * reinvented: a customer moving between the hosted product and this one should
 * see the same axis labels, and "1.2k" in one place beside "1,234" in the other
 * reads as two products rather than one.
 */
final class Format
{
    /** Numbers a person reads at a glance: 1.2k, 3.4M, 12.3. */
    public static function compact(float|int $value): string
    {
        if (! is_finite((float) $value)) {
            return '0';
        }

        $abs = abs((float) $value);

        if ($abs >= 1_000_000_000) {
            return number_format($value / 1_000_000_000, 1).'B';
        }

        if ($abs >= 1_000_000) {
            return number_format($value / 1_000_000, 1).'M';
        }

        // Not at 1000: "1.0k" for 1200 loses more than it saves, and a
        // four figure number is still readable with a separator.
        if ($abs >= 10_000) {
            return number_format($value / 1000, 1).'k';
        }

        if ($abs >= 1000) {
            return number_format(round((float) $value));
        }

        if ((float) $value === floor((float) $value)) {
            return (string) (int) $value;
        }

        return number_format((float) $value, 2);
    }

    /** Currency, without inventing precision it does not have. */
    public static function money(float|int $value, string $currency = 'USD'): string
    {
        $symbol = match (strtoupper($currency)) {
            'USD' => '$',
            'EUR' => '€',
            'GBP' => '£',
            default => '',
        };

        $decimals = abs((float) $value) >= 1000 ? 0 : 2;
        $formatted = number_format((float) $value, $decimals);

        return $symbol === ''
            ? $formatted.' '.strtoupper($currency)
            : ($value < 0 ? '-'.$symbol.ltrim($formatted, '-') : $symbol.$formatted);
    }

    /** A signed percentage, or a dash when there is nothing to compare against. */
    public static function delta(?float $change): string
    {
        if ($change === null) {
            return '-';
        }

        $percent = $change * 100;
        $rounded = abs($percent) >= 100 ? round($percent) : round($percent * 10) / 10;

        // Rendered plainly rather than through `compact`, which pads a decimal
        // to two places: a rise of 12.3% is not "12.30%", and the extra zero on
        // a delta reads as precision the comparison does not have.
        $rendered = rtrim(rtrim(number_format($rounded, 1, '.', ','), '0'), '.');

        return ($change >= 0 ? '+' : '').$rendered.'%';
    }

    /**
     * A bucket's label at the grain it was bucketed by.
     *
     * An hourly axis wants the hour and a monthly one does not, and showing the
     * same string for both is how a month chart ends up reading as twelve
     * copies of the first of the month.
     */
    public static function shortDate(?string $at, string $grain = 'day'): string
    {
        if ($at === null || $at === '') {
            return '';
        }

        try {
            $moment = new \DateTimeImmutable($at);
        } catch (\Exception) {
            return $at;
        }

        return match ($grain) {
            'hour' => $moment->format('j M H:i'),
            'month' => $moment->format('M Y'),
            default => $moment->format('j M'),
        };
    }
}
