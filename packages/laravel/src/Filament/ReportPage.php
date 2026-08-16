<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Filament;

use Filament\Pages\Page;
use Filament\Panel;
use ReportsHQ\Laravel\Reports\Report;
use ReportsHQ\Laravel\Reports\Runner;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * One report, inside the panel.
 *
 * Reading only. Arranging happens on the standalone route, because the builder
 * wants the width of a page rather than the width of a panel's content area,
 * and because duplicating the grid script into a Livewire component is how the
 * two versions start to drift.
 */
class ReportPage extends Page
{
    protected static bool $shouldRegisterNavigation = false;

    protected static ?string $slug = null;

    public static function getSlug(?Panel $panel = null): string
    {
        return config('reportshq.filament.slug', 'reportshq').'/{slug}';
    }

    protected string $view = 'reportshq::filament.report';

    /**
     * Named `reportSlug`, not `slug`.
     *
     * Filament already uses a static `$slug` for the page's own route, and a
     * public property of the same name is a fatal redeclaration rather than a
     * shadow, so the class will not even parse.
     */
    public ?string $reportSlug = null;

    public function mount(string $slug): void
    {
        $this->reportSlug = $slug;
    }

    public function getTitle(): string
    {
        return $this->report()->name;
    }

    public function getViewData(): array
    {
        $report = $this->report();

        return [
            'report' => $report,
            'blocks' => app(Runner::class)->report($report->publishedBlocks(), $report->timezone),
        ];
    }

    private function report(): Report
    {
        $report = Report::query()->where('slug', $this->reportSlug)->first();

        if ($report === null) {
            throw new NotFoundHttpException("No report called '{$this->reportSlug}'.");
        }

        return $report;
    }
}
