{{--
    A shared report.

    No navigation, no builder, no links back into the application: the reader
    has no account and nothing here should suggest they might.
--}}
@extends('reportshq::layout', ['title' => $report->name])

@section('content')
    <header class="rhq-header">
        <h1>{{ $report->name }}</h1>
        @if ($report->description)<p class="rhq-lede">{{ $report->description }}</p>@endif
        @if ($report->published_at)
            <p class="rhq-meta">Published {{ $report->published_at->format('j M Y') }} &middot; {{ $report->timezone }}</p>
        @endif
    </header>

    <div class="rhq-grid">
        @foreach ($blocks as $block)
            <div class="rhq-cell" style="--x: {{ ($block['x'] ?? 0) + 1 }}; --w: {{ $block['w'] ?? 4 }}; --h: {{ $block['h'] ?? 4 }}">
                {!! ReportsHQ\Laravel\Charts\Elements::render($block) !!}
            </div>
        @endforeach
    </div>
@endsection
