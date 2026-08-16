<?php

declare(strict_types=1);

/**
 * The grid's tests.
 *
 * Packing is the part of a builder that feels broken when it is subtly wrong,
 * and "feels broken" is not something a browser test catches: a block that
 * lands one row lower than it was dropped is annoying rather than obviously
 * incorrect, so it survives review and irritates somebody every day.
 *
 *     php packages/laravel/tests/layout.php
 */

require __DIR__.'/../src/Reports/Layout.php';

use ReportsHQ\Laravel\Reports\Layout;

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
                "%s\n  expected: %s\n  actual:   %s",
                $message,
                json_encode($expected, JSON_UNESCAPED_SLASHES),
                json_encode($actual, JSON_UNESCAPED_SLASHES),
            ));
        }
    }
}

function block(string $id, int $x, int $y, int $w = 3, int $h = 3): array
{
    return ['id' => $id, 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h];
}

/** Positions only, keyed by id, which is what every assertion here is about. */
function positions(array $packed): array
{
    $out = [];

    foreach ($packed as $b) {
        $out[$b['id']] = [$b['x'], $b['y']];
    }

    return $out;
}

/** Whether any two blocks share a cell. */
function overlaps(array $packed): bool
{
    foreach ($packed as $a) {
        foreach ($packed as $b) {
            if ($a['id'] === $b['id']) {
                continue;
            }

            $apart = $a['x'] + $a['w'] <= $b['x'] || $b['x'] + $b['w'] <= $a['x']
                || $a['y'] + $a['h'] <= $b['y'] || $b['y'] + $b['h'] <= $a['y'];

            if (! $apart) {
                return true;
            }
        }
    }

    return false;
}

$run = new Runner();

/*
 * The grid's boundaries.
 */
$run->test('a block cannot start outside the grid', function (Runner $run): void {
    $run->same(['id' => 'a', 'x' => 9, 'y' => 0, 'w' => 3, 'h' => 3], Layout::clamp(block('a', 20, 0)), 'pushed back inside');
    $run->same(['id' => 'a', 'x' => 0, 'y' => 0, 'w' => 3, 'h' => 3], Layout::clamp(block('a', -5, -5)), 'and from the other side');
});

$run->test('a block wider than the grid is narrowed, not refused', function (Runner $run): void {
    // It arrives from a drag at the right hand edge. Refusing the drop is a
    // worse answer than narrowing the block.
    $run->same(12, Layout::clamp(block('a', 0, 0, 40))['w'], 'clamped to the full width');
    $run->same(1, Layout::clamp(block('a', 0, 0, 0))['w'], 'and never to nothing');
});

$run->test('a block at the right edge keeps its width by moving left', function (Runner $run): void {
    // Rather than being narrowed, which would silently resize something
    // somebody only meant to move.
    $packed = Layout::clamp(block('a', 11, 0, 4));

    $run->same(8, $packed['x'], 'moved left');
    $run->same(4, $packed['w'], 'width intact');
});

/*
 * Overlap.
 */
$run->test('two blocks never share a cell', function (Runner $run): void {
    $packed = Layout::pack([block('a', 0, 0), block('b', 0, 0), block('c', 0, 0)]);

    $run->assert(! overlaps($packed), 'expected no overlap: '.json_encode($packed));
});

$run->test('the moved block keeps where it was dropped', function (Runner $run): void {
    // The whole feel of a drag rests on this: everything else gives way, so it
    // is moving a thing rather than negotiating with one.
    $packed = positions(Layout::pack([block('a', 0, 0), block('b', 0, 3)], moved: 'b'));

    $run->same([0, 0], $packed['b'], 'b landed where it was dropped');
    $run->assert($packed['a'][1] >= 3, 'a gave way, ended at row '.$packed['a'][1]);
});

$run->test('blocks side by side are left alone', function (Runner $run): void {
    // Nothing collides, so nothing should move. A packer that shuffles a legal
    // layout is one nobody can arrange.
    $packed = positions(Layout::pack([block('a', 0, 0), block('b', 3, 0), block('c', 6, 0)]));

    $run->same([[0, 0], [3, 0], [6, 0]], [$packed['a'], $packed['b'], $packed['c']], 'expected no movement');
});

/*
 * Floating upward.
 */
$run->test('a hole closes when the block above it goes', function (Runner $run): void {
    // Otherwise deleting a block leaves a gap somebody has to drag everything
    // up through by hand.
    $packed = positions(Layout::pack([block('b', 0, 6)]));

    $run->same([0, 0], $packed['b'], 'floated to the top');
});

$run->test('a block floats only as far as the one above allows', function (Runner $run): void {
    $packed = positions(Layout::pack([block('a', 0, 0, 3, 3), block('b', 0, 9, 3, 3)]));

    $run->same([0, 0], $packed['a'], 'a stays');
    $run->same([0, 3], $packed['b'], 'b rises to just under it');
});

$run->test('a block floats past one that does not overlap its columns', function (Runner $run): void {
    $packed = positions(Layout::pack([block('a', 0, 0, 3, 3), block('b', 6, 9, 3, 3)]));

    $run->same([6, 0], $packed['b'], 'different columns, so nothing is in the way');
});

/*
 * Stability, which is what makes a layout arrangeable at all.
 */
$run->test('packing an already packed layout changes nothing', function (Runner $run): void {
    $once = Layout::pack([block('a', 0, 0), block('b', 3, 0), block('c', 0, 3)]);
    $twice = Layout::pack($once);

    $run->same($once, $twice, 'expected a fixed point');
});

$run->test('the result is ordered for reading, down then across', function (Runner $run): void {
    $packed = Layout::pack([block('c', 0, 3), block('b', 3, 0), block('a', 0, 0)]);

    $run->same(['a', 'b', 'c'], array_column($packed, 'id'), 'expected reading order');
});

$run->test('an empty grid packs to nothing rather than failing', function (Runner $run): void {
    $run->same([], Layout::pack([]), 'expected an empty list');
});

/*
 * Adding.
 */
$run->test('a new block goes below everything, not into the first gap', function (Runner $run): void {
    // A block appearing in the middle of an arrangement somebody already made
    // is startling, and the bottom is where the eye goes after clicking add.
    $run->same(6, Layout::nextRow([block('a', 0, 0, 3, 3), block('b', 3, 0, 3, 6)]), 'below the tallest');
    $run->same(0, Layout::nextRow([]), 'the first block starts at the top');
});

/*
 * The case a real drag produces.
 */
$run->test('dropping a wide block across two narrow ones pushes both down', function (Runner $run): void {
    $packed = positions(Layout::pack([
        block('left', 0, 0, 6, 3),
        block('right', 6, 0, 6, 3),
        block('wide', 0, 0, 12, 3),
    ], moved: 'wide'));

    $run->same([0, 0], $packed['wide'], 'the dropped block keeps its cell');
    $run->same(3, $packed['left'][1], 'left pushed down');
    $run->same(3, $packed['right'][1], 'right pushed down');
});

$run->test('a tall block is cleared by its full height', function (Runner $run): void {
    // Pushing by one row is the bug that leaves a tall block overlapping the
    // thing below it, and it looks fine until the block is taller than the gap.
    $packed = positions(Layout::pack([
        block('tall', 0, 0, 6, 8),
        block('under', 0, 1, 6, 3),
    ], moved: 'tall'));

    $run->same(8, $packed['under'][1], 'cleared the whole height');
});

echo "\n";

foreach ($run->failures as $failure) {
    echo "  FAIL  {$failure}\n";
}

printf("\n %d pass, %d fail\n\n", $run->passed, count($run->failures));

exit($run->failures === [] ? 0 : 1);
