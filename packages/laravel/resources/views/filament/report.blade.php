{{--
    A report inside a Filament panel.

    The panel supplies the page chrome, so this is the grid and the stylesheet
    and nothing else. The stylesheet is scoped by its own class names rather
    than resetting anything, so it cannot fight the panel's own CSS.
--}}
<div>
    <style>{!! ReportsHQ\Laravel\Charts\Assets::css() !!}</style>

    <div class="rhq-page" style="padding: 0; max-width: none;">
        @if ($report->description)
            <p class="rhq-lede">{{ $report->description }}</p>
        @endif

        <p class="rhq-downloads">
            <span>Download</span>
            <a href="{{ route('reportshq.download', [$report->slug, 'csv']) }}">CSV</a>
            <a href="{{ route('reportshq.download', [$report->slug, 'xlsx']) }}">XLSX</a>
        </p>

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
    </div>
</div>
