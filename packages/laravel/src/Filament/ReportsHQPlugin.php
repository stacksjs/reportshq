<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Filament;

use Filament\Contracts\Plugin;
use Filament\Panel;

/**
 * The reports, inside a Filament panel.
 *
 * Deliberately thin. It registers two pages and does nothing else, and the
 * pages render the same Blade views the standalone routes serve. The moment
 * this holds logic of its own, an application without Filament has a second
 * class version of the product, and most Laravel applications do not run
 * Filament.
 *
 * Filament is a `suggest` rather than a `require`. This file is only ever
 * loaded by an application that already has it, and referencing its classes
 * costs nothing until then.
 *
 * ```php
 * // app/Providers/Filament/AdminPanelProvider.php
 * ->plugin(\ReportsHQ\Laravel\Filament\ReportsHQPlugin::make())
 * ```
 */
class ReportsHQPlugin implements Plugin
{
    public function getId(): string
    {
        return 'reportshq';
    }

    public function register(Panel $panel): void
    {
        $panel->pages([
            ReportsPage::class,
            ReportPage::class,
        ]);
    }

    public function boot(Panel $panel): void
    {
        // Nothing. The pages carry their own views and the container already
        // holds the runner, so there is nothing to arrange at boot.
    }

    public static function make(): static
    {
        return app(static::class);
    }
}
