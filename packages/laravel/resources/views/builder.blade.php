{{--
    Arranging a report.

    Drag a block to move it, drag its corner to resize, arrow keys to nudge.
    Every gesture writes through the same endpoint and the server answers with
    the canonical layout, so the browser's optimistic packing is corrected
    rather than trusted.
--}}
@extends('reportshq::layout', ['title' => $report->name.' - editing'])

@section('content')
    <header class="rhq-header rhq-header-bar">
        <div>
            <h1>{{ $report->name }}</h1>
            <p class="rhq-meta">
                <span id="rhq-state">Saved</span>
                <span id="rhq-drafted" class="rhq-warn" @if ($report->isPublished()) hidden @endif>Not published</span>
            </p>
        </div>

        <div class="rhq-actions">
            <a class="rhq-button" href="{{ route('reportshq.show', $report->slug) }}">View</a>
            <button type="button" class="rhq-button rhq-button-primary" id="rhq-publish">Publish</button>
        </div>
    </header>

    <div class="rhq-builder">
        <aside class="rhq-palette">
            <p class="rhq-palette-title">Add a block</p>

            @foreach ($choices['kinds'] as $kind)
                <button type="button" class="rhq-add" data-kind="{{ $kind }}">
                    {{ ucfirst(str_replace('_', ' ', $kind)) }}
                </button>
            @endforeach

            <p class="rhq-hint">
                Drag a block to move it, drag its bottom right corner to resize. Arrow keys move the
                selected block and Delete removes it.
            </p>

            <p class="rhq-hint rhq-hint-narrow">
                Arranging needs a wider screen. Below is the report as it stands, and you can still add
                blocks and publish from here.
            </p>
        </aside>

        <section>
            @if (empty($blocks))
                <div class="rhq-empty rhq-empty-page">
                    <h2>An empty grid</h2>
                    <p>Add a block from the left. Every block reads this application's own data, so it
                       shows real numbers straight away.</p>
                </div>
            @else
                <div id="rhq-grid" class="rhq-grid rhq-grid-editing">
                    @foreach ($blocks as $block)
                        <article class="rhq-cell rhq-tile"
                                 tabindex="0"
                                 data-id="{{ $block['id'] }}"
                                 data-kind="{{ $block['kind'] }}"
                                 data-x="{{ $block['x'] }}" data-y="{{ $block['y'] }}"
                                 data-w="{{ $block['w'] }}" data-h="{{ $block['h'] }}"
                                 data-query="{{ json_encode($block['query'] ?? new stdClass) }}"
                                 style="--x: {{ $block['x'] + 1 }}; --w: {{ $block['w'] }}; --h: {{ $block['h'] }}"
                                 aria-label="{{ $block['title'] ?: ucfirst(str_replace('_', ' ', $block['kind'])) }}, column {{ $block['x'] }}, row {{ $block['y'] }}">
                            @include(ReportsHQ\Laravel\Charts\Presenter::view($block), ReportsHQ\Laravel\Charts\Presenter::data($block))
                            <span class="rhq-resize" aria-hidden="true"></span>
                        </article>
                    @endforeach
                </div>
            @endif
        </section>

        <aside class="rhq-panel" id="rhq-panel" hidden>
            <div class="rhq-panel-head">
                <p class="rhq-palette-title">Block</p>
                <button type="button" class="rhq-icon" id="rhq-close" aria-label="Close">&times;</button>
            </div>

            <label class="rhq-field">
                <span>Title</span>
                <input type="text" id="rhq-title" autocomplete="off">
            </label>

            <label class="rhq-field" id="rhq-body-field" hidden>
                <span>Text</span>
                <textarea id="rhq-body" rows="4"></textarea>
            </label>

            <div class="rhq-query">
                <label class="rhq-field">
                    <span>Measure</span>
                    <select id="rhq-measure"></select>
                </label>

                <label class="rhq-field">
                    <span>Group by</span>
                    <select id="rhq-dimension"></select>
                </label>

                <label class="rhq-field">
                    <span>Over time</span>
                    <select id="rhq-time"></select>
                </label>

                <label class="rhq-field" id="rhq-grain-field">
                    <span>Bucket</span>
                    <select id="rhq-grain"></select>
                </label>
            </div>

            <button type="button" class="rhq-button rhq-button-danger" id="rhq-remove">Remove this block</button>
        </aside>
    </div>

    <script id="rhq-choices" type="application/json">@json($choices)</script>
    <script>{!! ReportsHQ\Laravel\Charts\Assets::builderScript() !!}</script>
@endsection
