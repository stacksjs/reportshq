<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Stacks\Spreadsheets\Sheet;
use Stacks\Spreadsheets\Spreadsheet;

/**
 * A report, as a spreadsheet.
 *
 * Two shapes for two formats, and the difference is not an oversight.
 *
 * The xlsx gets a tab per block, named after the block, because that is what
 * somebody opening a workbook expects to find and because filtering a column to
 * read one chart is work a tab does for free.
 *
 * The CSV stays long: block, point, series, value, one row per data point. It
 * has no word for a tab, and one flat table a pivot can read beats several
 * stacked in a file with blank lines between them.
 *
 * A block that would not run contributes a row saying so rather than nothing.
 * A silent gap in an export is indistinguishable from a quiet week, and the
 * person reading the file is not the person who saw the error on the tile.
 */
final class Export
{
    public const HEADINGS = ['Block', 'Point', 'Series', 'Value'];

    /** What to call a block nobody named. The same words the palette uses. */
    private const LABELS = [
        'big_number' => 'Big number',
        'line' => 'Line',
        'area' => 'Area',
        'bar' => 'Bar',
        'donut' => 'Donut',
        'table' => 'Table',
        'funnel' => 'Funnel',
        'heatmap' => 'Heatmap',
    ];

    /**
     * @param  list<array<string, mixed>>  $blocks  Rendered blocks, from the Runner.
     */
    public static function csv(array $blocks): string
    {
        $rows = [];

        foreach ($blocks as $block) {
            foreach (self::rows($block) as $row) {
                $rows[] = $row;
            }
        }

        return Spreadsheet::csv(new Sheet('Report', self::HEADINGS, $rows));
    }

    /**
     * @param  list<array<string, mixed>>  $blocks
     */
    public static function xlsx(array $blocks): string
    {
        $sheets = [];

        foreach ($blocks as $block) {
            if (($block['kind'] ?? null) === 'note') {
                continue;
            }

            $rows = [];

            foreach (self::rows($block) as $row) {
                // The block column goes: the tab already says which block this
                // is, and repeating it down every row is a column of one value.
                array_shift($row);
                $rows[] = $row;
            }

            $sheets[] = new Sheet(self::title($block), array_slice(self::HEADINGS, 1), $rows);
        }

        // A workbook with no sheets will not open, and a report of nothing but
        // notes is a real thing to export.
        return Spreadsheet::xlsx($sheets === [] ? [new Sheet('Report', self::HEADINGS, [])] : $sheets);
    }

    /** A filename somebody can find again in a downloads folder. */
    public static function filename(string $name, string $format, ?\DateTimeInterface $at = null): string
    {
        $slug = strtolower(trim(preg_replace('/[^\w\s-]/', '', $name) ?? ''));
        $slug = trim(preg_replace('/[\s_]+/', '-', $slug) ?? '', '-');
        $slug = substr($slug === '' ? 'report' : $slug, 0, 60);

        return $slug.'-'.($at ?? new \DateTimeImmutable)->format('Y-m-d').'.'.$format;
    }

    /**
     * One block, flattened.
     *
     * @param  array<string, mixed>  $block
     * @return list<list<string|int|float|null>>
     */
    private static function rows(array $block): array
    {
        $title = self::title($block);

        if (($block['error'] ?? null) !== null) {
            return [[$title, 'error', 'error', 0]];
        }

        // A note has no numbers. Its prose in a column of values would break
        // every formula somebody wrote against the sheet, so it carries its own
        // row with the text where a series name would be.
        if (($block['kind'] ?? null) === 'note') {
            return [[$title, '', (string) ($block['body'] ?? ''), 0]];
        }

        $rows = [];

        foreach ($block['series'] ?? [] as $series) {
            foreach ($series['points'] ?? [] as $point) {
                $rows[] = [$title, (string) ($point['t'] ?? ''), (string) $series['key'], $point['value']];
            }
        }

        return $rows;
    }

    /** @param array<string, mixed> $block */
    private static function title(array $block): string
    {
        $title = (string) ($block['title'] ?? '');

        if ($title !== '') {
            return $title;
        }

        return self::LABELS[(string) ($block['kind'] ?? '')] ?? 'Block';
    }
}
