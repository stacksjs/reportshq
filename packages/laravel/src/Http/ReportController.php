<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Http;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use ReportsHQ\Laravel\Reports\Export;
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
        $report = $this->find($slug);

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

    /**
     * The report as a spreadsheet.
     *
     * Streamed straight out rather than written somewhere and linked. The
     * hosted product stored an export, signed a URL for it and expired the
     * thing after an hour, all of which exists because the file lived on a
     * different machine from the reader. Here it does not: the numbers are one
     * query away, so generating on demand is simpler, has nothing to clean up,
     * and cannot serve somebody a stale copy.
     */
    public function download(Request $request, Runner $runner, string $slug, string $format): Response
    {
        if (! in_array($format, ['csv', 'xlsx'], true)) {
            throw new NotFoundHttpException("Reports export as csv or xlsx, not '{$format}'.");
        }

        $report = $this->find($slug);

        $blocks = $runner->report(
            $report->publishedBlocks(),
            $report->timezone,
            $request->query('from') === null ? null : (string) $request->query('from'),
            $request->query('to') === null ? null : (string) $request->query('to'),
        );

        $bytes = $format === 'csv' ? Export::csv($blocks) : Export::xlsx($blocks);

        return response($bytes, 200, [
            'Content-Type' => $format === 'csv'
                ? 'text/csv; charset=utf-8'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Length' => (string) strlen($bytes),
            'Content-Disposition' => 'attachment; filename="'.Export::filename($report->name, $format).'"',
        ]);
    }

    private function find(string $slug): Report
    {
        $report = Report::query()->where('slug', $slug)->first();

        if ($report === null) {
            throw new NotFoundHttpException("No report called '{$slug}'.");
        }

        return $report;
    }
}
