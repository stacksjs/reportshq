<?php

declare(strict_types=1);

/**
 * The chart geometry's tests.
 *
 * Every number here was worked out by hand. That is the point of the geometry
 * being pure: a chart is otherwise checked by looking at a picture and deciding
 * it seems about right, which catches a line that vanishes and never catches an
 * axis that is quietly ten percent short.
 *
 *     php packages/laravel/tests/charts.php
 */

require __DIR__.'/../src/Charts/Format.php';
require __DIR__.'/../src/Charts/Geometry.php';

use ReportsHQ\Laravel\Charts\Format;
use ReportsHQ\Laravel\Charts\Geometry;

final class Runner
{
    public int $passed = 0;

    /** @var list<string> */
    public array $failures = [];

    public function test(string $name, callable $body): void
    {
        try {
            $body($this);
            $this->passed++;
        } catch (Throwable $error) {
            $this->failures[] = $name.': '.$error->getMessage();
        }
    }

    public function assert(bool $condition, string $message): void
    {
        if (! $condition) {
            throw new RuntimeException($message);
        }
    }

    public function same(mixed $expected, mixed $actual, string $message): void
    {
        if ($expected !== $actual) {
            throw new RuntimeException(sprintf(
                '%s (expected %s, got %s)',
                $message,
                json_encode($expected, JSON_UNESCAPED_SLASHES),
                json_encode($actual, JSON_UNESCAPED_SLASHES),
            ));
        }
    }

    public function close(float $expected, float $actual, string $message, float $tolerance = 0.01): void
    {
        if (abs($expected - $actual) > $tolerance) {
            throw new RuntimeException("{$message} (expected {$expected}, got {$actual})");
        }
    }
}

function series(array $values, string $key = 'total'): array
{
    $points = [];

    foreach ($values as $index => $value) {
        $points[] = ['t' => sprintf('2026-08-%02dT00:00:00Z', $index + 1), 'value' => $value];
    }

    return [['key' => $key, 'points' => $points]];
}

$run = new Runner();

/*
 * Numbers as a person reads them.
 */
$run->test('compact keeps small numbers whole and shortens large ones', function (Runner $run): void {
    $run->same('0', Format::compact(0), 'zero');
    $run->same('42', Format::compact(42), 'a small integer stays itself');
    $run->same('42.50', Format::compact(42.5), 'a small decimal keeps two places');
    // Not shortened at 1000: "1.0k" for 1200 loses more than it saves.
    $run->same('1,200', Format::compact(1200), 'four figures get a separator');
    $run->same('12.5k', Format::compact(12500), 'five figures shorten');
    $run->same('1.5M', Format::compact(1_500_000), 'millions');
    $run->same('2.0B', Format::compact(2_000_000_000), 'billions');
});

$run->test('compact survives what a division can produce', function (Runner $run): void {
    $run->same('0', Format::compact(INF), 'infinity is not a number to draw');
    $run->same('0', Format::compact(NAN), 'nor is a NaN');
});

$run->test('money drops the pennies once they stop mattering', function (Runner $run): void {
    $run->same('$42.50', Format::money(42.5), 'small amounts keep cents');
    $run->same('$1,235', Format::money(1234.56), 'large ones do not');
    $run->same('-$42.50', Format::money(-42.5), 'the sign goes before the symbol');
    $run->same('42.50 SEK', Format::money(42.5, 'SEK'), 'an unknown currency is named rather than guessed');
});

$run->test('a delta is signed, and a missing one is a dash', function (Runner $run): void {
    $run->same('+12.3%', Format::delta(0.123), 'a rise');
    $run->same('-8%', Format::delta(-0.08), 'a fall');
    $run->same('-', Format::delta(null), 'nothing to compare against');
});

$run->test('a bucket is labelled at the grain it was bucketed by', function (Runner $run): void {
    // A month chart labelled with days reads as twelve copies of the first.
    $run->same('3 Aug', Format::shortDate('2026-08-03T00:00:00Z', 'day'), 'day');
    $run->same('Aug 2026', Format::shortDate('2026-08-03T00:00:00Z', 'month'), 'month');
    $run->same('3 Aug 14:00', Format::shortDate('2026-08-03T14:00:00Z', 'hour'), 'hour');
    $run->same('', Format::shortDate(null), 'no bucket, no label');
});

/*
 * The scale.
 */
$run->test('an axis ends on a number somebody would have chosen', function (Runner $run): void {
    // The set of answers is 1, 2, 5 or 10 times a power of ten, and nothing
    // else: those are the intervals that divide into four gridlines somebody
    // can read without doing arithmetic. An axis ending at 237 is fine
    // numerically and reads as a mistake.
    //
    // The rule applies below one at the smaller magnitude too, so a maximum of
    // 0.4 gets an axis to 0.5 rather than to 1, which would leave half the
    // chart empty.
    $run->same(0.5, Geometry::niceCeiling(0.4), 'below one');
    $run->same(2.0, Geometry::niceCeiling(1.2), 'up to two');
    $run->same(5.0, Geometry::niceCeiling(4.1), 'up to five');
    $run->same(10.0, Geometry::niceCeiling(6.0), 'up to ten');
    $run->same(500.0, Geometry::niceCeiling(237.0), 'the next step up from 237 is 500, since 250 is not on the ladder');
    $run->same(200.0, Geometry::niceCeiling(150.0), 'and 150 reaches 200 rather than jumping to 500');
    $run->same(1.0, Geometry::niceCeiling(0), 'an empty chart still has a scale');
});

$run->test('a chart of all zeros still has a scale', function (Runner $run): void {
    // Without the floor of one, every point lands on the axis and the line
    // disappears into it, which reads as a broken chart rather than a quiet week.
    $plot = Geometry::plot(series([0, 0, 0]));

    $run->same(1.0, $plot['yMax'], 'expected a scale of one');
    $run->close(234.0, Geometry::y($plot, 0), 'zero sits on the baseline');
});

$run->test('the plot fills the box minus its margins', function (Runner $run): void {
    $plot = Geometry::plot(series([10, 20]));

    // 720 - 52 - 12 across, 260 - 12 - 26 down.
    $run->same(656.0, $plot['innerWidth'], 'inner width');
    $run->same(222.0, $plot['innerHeight'], 'inner height');
});

$run->test('the highest value reaches the top of the scale', function (Runner $run): void {
    $plot = Geometry::plot(series([0, 50, 100]));

    $run->same(100.0, $plot['yMax'], 'a round maximum needs no rounding');
    $run->close(12.0, Geometry::y($plot, 100), 'the peak sits at the top margin');
    $run->close(234.0, Geometry::y($plot, 0), 'zero sits on the baseline');
    $run->close(123.0, Geometry::y($plot, 50), 'half way is half way');
});

$run->test('the first and last points sit on the edges of the plot', function (Runner $run): void {
    $plot = Geometry::plot(series([1, 2, 3]));

    $run->close(52.0, Geometry::x($plot, 0), 'the first point is at the left margin');
    $run->close(708.0, Geometry::x($plot, 2), 'the last is at the right edge');
});

$run->test('a single point does not divide by zero', function (Runner $run): void {
    $plot = Geometry::plot(series([5]));

    $run->close(52.0, Geometry::x($plot, 0), 'expected the left margin, not a NaN');
});

$run->test('gridlines include zero and the top', function (Runner $run): void {
    $ticks = Geometry::ticks(Geometry::plot(series([0, 100])));

    $run->same(5, count($ticks), 'four gaps means five lines');
    $run->same('0', $ticks[0]['label'], 'the first is zero');
    $run->same('100', $ticks[4]['label'], 'the last is the ceiling');
});

$run->test('time labels are thinned so they cannot collide', function (Runner $run): void {
    // Thirty daily buckets in seven hundred pixels is a grey smear.
    $points = series(array_fill(0, 30, 1))[0]['points'];
    $labels = Geometry::timeLabels(Geometry::plot(series(array_fill(0, 30, 1))), $points);

    $run->same(10, count($labels), 'every third bucket');
    $run->same('1 Aug', $labels[0]['label'], 'the first is always labelled');
});

/*
 * The marks.
 */
$run->test('a bar with a value is never invisible', function (Runner $run): void {
    // A value that rounds to zero height is a number the reader cannot see.
    $plot = Geometry::plot(series([1000, 1]));
    $bars = Geometry::bars($plot, series([1000, 1])[0]['points']);

    $run->assert($bars[1]['height'] >= 1.0, 'expected at least a pixel, got '.$bars[1]['height']);
});

$run->test('a bar of zero has no height at all', function (Runner $run): void {
    // The opposite case, and it has to stay the opposite: a floor applied to
    // genuine zeros draws a row of stubs that look like small values.
    $plot = Geometry::plot(series([100, 0]));
    $bars = Geometry::bars($plot, series([100, 0])[0]['points']);

    $run->same(0.0, $bars[1]['height'], 'expected nothing drawn');
});

$run->test('bars leave a gap between neighbours', function (Runner $run): void {
    $plot = Geometry::plot(series([1, 2, 3, 4]));
    $bars = Geometry::bars($plot, series([1, 2, 3, 4])[0]['points']);

    $slot = 656 / 4;
    $run->close($slot - 2, $bars[0]['width'], 'expected a two pixel gap');
    $run->close($bars[0]['x'] + $slot, $bars[1]['x'], 'expected even spacing');
});

$run->test('a line path starts with a move and continues with lines', function (Runner $run): void {
    $plot = Geometry::plot(series([0, 100]));
    $path = Geometry::linePath($plot, series([0, 100])[0]['points']);

    $run->assert(str_starts_with($path, 'M52,234'), 'expected to start at the origin, got: '.$path);
    $run->assert(str_contains($path, ' L708,12'), 'expected to end at the peak, got: '.$path);
});

$run->test('an area closes down to the baseline and back', function (Runner $run): void {
    $plot = Geometry::plot(series([50, 100]));
    $path = Geometry::areaPath($plot, series([50, 100])[0]['points']);

    $run->assert(str_ends_with($path, 'Z'), 'expected a closed path');
    $run->assert(substr_count($path, 'L') >= 3, 'expected the two baseline corners');
});

$run->test('an empty series draws no area at all', function (Runner $run): void {
    // Rather than a degenerate path, which some renderers fill as a stripe.
    $run->same('', Geometry::areaPath(Geometry::plot([]), []), 'expected nothing');
});

/*
 * The donut.
 */
$run->test('slices are largest first and add to the whole', function (Runner $run): void {
    $slices = Geometry::donut([
        ['key' => 'small', 'points' => [['t' => null, 'value' => 10]]],
        ['key' => 'big', 'points' => [['t' => null, 'value' => 30]]],
    ]);

    $run->same('big', $slices[0]['key'], 'expected the largest first');
    $run->close(0.75, $slices[0]['percent'], 'expected three quarters');
    $run->close(1.0, $slices[0]['percent'] + $slices[1]['percent'], 'expected the parts to make a whole');
});

$run->test('a donut of nothing draws nothing', function (Runner $run): void {
    $run->same([], Geometry::donut([['key' => 'a', 'points' => [['t' => null, 'value' => 0]]]]), 'expected no slices');
});

$run->test('every slice is an annulus, not a wedge', function (Runner $run): void {
    // Two arcs and a closing Z. A pie wedge would have one arc and a line to
    // the centre, and the hole is where the total lives.
    $slices = Geometry::donut([['key' => 'a', 'points' => [['t' => null, 'value' => 1]]]]);

    $run->same(2, substr_count($slices[0]['path'], 'A'), 'expected an outer and an inner arc');
});

/*
 * Colour and legends.
 */
$run->test('a colour is a token, never a hex literal', function (Runner $run): void {
    // A baked hex is wrong the moment somebody switches theme.
    $run->same('var(--series-1)', Geometry::color(0), 'the first slot');
    $run->same('var(--series-5)', Geometry::color(4), 'the last slot');
    $run->same('var(--series-1)', Geometry::color(5), 'and then it wraps');
    $run->same('var(--series-other)', Geometry::color(2, 'Other'), 'a folded tail is neutral');
});

$run->test('two or more series always carry a legend', function (Runner $run): void {
    $run->assert(! Geometry::needsLegend(series([1])), 'one series names itself in the title');
    $run->assert(Geometry::needsLegend([
        ['key' => 'a', 'points' => []],
        ['key' => 'b', 'points' => []],
    ]), 'identity must never rest on colour alone');
});

echo "\n";

foreach ($run->failures as $failure) {
    echo "  FAIL  {$failure}\n";
}

printf("\n %d pass, %d fail\n\n", $run->passed, count($run->failures));

exit($run->failures === [] ? 0 : 1);
