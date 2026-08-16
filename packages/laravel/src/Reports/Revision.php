<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What a report looked like at a moment somebody cared about.
 *
 * Written on publish, on a template upgrade, and before a restore. The last
 * one matters most: restoring is destructive, and a restore that cannot itself
 * be undone is a worse feature than no restore at all.
 */
class Revision extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'reportshq_revisions';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'snapshot' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class, 'report_id');
    }

    /**
     * The blocks this revision holds.
     *
     * @return list<array<string, mixed>>
     */
    public function snapshotBlocks(): array
    {
        $blocks = $this->snapshot['blocks'] ?? [];

        return is_array($blocks) ? array_values($blocks) : [];
    }
}
