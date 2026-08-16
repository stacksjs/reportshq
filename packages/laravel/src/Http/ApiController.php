<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Http;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use ReportsHQ\Laravel\Reports\Builder;
use ReportsHQ\Laravel\Reports\Report;
use ReportsHQ\Laravel\Reports\Runner;
use ReportsHQ\Laravel\Reports\Share;
use ReportsHQ\Laravel\Semantic\Registry;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The reports, as JSON.
 *
 * The front end is stx, which runs on Bun and cannot be rendered from PHP, so
 * the UI is a built client and this is what it talks to. That split is worth
 * more than the server rendering it replaces: the charts, the grid and the
 * builder are then written once and used by anything that speaks HTTP, rather
 * than once in stx and again in Blade with a PHP port of the geometry in
 * between. The second version is always the one that drifts.
 *
 * Shapes here are the ones the stx components already expect: a block carries
 * `series`, `total` and `error`, because that is what a chart component reads,
 * and inventing a second shape for the same data would put a translation layer
 * in the one place this split exists to remove.
 */
final class ApiController
{
    public function index(): JsonResponse
    {
        return response()->json([
            'reports' => Report::query()->orderByDesc('updated_at')->get()
                ->map(fn (Report $report): array => $this->summary($report))->all(),
        ]);
    }

    public function show(Request $request, Runner $runner, string $slug): JsonResponse
    {
        $report = $this->find($slug);

        return response()->json([
            'report' => $this->summary($report),
            'blocks' => $runner->report(
                $report->publishedBlocks(),
                $report->timezone,
                $request->query('from') === null ? null : (string) $request->query('from'),
                $request->query('to') === null ? null : (string) $request->query('to'),
            ),
        ]);
    }

    /**
     * The draft, for the builder.
     *
     * A separate endpoint rather than a flag on the one above, so a client
     * cannot ask for the draft by accident and show somebody's half arranged
     * grid on a shared link.
     */
    public function draft(Runner $runner, string $slug): JsonResponse
    {
        $report = $this->find($slug);

        return response()->json([
            'report' => $this->summary($report),
            'blocks' => $runner->report($report->blocks->map->toSnapshot()->all(), $report->timezone),
        ]);
    }

    /**
     * What the builder may offer, from the registry.
     *
     * The same allowlist the compiler reads, so a panel cannot suggest a field
     * the query would then be refused for using.
     */
    public function schema(Builder $builder): JsonResponse
    {
        return response()->json($builder->choices());
    }

    public function shares(string $slug): JsonResponse
    {
        return response()->json([
            'shares' => $this->find($slug)->shares()->get()
                ->map(fn (Share $share): array => $this->shareSummary($share))->all(),
        ]);
    }

    public function createShare(Request $request, string $slug): JsonResponse
    {
        $report = $this->find($slug);

        $expires = $request->input('expires_in_days');

        $share = Share::create([
            'report_id' => $report->id,
            'token' => Share::newToken(),
            'label' => $request->input('label'),
            'created_by' => $request->user()?->getAuthIdentifier() === null
                ? null
                : (string) $request->user()->getAuthIdentifier(),
            'expires_at' => $expires === null ? null : now()->addDays((int) $expires),
        ]);

        // The token is returned exactly once, here, because this is the moment
        // the link is copied. Afterwards the list shows only its shape.
        return response()->json([
            'share' => $this->shareSummary($share) + ['url' => route('reportshq.shared', $share->token)],
        ], 201);
    }

    public function revokeShare(string $slug, int $share): JsonResponse
    {
        $found = $this->find($slug)->shares()->whereKey($share)->first();

        if ($found === null) {
            throw new NotFoundHttpException('No such link on this report.');
        }

        // Kept rather than deleted, so the list can say a link was turned off
        // and when. A row that vanishes leaves somebody wondering whether they
        // imagined creating it.
        $found->forceFill(['revoked_at' => now()])->save();

        return response()->json(['revoked' => true]);
    }

    /** @return array<string, mixed> */
    private function summary(Report $report): array
    {
        return [
            'id' => $report->id,
            'name' => $report->name,
            'slug' => $report->slug,
            'description' => $report->description,
            'status' => $report->status,
            'timezone' => $report->timezone,
            'published_at' => $report->published_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    private function shareSummary(Share $share): array
    {
        return [
            'id' => $share->id,
            'label' => $share->label,
            // Never the whole token in a list. It is the credential, and a
            // screenshot of the sharing panel should not be one.
            'token_hint' => substr((string) $share->token, 0, 6).'...',
            'live' => $share->isLive(),
            'views' => $share->views,
            'expires_at' => $share->expires_at?->toIso8601String(),
            'revoked_at' => $share->revoked_at?->toIso8601String(),
        ];
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
