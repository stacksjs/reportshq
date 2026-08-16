{{--
    A report, read.

    Read only on purpose, and first: a report that renders correctly and cannot
    be edited is worth more than a builder producing numbers nobody trusts.

    The grid is the same twelve columns the stored layout uses, so what a
    builder drags is what a reader sees. Below the breakpoint the blocks stack
    in reading order rather than compressing to eighty pixels each, which turns
    every title into three clipped letters.
--}}
@extends('reportshq::layout', ['title' => $report->name])

@section('content')
    <header class="rhq-header">
        <h1>{{ $report->name }}</h1>

        @if ($report->description)
            <p class="rhq-lede">{{ $report->description }}</p>
        @endif

        @if ($report->published_at)
            <p class="rhq-meta">Published {{ $report->published_at->format('j M Y') }} &middot; {{ $report->timezone }}</p>
        @else
            <p class="rhq-meta rhq-warn">Not published. This is the draft.</p>
        @endif
    </header>

    @if (empty($blocks))
        <div class="rhq-empty rhq-empty-page">
            <h2>An empty report</h2>
            <p>Nothing has been added to this one yet.</p>
        </div>
    @else
        <div class="rhq-grid">
            @foreach ($blocks as $block)
                <div class="rhq-cell"
                     style="--x: {{ ($block['x'] ?? 0) + 1 }}; --w: {{ $block['w'] ?? 4 }}; --h: {{ $block['h'] ?? 4 }}">
                    @include(ReportsHQ\Laravel\Charts\Presenter::view($block), ReportsHQ\Laravel\Charts\Presenter::data($block))
                </div>
            @endforeach
        </div>
    @endif
@endsection
