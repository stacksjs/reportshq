<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Http;

use Illuminate\Contracts\View\View;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use ReportsHQ\Laravel\Reports\Builder;
use ReportsHQ\Laravel\Reports\Report;
use ReportsHQ\Laravel\Reports\Runner;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Arranging a report.
 *
 * Every write goes through Builder, which packs the grid and decides what a
 * drag meant, and every response carries the canonical layout back. That is
 * what stops the browser and the database disagreeing: the client packs
 * optimistically so a drag feels immediate, and the server's answer is the one
 * that is true.
 *
 * Authorisation is the application's, through the middleware in front of these
 * routes. This package cannot know who may build a report totalling everybody's
 * orders, and a default that guessed would be worse than one that says so.
 */
final class BuilderController
{
    public function edit(Request $request, Builder $builder, Runner $runner, string $slug): View
    {
        $report = $this->find($slug);

        // The live blocks, not the published snapshot: this is the draft, and
        // seeing what a reader sees while arranging would make every change
        // invisible until publish.
        $blocks = $runner->report(
            $report->blocks->map->toSnapshot()->all(),
            $report->timezone,
        );

        return view('reportshq::builder', [
            'report' => $report,
            'blocks' => $blocks,
            'choices' => $builder->choices(),
        ]);
    }

    public function store(Request $request, Builder $builder): RedirectResponse
    {
        $report = $builder->create(
            (string) $request->input('name', 'Untitled report'),
            $request->user()?->getAuthIdentifier() === null ? null : (string) $request->user()->getAuthIdentifier(),
        );

        return redirect()->route('reportshq.edit', $report->slug);
    }

    public function addBlock(Request $request, Builder $builder, string $slug): JsonResponse
    {
        $block = $builder->addBlock($this->find($slug), (string) $request->input('kind', 'big_number'));

        return response()->json(['block' => $block->toSnapshot()], 201);
    }

    public function saveLayout(Request $request, Builder $builder, string $slug): JsonResponse
    {
        $layout = $request->input('layout');

        if (! is_array($layout)) {
            return response()->json(['message' => 'A layout is a list of blocks.'], 422);
        }

        $packed = $builder->saveLayout(
            $this->find($slug),
            array_map(static fn ($block): array => [
                'id' => $block['id'] ?? 0,
                'x' => (int) ($block['x'] ?? 0),
                'y' => (int) ($block['y'] ?? 0),
                'w' => (int) ($block['w'] ?? 1),
                'h' => (int) ($block['h'] ?? 1),
            ], array_values(array_filter($layout, 'is_array'))),
            $request->input('moved'),
        );

        // The canonical positions, so a client that packed differently corrects
        // itself rather than storing its own answer.
        return response()->json(['layout' => $packed]);
    }

    public function saveBlock(Request $request, Builder $builder, string $slug, int $blockId): JsonResponse
    {
        $report = $this->find($slug);
        $block = $report->blocks()->whereKey($blockId)->first();

        if ($block === null) {
            throw new NotFoundHttpException('No such block on this report.');
        }

        $builder->saveBlock($block, [
            'title' => $request->input('title'),
            'body' => $request->input('body'),
            'query' => $request->input('query'),
        ]);

        return response()->json(['block' => $block->fresh()?->toSnapshot()]);
    }

    public function removeBlock(Builder $builder, string $slug, int $blockId): JsonResponse
    {
        $block = $this->find($slug)->blocks()->whereKey($blockId)->first();

        if ($block === null) {
            throw new NotFoundHttpException('No such block on this report.');
        }

        $builder->removeBlock($block);

        return response()->json(['removed' => true]);
    }

    public function publish(Request $request, Builder $builder, string $slug): JsonResponse
    {
        $report = $this->find($slug);

        $builder->publish(
            $report,
            $request->user()?->getAuthIdentifier() === null ? null : (string) $request->user()->getAuthIdentifier(),
        );

        return response()->json(['published' => true, 'at' => $report->fresh()?->published_at?->toIso8601String()]);
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
