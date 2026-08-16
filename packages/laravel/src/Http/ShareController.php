<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Http;

use Illuminate\Contracts\View\View;
use ReportsHQ\Laravel\Reports\Runner;
use ReportsHQ\Laravel\Reports\Share;

/**
 * A shared report, read by somebody with no account.
 *
 * The only surface in the package that is deliberately unauthenticated, which
 * is why it is its own controller and its own route group: the middleware an
 * application puts in front of the rest must not apply here, and having them
 * share a group is how a share link ends up behind a login and nobody notices
 * until a customer says the link does not work.
 *
 * The published snapshot only. A share link is given to somebody outside, and
 * showing them a draft somebody is in the middle of arranging is the one thing
 * it must never do.
 */
final class ShareController
{
    public function show(Runner $runner, string $token): View
    {
        $share = Share::query()->where('token', $token)->first();

        // One page for an unknown token and a dead one. A different answer
        // tells whoever is trying tokens which of their guesses was closer.
        if ($share === null) {
            return view('reportshq::share-gone', ['reason' => 'This link is not valid.']);
        }

        if (! $share->isLive()) {
            return view('reportshq::share-gone', ['reason' => $share->deadBecause() ?? 'This link is no longer available.']);
        }

        $report = $share->report;

        if ($report === null) {
            return view('reportshq::share-gone', ['reason' => 'The report behind this link has been deleted.']);
        }

        // Counted rather than logged. How often a link is opened is useful to
        // whoever shared it; who opened it is exactly the thing a link with no
        // account exists to avoid recording.
        $share->forceFill([
            'views' => $share->views + 1,
            'last_viewed_at' => now(),
        ])->save();

        return view('reportshq::share', [
            'report' => $report,
            'blocks' => $runner->report($report->publishedBlocks(), $report->timezone),
        ]);
    }
}
