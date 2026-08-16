<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A report, as stored in the application's own database.
 *
 * The published snapshot and the draft are the same row: `status` says which
 * one a reader gets, and the blocks are the draft. That is the simplest thing
 * that works while the viewer reads a revision rather than the live blocks,
 * and it is worth being explicit that a viewer reading `$report->blocks` would
 * be reading somebody's unfinished arrangement.
 */
class Report extends Model
{
    use HasFactory;
    use SoftDeletes;

    protected $table = 'reportshq_reports';

    protected $guarded = [];

    /**
     * Mirrored from the migration's defaults on purpose.
     *
     * A database default only applies on insert, so `Report::create([...])`
     * hands back an object whose status is null until somebody refreshes it,
     * and code that checks it immediately gets the wrong answer. Declaring them
     * here means the object is correct the moment it exists.
     */
    protected $attributes = [
        'status' => 'draft',
        'timezone' => 'UTC',
    ];

    protected function casts(): array
    {
        return [
            'published_at' => 'datetime',
        ];
    }

    public function blocks(): HasMany
    {
        // Grid order, which is reading order: down the page, then across.
        return $this->hasMany(Block::class, 'report_id')->orderBy('y')->orderBy('x');
    }

    public function revisions(): HasMany
    {
        return $this->hasMany(Revision::class, 'report_id')->latest('created_at');
    }

    public function isPublished(): bool
    {
        return $this->status === 'published';
    }

    /**
     * The blocks a reader should see.
     *
     * The last published revision, not the live rows. A report is arranged
     * over minutes and read in seconds, and without this every save would be
     * visible to everybody the instant it happened, including the half of a
     * drag that has not landed yet.
     *
     * Falls back to the live blocks only when nothing has ever been published,
     * which is the builder previewing its own draft.
     *
     * @return list<array<string, mixed>>
     */
    public function publishedBlocks(): array
    {
        $revision = $this->revisions()->first();

        if ($revision === null) {
            return $this->blocks->map(static fn (Block $block): array => $block->toSnapshot())->all();
        }

        return $revision->snapshotBlocks();
    }
}
