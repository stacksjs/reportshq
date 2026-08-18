<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Filament;

use Filament\Pages\Page;
use Filament\Panel;
use ReportsHQ\Laravel\Reports\Report;

/**
 * The list, in the panel's navigation.
 *
 * A plain page rather than a Filament resource. A resource brings a table
 * builder, filters and bulk actions for a model somebody edits row by row, and
 * a report is not edited that way: it is arranged on a grid. Using a resource
 * here would inherit a great deal of behaviour to then hide.
 */
class ReportsPage extends Page
{
    protected static ?string $navigationLabel = 'Reports';

    protected static ?string $title = 'Reports';

    /**
     * Configurable, and not defaulting to `reports`.
     *
     * A package claiming a fixed slug collides with whatever the application
     * already has there, and Filament resolves that by first registration
     * rather than by complaining: EasyOTC has its own Reports page, and this
     * one simply lost. Defaulting to the package's own name means a collision
     * takes a deliberate act, and the config is there for an application that
     * wants the nicer path and knows it is free.
     */
    protected static ?string $slug = null;

    public static function getSlug(?Panel $panel = null): string
    {
        return (string) config('reportshq.filament.slug', 'reportshq');
    }

    /**
     * Whether this caller may see the reports.
     *
     * Filament's default is true for anybody the panel admits, and a panel
     * usually admits more people than a report should: an agent or a carrier
     * admin signing into the same panel could read a total covering every
     * carrier. The package cannot know which of an application's roles that
     * describes, so it asks the application — see ReportsHQPlugin::authorize().
     */
    public static function canAccess(): bool
    {
        return ReportsHQPlugin::allows();
    }

    protected string $view = 'reportshq::filament.index';

    public function getViewData(): array
    {
        return ['reports' => Report::query()->orderByDesc('updated_at')->get()];
    }
}
