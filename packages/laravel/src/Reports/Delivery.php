<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Illuminate\Support\Facades\Mail;
use ReportsHQ\Laravel\Mail\ScheduledReport;

/**
 * Sending the reports that are due.
 *
 * Called from a console command the application schedules hourly. Hourly is the
 * finest a cadence needs, and running it more often costs one indexed query per
 * run and changes nothing, since `last_run_at` is what decides.
 */
final class Delivery
{
    public function __construct(private readonly Runner $runner) {}

    /**
     * @return list<array{schedule: int, recipients: int}> What was sent.
     */
    public function run(?\DateTimeInterface $now = null): array
    {
        $now ??= now();
        $sent = [];

        $schedules = Schedule::query()->with('report')->where('enabled', true)->get();

        foreach ($schedules as $schedule) {
            if ($schedule->report === null || ! $schedule->isDue($now)) {
                continue;
            }

            $recipients = $schedule->recipientList();

            if ($recipients === []) {
                continue;
            }

            // Marked before sending, not after. A crash between the two sends
            // nothing and looks like a missed day; the other order sends the
            // same report to everybody twice, and that is the one people
            // notice and complain about.
            $schedule->forceFill(['last_run_at' => $now])->save();

            $blocks = $this->runner->report(
                $schedule->report->publishedBlocks(),
                $schedule->report->timezone,
            );

            Mail::to($recipients)->queue(new ScheduledReport($schedule->report, $blocks, $schedule->format));

            $sent[] = ['schedule' => (int) $schedule->id, 'recipients' => count($recipients)];
        }

        return $sent;
    }
}
