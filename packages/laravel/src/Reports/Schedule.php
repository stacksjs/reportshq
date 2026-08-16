<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A report, emailed on a cadence.
 *
 * `last_run_at` is the only defence against sending twice, and it is written
 * before the mail goes rather than after. A crash between the two sends nothing
 * and looks like a missed day; a crash the other way round sends the same
 * report to everybody again, and the second is the one people notice.
 */
class Schedule extends Model
{
    public const CADENCES = ['daily', 'weekly', 'monthly'];

    protected $table = 'reportshq_schedules';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'hour' => 'integer',
            'last_run_at' => 'datetime',
        ];
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class, 'report_id');
    }

    /** @return list<string> */
    public function recipientList(): array
    {
        return array_values(array_filter(array_map('trim', explode(',', (string) $this->recipients))));
    }

    /**
     * Whether this is due, read in the report's own timezone.
     *
     * The zone matters more here than anywhere else in the product: a weekly
     * report set for Monday at eight is a promise about somebody's morning, and
     * computing it in UTC delivers it on Sunday evening for half the world.
     */
    public function isDue(\DateTimeInterface $now): bool
    {
        if (! $this->enabled) {
            return false;
        }

        $zone = new \DateTimeZone((string) ($this->report?->timezone ?? 'UTC'));
        $local = \DateTimeImmutable::createFromInterface($now)->setTimezone($zone);

        if ((int) $local->format('G') < $this->hour) {
            return false;
        }

        $shouldRun = match ($this->cadence) {
            'weekly' => $local->format('N') === '1',
            'monthly' => $local->format('j') === '1',
            default => true,
        };

        if (! $shouldRun) {
            return false;
        }

        if ($this->last_run_at === null) {
            return true;
        }

        // Same local day means it has already gone. Comparing dates rather than
        // an interval is what makes an hourly runner idempotent without needing
        // to know how often it runs.
        return \DateTimeImmutable::createFromInterface($this->last_run_at)
            ->setTimezone($zone)->format('Y-m-d') !== $local->format('Y-m-d');
    }
}
