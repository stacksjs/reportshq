<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

/**
 * Where blocks end up when one of them moves.
 *
 * Pure arithmetic over a list of rectangles, and on the server rather than only
 * in the browser. The hosted builder packed client side and stored whatever it
 * was told, which means the two could disagree and only the browser was ever
 * right; here the client packs for the preview and the server packs again for
 * the record, so a dropped block lands in the same place in both or the server
 * wins.
 *
 * The rules are the ones a person expects from a grid and would not think to
 * ask for. A block never overlaps another. A block never leaves the twelve
 * columns. Blocks float upward, so deleting one closes the hole rather than
 * leaving a gap somebody has to drag everything up through. And the block being
 * moved keeps the position it was dropped at: everything else gives way, which
 * is what makes a drag feel like moving a thing rather than negotiating with
 * one.
 */
final class Layout
{
    public const COLUMNS = 12;

    /**
     * Resolve a set of blocks into a legal arrangement.
     *
     * @param  list<array{id: int|string, x: int, y: int, w: int, h: int}>  $blocks
     * @param  int|string|null  $moved  The block that keeps its position; everything else yields.
     * @return list<array{id: int|string, x: int, y: int, w: int, h: int}>
     */
    public static function pack(array $blocks, int|string|null $moved = null): array
    {
        $blocks = array_map(self::clamp(...), $blocks);

        // The moved block first, so it claims its cell before anything else can
        // be pushed into it. Everything else in reading order, which makes the
        // result stable: the same input always packs the same way, and a layout
        // that reshuffles on save is one nobody can arrange.
        usort($blocks, static function (array $a, array $b) use ($moved): int {
            if ($moved !== null) {
                if ((string) $a['id'] === (string) $moved) {
                    return -1;
                }

                if ((string) $b['id'] === (string) $moved) {
                    return 1;
                }
            }

            return [$a['y'], $a['x']] <=> [$b['y'], $b['x']];
        });

        $placed = [];

        foreach ($blocks as $block) {
            // Float upward into the first row where nothing is in the way. For
            // the moved block that is its own row, since it was placed first
            // and the grid above it is empty.
            while ($block['y'] > 0 && ! self::collides($block, $placed, ['y' => $block['y'] - 1])) {
                $block['y']--;
            }

            while (self::collides($block, $placed)) {
                $block['y']++;
            }

            $placed[] = $block;
        }

        usort($placed, static fn (array $a, array $b): int => [$a['y'], $a['x']] <=> [$b['y'], $b['x']]);

        return array_values($placed);
    }

    /**
     * A block, forced inside the grid.
     *
     * A width wider than the grid is clamped rather than refused: it arrives
     * from a drag at the right hand edge, and refusing the drop is a worse
     * answer than narrowing the block.
     *
     * @param  array{id: int|string, x: int, y: int, w: int, h: int}  $block
     * @return array{id: int|string, x: int, y: int, w: int, h: int}
     */
    public static function clamp(array $block): array
    {
        $w = max(1, min(self::COLUMNS, (int) $block['w']));
        $h = max(1, (int) $block['h']);
        $x = max(0, min(self::COLUMNS - $w, (int) $block['x']));
        $y = max(0, (int) $block['y']);

        return ['id' => $block['id'], 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h];
    }

    /**
     * Whether a block overlaps anything already placed.
     *
     * @param  array{id: int|string, x: int, y: int, w: int, h: int}  $block
     * @param  list<array{id: int|string, x: int, y: int, w: int, h: int}>  $placed
     * @param  array{y?: int}  $at  Test a different row without moving the block.
     */
    private static function collides(array $block, array $placed, array $at = []): bool
    {
        $y = $at['y'] ?? $block['y'];

        foreach ($placed as $other) {
            if ((string) $other['id'] === (string) $block['id']) {
                continue;
            }

            $apart = $other['x'] >= $block['x'] + $block['w']
                || $block['x'] >= $other['x'] + $other['w']
                || $y + $block['h'] <= $other['y']
                || $y >= $other['y'] + $other['h'];

            if (! $apart) {
                return true;
            }
        }

        return false;
    }

    /**
     * The first row a new block of this size fits on, at the far left.
     *
     * Added at the bottom rather than squeezed into the first gap. A block
     * appearing in the middle of an arrangement somebody has already made is
     * startling, and the bottom is where the eye goes after clicking "add".
     *
     * @param  list<array{id: int|string, x: int, y: int, w: int, h: int}>  $blocks
     */
    public static function nextRow(array $blocks): int
    {
        $bottom = 0;

        foreach ($blocks as $block) {
            $bottom = max($bottom, (int) $block['y'] + (int) $block['h']);
        }

        return $bottom;
    }
}
