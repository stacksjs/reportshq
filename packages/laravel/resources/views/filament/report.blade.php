{{--
    A report inside a Filament panel.

    The panel supplies the page chrome, so this is the grid and the stylesheet
    and nothing else. The stylesheet is scoped by its own class names rather
    than resetting anything, so it cannot fight the panel's own CSS.
--}}
<div>
    <style>{!! ReportsHQ\Laravel\Charts\Elements::css() !!}</style>

    <div class="rhq-page" style="padding: 0; max-width: none;">
        @if ($report->description)
            <p class="rhq-lede">{{ $report->description }}</p>
        @endif

        {{-- Only when the standalone routes are mounted.

             `reportshq.download` lives in routes/reportshq.php, which the
             provider loads only when `routes.enabled` is true — and a panel
             install is precisely the one that leaves it false. Calling route()
             unconditionally here threw RouteNotFoundException before a single
             block rendered, so every report in the panel was a 500 rather than
             a page missing two links. Blade rethrows it wrapped in a
             ViewException, which slips past a handler's client-error
             allow-list, so it paged on every render too. --}}
        @if (\Illuminate\Support\Facades\Route::has('reportshq.download'))
            <p class="rhq-downloads">
                <span>Download</span>
                <a href="{{ route('reportshq.download', [$report->slug, 'csv']) }}">CSV</a>
                <a href="{{ route('reportshq.download', [$report->slug, 'xlsx']) }}">XLSX</a>
            </p>
        @endif

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
                        {!! ReportsHQ\Laravel\Charts\Elements::render($block) !!}
                    </div>
                @endforeach
            </div>
        @endif
    </div>

    {{-- The chart components.

         Elements::render() emits a bare custom element with no fallback
         children, so without this the grid reserves each block's footprint and
         draws nothing — which reads as a data problem rather than a missing
         script. The standalone layout has always inlined it; this view simply
         never did. --}}
    <script type="module">{!! ReportsHQ\Laravel\Charts\Elements::script() !!}</script>
</div>
