<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Illuminate\Support\Str;
use ReportsHQ\Laravel\Semantic\Registry;

/**
 * Everything a builder does to a report, on the server.
 *
 * The browser drags rectangles and this decides what that meant. Keeping the
 * decisions here rather than in the client script is what makes them testable
 * at all, and it is also the only way the two can be made to agree: the client
 * packs for the preview, this packs for the record, and the response carries
 * the canonical layout back so a disagreement is resolved rather than stored.
 *
 * Nothing here authorises anything. Who may edit a report is the application's
 * question, answered by the middleware in front of the routes, because this
 * package cannot know which of your users may build a report totalling
 * everybody's orders.
 */
final class Builder
{
    public function __construct(private readonly Registry $registry) {}

    /**
     * A new report, with a slug nobody else is using.
     */
    public function create(string $name, ?string $ownerId = null, string $timezone = 'UTC'): Report
    {
        return Report::create([
            'name' => $name === '' ? 'Untitled report' : $name,
            'slug' => $this->slug($name),
            'owner_id' => $ownerId,
            'timezone' => $timezone,
        ]);
    }

    /**
     * Add a block at the bottom of the grid.
     *
     * Sized by kind rather than uniformly: a big number in a twelve wide block
     * is a number floating in an acre of nothing, and a table three columns
     * wide clips every label. These are the sizes the hosted templates settled
     * on after being looked at.
     */
    public function addBlock(Report $report, string $kind): Block
    {
        if (! in_array($kind, Block::KINDS, true)) {
            throw new \InvalidArgumentException("There is no '{$kind}' block. Known: ".implode(', ', Block::KINDS).'.');
        }

        [$w, $h] = match ($kind) {
            'big_number' => [3, 3],
            'note' => [12, 1],
            'donut', 'table' => [4, 5],
            default => [8, 5],
        };

        return Block::create([
            'report_id' => $report->id,
            'kind' => $kind,
            'x' => 0,
            'y' => Layout::nextRow($this->rectangles($report)),
            'w' => $w,
            'h' => $h,
            // A sensible first query, so a new block shows a number rather than
            // an error. The first model with a count is the least surprising
            // thing it could be, and anything else is a guess about what
            // somebody meant to build.
            'query' => $kind === 'note' ? null : $this->firstQuery(),
        ]);
    }

    /**
     * Store a dragged layout, packed.
     *
     * @param  list<array{id: int|string, x: int, y: int, w: int, h: int}>  $layout
     * @return list<array{id: int, x: int, y: int, w: int, h: int}> The canonical positions.
     */
    public function saveLayout(Report $report, array $layout, int|string|null $moved = null): array
    {
        $known = $report->blocks()->pluck('id')->map(static fn ($id): string => (string) $id)->all();

        // Only blocks of this report, and only ones that exist. A layout naming
        // somebody else's block is a request to move it, and the id came from
        // the browser.
        $layout = array_values(array_filter(
            $layout,
            static fn (array $block): bool => in_array((string) ($block['id'] ?? ''), $known, true),
        ));

        $packed = Layout::pack($layout, $moved);

        foreach ($packed as $block) {
            Block::query()->whereKey($block['id'])->where('report_id', $report->id)->update([
                'x' => $block['x'],
                'y' => $block['y'],
                'w' => $block['w'],
                'h' => $block['h'],
            ]);
        }

        return $packed;
    }

    /**
     * Store a block's title and query.
     *
     * The query is stored whether or not it currently resolves. A registry
     * changes, and a block that could not be saved while its measure was
     * temporarily missing would be a block somebody has to rebuild; the viewer
     * already says which name is gone.
     *
     * @param  array<string, mixed>  $changes
     */
    public function saveBlock(Block $block, array $changes): Block
    {
        $block->fill(array_intersect_key($changes, array_flip(['title', 'body', 'query', 'kind'])));

        if ($block->isDirty('kind') && ! in_array($block->kind, Block::KINDS, true)) {
            throw new \InvalidArgumentException("There is no '{$block->kind}' block.");
        }

        $block->save();

        return $block;
    }

    /**
     * Remove a block, and close the hole it leaves.
     */
    public function removeBlock(Block $block): void
    {
        $report = $block->report;
        $block->delete();

        if ($report !== null) {
            $this->saveLayout($report, $this->rectangles($report));
        }
    }

    /**
     * Publish, which is what a reader will see.
     *
     * A revision every time, because a publish is the moment somebody decided
     * the report was right and is therefore the moment worth being able to
     * return to.
     */
    public function publish(Report $report, ?string $ownerId = null): Revision
    {
        $revision = Revision::create([
            'report_id' => $report->id,
            'reason' => 'publish',
            'owner_id' => $ownerId,
            'snapshot' => ['blocks' => $report->blocks->map->toSnapshot()->all()],
            'created_at' => now(),
        ]);

        $report->forceFill(['status' => 'published', 'published_at' => now()])->save();

        return $revision;
    }

    /**
     * The choices a builder's settings panel offers, from the registry.
     *
     * Read from the same allowlist the compiler reads, so the panel cannot
     * offer a field that a query would then be refused for using. A builder
     * that lists something unusable is a builder that teaches people its own
     * error messages.
     *
     * @return array<string, mixed>
     */
    public function choices(): array
    {
        $models = [];

        foreach ($this->registry->models as $model) {
            $models[] = [
                'key' => $model->key,
                'label' => $model->label,
                'grain' => $model->grain,
                'measures' => array_values(array_map(static fn ($measure): array => [
                    'key' => $measure->key,
                    'label' => $measure->label,
                ], $model->measures)),
                'dimensions' => array_values(array_map(static fn ($dimension): array => [
                    'key' => $dimension->key,
                    'label' => $dimension->label,
                    'type' => $dimension->type,
                    'model' => $model->key,
                ], $model->dimensions)),
            ];
        }

        return [
            'models' => $models,
            // Every dimension in the registry, flat, since a block may group by
            // one on a related model and the panel should offer them all. The
            // compiler refuses the pairings that would multiply rows, and that
            // refusal explains itself, which is a better teacher than a list
            // that quietly omits them.
            'dimensions' => array_merge(...array_map(
                static fn (array $model): array => $model['dimensions'],
                $models,
            ) ?: [[]]),
            'grains' => ['hour', 'day', 'week', 'month'],
            'kinds' => Block::KINDS,
        ];
    }

    /**
     * The first model with a measure, as a starting query.
     *
     * @return array<string, mixed>|null
     */
    private function firstQuery(): ?array
    {
        foreach ($this->registry->models as $model) {
            foreach ($model->measures as $measure) {
                return ['model' => $model->key, 'measure' => $measure->key];
            }
        }

        return null;
    }

    /**
     * @return list<array{id: int|string, x: int, y: int, w: int, h: int}>
     */
    private function rectangles(Report $report): array
    {
        return $report->blocks()->get()->map(static fn (Block $block): array => [
            'id' => $block->id,
            'x' => $block->x,
            'y' => $block->y,
            'w' => $block->w,
            'h' => $block->h,
        ])->all();
    }

    /** A slug nobody else is using, since it is how a report is addressed. */
    private function slug(string $name): string
    {
        $base = Str::slug($name) ?: 'report';
        $slug = $base;
        $suffix = 2;

        while (Report::withTrashed()->where('slug', $slug)->exists()) {
            $slug = "{$base}-{$suffix}";
            $suffix++;
        }

        return $slug;
    }
}
