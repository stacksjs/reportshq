<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One tile on the grid.
 *
 * `query` is stored as names rather than as resolved objects, so a report
 * written today still opens after somebody renames a measure in the config:
 * it says which name is gone instead of quietly answering a narrower question.
 */
class Block extends Model
{
    use HasFactory;

    public const KINDS = ['big_number', 'line', 'area', 'bar', 'donut', 'table', 'funnel', 'heatmap', 'note'];

    protected $table = 'reportshq_blocks';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'query' => 'array',
            'x' => 'integer',
            'y' => 'integer',
            'w' => 'integer',
            'h' => 'integer',
        ];
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class, 'report_id');
    }

    /** A note carries prose and asks nothing of the database. */
    public function isNote(): bool
    {
        return $this->kind === 'note';
    }

    /**
     * The block as it goes into a revision.
     *
     * Written out by hand rather than `toArray()`, so a column added later
     * does not silently start appearing in every stored snapshot, and so a
     * snapshot restored from an older version has a knowable shape.
     *
     * @return array<string, mixed>
     */
    public function toSnapshot(): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'title' => $this->title,
            'query' => $this->query,
            'body' => $this->body,
            'x' => $this->x,
            'y' => $this->y,
            'w' => $this->w,
            'h' => $this->h,
        ];
    }
}
