<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Charts;

/**
 * Where every mark on a chart goes.
 *
 * Pure arithmetic over a runner's series, with no Blade and no SVG in it, so
 * the shapes can be checked against numbers worked out by hand rather than by
 * looking at a picture and deciding it seems about right. The views take these
 * coordinates and do nothing but write attributes.
 *
 * Ported from the TypeScript `charts.ts` rather than reinvented. The two draw
 * the same product's charts, and an axis that ends at 250 in one and 300 in the
 * other is a difference somebody will eventually have to explain.
 */
final class Geometry
{
    /** How many distinct series colours exist before they repeat. */
    public const SERIES_SLOTS = 5;

    public const BOX = ['width' => 720, 'height' => 260, 'top' => 12, 'right' => 12, 'bottom' => 26, 'left' => 52];

    /**
     * The series colour for a slot, as a CSS variable reference.
     *
     * Never a hex literal. The value has to change with the theme, and a chart
     * that baked one in would be wrong the moment somebody switched. `Other` is
     * neutral, because a folded tail is not an identity and colouring it makes
     * it compete with the categories it is hiding.
     */
    public static function color(int $index, ?string $key = null): string
    {
        if ($key === 'Other') {
            return 'var(--series-other)';
        }

        return 'var(--series-'.($index % self::SERIES_SLOTS + 1).')';
    }

    /**
     * The next 1, 2 or 5 times a power of ten.
     *
     * So the top gridline is a number somebody would have chosen: an axis
     * ending at 237 is arithmetically fine and reads as a mistake.
     */
    public static function niceCeiling(float $value): float
    {
        if ($value <= 0) {
            return 1.0;
        }

        $magnitude = 10 ** floor(log10($value));
        $normalized = $value / $magnitude;

        $step = match (true) {
            $normalized <= 1 => 1,
            $normalized <= 2 => 2,
            $normalized <= 5 => 5,
            default => 10,
        };

        return (float) ($step * $magnitude);
    }

    /**
     * The plot area and its two scales.
     *
     * @param  list<array{key: string, points: list<array{t: string|null, value: float|int}>}>  $series
     * @return array{left: float, top: float, innerWidth: float, innerHeight: float, yMax: float, points: int}
     */
    public static function plot(array $series, array $box = self::BOX): array
    {
        $innerWidth = $box['width'] - $box['left'] - $box['right'];
        $innerHeight = $box['height'] - $box['top'] - $box['bottom'];

        $max = 1.0;

        foreach ($series as $entry) {
            foreach ($entry['points'] as $point) {
                $max = max($max, (float) $point['value']);
            }
        }

        return [
            'left' => (float) $box['left'],
            'top' => (float) $box['top'],
            'innerWidth' => (float) $innerWidth,
            'innerHeight' => (float) $innerHeight,
            // A chart of all zeros still needs a scale, or every point lands on
            // the axis and the line disappears into it.
            'yMax' => self::niceCeiling($max),
            'points' => count($series[0]['points'] ?? []),
        ];
    }

    /** @param array<string, float|int> $plot */
    public static function y(array $plot, float $value): float
    {
        $fraction = $plot['yMax'] > 0 ? $value / $plot['yMax'] : 0.0;

        return $plot['top'] + $plot['innerHeight'] - $fraction * $plot['innerHeight'];
    }

    /** @param array<string, float|int> $plot */
    public static function x(array $plot, int $index): float
    {
        $steps = max(1, $plot['points'] - 1);

        return $plot['left'] + ($index / $steps) * $plot['innerWidth'];
    }

    /**
     * Gridlines and their labels, including zero.
     *
     * @param  array<string, float|int>  $plot
     * @return list<array{value: float, y: float, label: string}>
     */
    public static function ticks(array $plot, int $count = 4): array
    {
        $step = $plot['yMax'] / $count;
        $ticks = [];

        for ($index = 0; $index <= $count; $index++) {
            $value = $step * $index;
            $ticks[] = ['value' => $value, 'y' => self::y($plot, $value), 'label' => Format::compact($value)];
        }

        return $ticks;
    }

    /**
     * Labels along the time axis, thinned so they never collide.
     *
     * Every third bucket at most, and always the first: a month of daily
     * buckets is thirty labels in seven hundred pixels, which is a grey smear
     * rather than an axis.
     *
     * @param  list<array{t: string|null, value: float|int}>  $points
     * @return list<array{x: float, label: string}>
     */
    public static function timeLabels(array $plot, array $points, string $grain = 'day', int $every = 3): array
    {
        $labels = [];

        foreach ($points as $index => $point) {
            if ($index % $every !== 0) {
                continue;
            }

            $labels[] = ['x' => self::x($plot, $index), 'label' => Format::shortDate($point['t'], $grain)];
        }

        return $labels;
    }

    /**
     * A line through a series' points.
     *
     * @param  list<array{t: string|null, value: float|int}>  $points
     * @param  array<string, float|int>  $plot
     */
    public static function linePath(array $plot, array $points): string
    {
        $commands = [];

        foreach ($points as $index => $point) {
            $commands[] = ($index === 0 ? 'M' : 'L')
                .round(self::x($plot, $index), 2).','.round(self::y($plot, (float) $point['value']), 2);
        }

        return implode(' ', $commands);
    }

    /**
     * The same line, closed down to the baseline.
     *
     * @param  list<array{t: string|null, value: float|int}>  $points
     * @param  array<string, float|int>  $plot
     */
    public static function areaPath(array $plot, array $points): string
    {
        if ($points === []) {
            return '';
        }

        $baseline = $plot['top'] + $plot['innerHeight'];
        $last = count($points) - 1;

        return self::linePath($plot, $points)
            .' L'.round(self::x($plot, $last), 2).','.round($baseline, 2)
            .' L'.round(self::x($plot, 0), 2).','.round($baseline, 2)
            .' Z';
    }

    /**
     * Bar geometry, with a two pixel gap between neighbours.
     *
     * The gap is not decoration. Adjacent fills of similar colour read as one
     * shape without it, and the palette's tightest pair sits in the band where
     * separation has to come from something other than hue.
     *
     * @param  list<array{t: string|null, value: float|int}>  $points
     * @param  array<string, float|int>  $plot
     * @return list<array{x: float, y: float, width: float, height: float, value: float, label: string}>
     */
    public static function bars(array $plot, array $points, string $grain = 'day'): array
    {
        $count = count($points);
        $slot = $plot['innerWidth'] / max(1, $count);
        $width = max(1.0, $slot - 2);
        $baseline = $plot['top'] + $plot['innerHeight'];

        $rects = [];

        foreach ($points as $index => $point) {
            $value = (float) $point['value'];
            $y = self::y($plot, $value);

            $rects[] = [
                'x' => $plot['left'] + $index * $slot + 1,
                'y' => $y,
                'width' => $width,
                // Never negative, and never zero height for a non zero value: a
                // bar that rounds away is a number the reader cannot see.
                'height' => max($value > 0 ? 1.0 : 0.0, $baseline - $y),
                'value' => $value,
                'label' => Format::shortDate($point['t'], $grain),
            ];
        }

        return $rects;
    }

    /**
     * Donut slices, largest first, with a small gap between them.
     *
     * A donut rather than a pie: the hole gives the total somewhere to live,
     * and a reader compares arc lengths rather than judging angles at a centre.
     *
     * @param  list<array{key: string, points: list<array{t: string|null, value: float|int}>}>  $series
     * @return list<array{path: string, value: float, key: string, color: string, percent: float}>
     */
    public static function donut(array $series, float $radius = 90, float $thickness = 28): array
    {
        $totals = [];

        foreach ($series as $entry) {
            $sum = 0.0;

            foreach ($entry['points'] as $point) {
                $sum += (float) $point['value'];
            }

            $totals[] = ['key' => $entry['key'], 'total' => $sum];
        }

        $total = array_sum(array_column($totals, 'total'));

        if ($total <= 0) {
            return [];
        }

        usort($totals, static fn (array $a, array $b): int => $b['total'] <=> $a['total']);

        $slices = [];
        $start = -M_PI / 2;
        $gap = 0.02;

        foreach ($totals as $index => $entry) {
            $fraction = $entry['total'] / $total;
            $end = $start + $fraction * M_PI * 2;

            $slices[] = [
                'path' => self::arc($start + $gap / 2, max($start + $gap / 2, $end - $gap / 2), $radius, $radius - $thickness),
                'value' => $entry['total'],
                'key' => $entry['key'],
                'color' => self::color($index, $entry['key']),
                'percent' => $fraction,
            ];

            $start = $end;
        }

        return $slices;
    }

    /** An annulus segment, drawn by hand so the hole is exact. */
    private static function arc(float $start, float $end, float $outer, float $inner): string
    {
        $large = $end - $start > M_PI ? 1 : 0;

        $point = static fn (float $r, float $angle): string => round($r * cos($angle), 2).','.round($r * sin($angle), 2);

        return 'M'.$point($outer, $start)
            ." A{$outer},{$outer} 0 {$large} 1 ".$point($outer, $end)
            .' L'.$point($inner, $end)
            ." A{$inner},{$inner} 0 {$large} 0 ".$point($inner, $start)
            .' Z';
    }

    /**
     * Whether a chart carries a legend.
     *
     * Always, for two or more series: identity must never rest on colour alone,
     * and one adjacent pair in this palette is inside the band where that is
     * the condition of the palette being usable at all rather than merely good
     * practice.
     *
     * A single series needs none. Its title already names it, and a legend of
     * one is a box saying the same thing twice.
     *
     * @param  list<array{key: string, points: list<mixed>}>  $series
     */
    public static function needsLegend(array $series): bool
    {
        return count($series) > 1;
    }
}
