<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Charts;

/**
 * A runner's result, arranged for one view.
 *
 * The views do nothing but write attributes, and this is why. Blade that
 * computes coordinates cannot be tested without rendering it, and a chart
 * checked by rendering it is a chart checked by looking at a picture and
 * deciding it seems about right. Everything with arithmetic in it lives here
 * and is asserted against numbers worked out by hand.
 *
 * The other half of the split is which template to use: `view()` is the only
 * place a block's kind is turned into a file name, so an unknown kind falls
 * back to the table rather than to a blank tile. A report from a newer version
 * of the builder then degrades to something readable instead of to nothing.
 */
final class Presenter
{
    /** The kinds that have a view of their own. */
    public const KINDS = ['big_number', 'line', 'area', 'bar', 'donut', 'table', 'note'];

    /** @param array<string, mixed> $block */
    public static function view(array $block): string
    {
        $kind = (string) ($block['kind'] ?? 'table');

        if (($block['error'] ?? null) !== null) {
            return 'reportshq::partials.error';
        }

        return match ($kind) {
            'big_number' => 'reportshq::charts.big-number',
            'line', 'area' => 'reportshq::charts.line',
            'bar' => 'reportshq::charts.bar',
            'donut' => 'reportshq::charts.donut',
            'note' => 'reportshq::charts.note',
            // A table is the accessible reading of every other chart, so it is
            // also the safest thing to show when the kind is one we do not know.
            default => 'reportshq::charts.table',
        };
    }

    /**
     * Everything the chosen view needs, and nothing it does not.
     *
     * @param  array<string, mixed>  $block
     * @return array<string, mixed>
     */
    public static function data(array $block): array
    {
        $series = is_array($block['series'] ?? null) ? $block['series'] : [];
        $grain = (string) (($block['query']['grain'] ?? null) ?? 'day');

        // The block last, so it cannot be clobbered by a key of the same name
        // from a presenter below. Written as a merge rather than a union for
        // the reason the donut found out about: `+` keeps the left side and
        // silently discards the right.
        return array_merge(match (self::view($block)) {
            'reportshq::charts.big-number' => self::bigNumber($block),
            'reportshq::charts.line' => self::line($block, $series, $grain),
            'reportshq::charts.bar' => self::bar($series, $grain),
            'reportshq::charts.donut' => self::donut($series),
            'reportshq::charts.table' => self::table($block, $series),
            default => [],
        }, ['block' => $block]);
    }

    /** @param array<string, mixed> $block */
    private static function bigNumber(array $block): array
    {
        $total = $block['total'] ?? null;
        $currency = $block['query']['currency'] ?? null;

        return [
            'value' => $total === null
                ? '-'
                : (is_string($currency) ? Format::money((float) $total, $currency) : Format::compact($total)),
            // Absent rather than "no change", which claims a comparison was
            // made. A comparison range is not implemented yet and saying
            // nothing is the honest rendering of that.
            'caption' => $block['caption'] ?? null,
        ];
    }

    /**
     * @param  array<string, mixed>  $block
     * @param  list<array<string, mixed>>  $series
     */
    private static function line(array $block, array $series, string $grain): array
    {
        if ($series === []) {
            return ['paths' => [], 'ticks' => [], 'labels' => [], 'area' => false, 'legend' => false];
        }

        $plot = Geometry::plot($series);
        $paths = [];

        foreach ($series as $index => $entry) {
            $paths[] = [
                'key' => $entry['key'],
                'color' => Geometry::color($index, $entry['key']),
                'line' => Geometry::linePath($plot, $entry['points']),
                'area' => Geometry::areaPath($plot, $entry['points']),
            ];
        }

        return [
            'paths' => $paths,
            'ticks' => Geometry::ticks($plot),
            'labels' => Geometry::timeLabels($plot, $series[0]['points'], $grain),
            'area' => ($block['kind'] ?? null) === 'area',
            'legend' => Geometry::needsLegend($series),
        ];
    }

    /** @param list<array<string, mixed>> $series */
    private static function bar(array $series, string $grain): array
    {
        if ($series === []) {
            return ['rects' => [], 'ticks' => [], 'labels' => [], 'color' => Geometry::color(0)];
        }

        $plot = Geometry::plot($series);

        return [
            // The first series only. A grouped bar chart is a different mark
            // with its own geometry, and drawing several series on top of each
            // other here would silently hide all but the tallest.
            'rects' => Geometry::bars($plot, $series[0]['points'], $grain),
            'ticks' => Geometry::ticks($plot),
            'labels' => Geometry::timeLabels($plot, $series[0]['points'], $grain),
            'color' => Geometry::color(0, $series[0]['key']),
        ];
    }

    /** @param list<array<string, mixed>> $series */
    private static function donut(array $series): array
    {
        $slices = Geometry::donut($series);
        $total = 0.0;

        foreach ($slices as $slice) {
            $total += $slice['value'];
        }

        return [
            // `array_merge`, not `+`. The union operator keeps the left side's
            // keys, so the raw fraction survived and every legend read
            // "0.53333333333333" where it meant 53%. The new `label` key
            // appeared correctly at the same time, which is what made it look
            // like a formatting problem rather than a merge one.
            'slices' => array_map(static fn (array $slice): array => array_merge($slice, [
                'label' => Format::compact($slice['value']),
                'percent' => round($slice['percent'] * 100).'%',
            ]), $slices),
            'total' => Format::compact($total),
        ];
    }

    /**
     * @param  array<string, mixed>  $block
     * @param  list<array<string, mixed>>  $series
     */
    private static function table(array $block, array $series): array
    {
        $totals = [];

        foreach ($series as $index => $entry) {
            $sum = 0.0;

            foreach ($entry['points'] as $point) {
                $sum += (float) $point['value'];
            }

            $totals[] = ['key' => $entry['key'], 'value' => $sum, 'index' => $index];
        }

        usort($totals, static fn (array $a, array $b): int => $b['value'] <=> $a['value']);

        $whole = array_sum(array_column($totals, 'value'));

        $rows = [];

        foreach ($totals as $row) {
            $rows[] = [
                // An ungrouped table has one row and `total` is not a label. It
                // takes the block's own title, or the word, but never an empty
                // cell beside a number.
                'key' => $row['key'] === 'total' ? (($block['title'] ?? '') ?: 'Total') : $row['key'],
                'color' => Geometry::color($row['index'], $row['key']),
                'value' => Format::compact($row['value']),
                'share' => $whole > 0 ? round($row['value'] / $whole * 100).'%' : '-',
            ];
        }

        return ['rows' => $rows, 'label' => 'Series'];
    }
}
