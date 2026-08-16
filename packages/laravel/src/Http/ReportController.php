<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Http;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;
use ReportsHQ\Laravel\Reports\Report;
use ReportsHQ\Laravel\Reports\Runner;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Reading a report.
 *
 * Read only, deliberately and for now. A report that renders correctly and
 * cannot be edited is worth more than a builder producing numbers nobody
 * trusts, so this ships before the arranging does.
 *
 * There is no authorisation here beyond the middleware an application puts in
 * front of the routes, and that is stated rather than implied: this package
 * cannot know which of your users may see a total of everybody's orders, and
 * guessing would be worse than saying so. `reportshq.middleware` is where an
 * application answers it, and the default is `web` plus nothing, which is the
 * honest default for a package that is mounted knowingly.
 */
final class ReportController
{
    public function index(): Responsable|View
    {
        return view('reportshq::index', [
            'reports' => Report::query()->orderByDesc('updated_at')->get(),
        ]);
    }

    public function show(Request $request, Runner $runner, string $slug): View
    {
        $report = Report::query()->where('slug', $slug)->first();

        if ($report === null) {
            throw new NotFoundHttpException("No report called '{$slug}'.");
        }

        // The report's own zone, never the reader's. "Yesterday" has to mean
        // the same day for everybody looking at the same numbers, or two people
        // comparing notes on a call disagree about a total neither has
        // mistyped.
        $blocks = $runner->report(
            $report->publishedBlocks(),
            $report->timezone,
            $request->query('from') === null ? null : (string) $request->query('from'),
            $request->query('to') === null ? null : (string) $request->query('to'),
        );

        return view('reportshq::report', ['report' => $report, 'blocks' => $blocks]);
    }
}
