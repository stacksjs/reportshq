<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Console;

use Illuminate\Console\Command;
use ReportsHQ\Laravel\Reports\Delivery;

/**
 * The hourly runner.
 *
 * Registered by the package but scheduled by the application, which is the
 * right way round: an application knows whether it has a scheduler running at
 * all, and a package that adds itself to one is a package that sends email
 * somebody did not ask for.
 *
 *     // routes/console.php
 *     Schedule::command('reportshq:send')->hourly();
 */
class SendScheduledReports extends Command
{
    protected $signature = 'reportshq:send';

    protected $description = 'Email the reports whose schedule is due';

    public function handle(Delivery $delivery): int
    {
        $sent = $delivery->run();

        foreach ($sent as $entry) {
            $this->line("schedule {$entry['schedule']}: queued for {$entry['recipients']} recipients");
        }

        $this->info($sent === [] ? 'Nothing due.' : count($sent).' report(s) queued.');

        return self::SUCCESS;
    }
}
