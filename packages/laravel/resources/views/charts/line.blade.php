{{-- A line, or an area when the block asked for one. --}}
<figure class="rhq-block">
    @if ($block['title'] ?? null)
        <figcaption class="rhq-title">{{ $block['title'] }}</figcaption>
    @endif

    @if (empty($paths))
        @include('reportshq::partials.empty')
    @else
        <svg class="rhq-chart" viewBox="0 0 720 260" role="img"
             aria-label="{{ $block['title'] ?? 'Chart' }}">
            @foreach ($ticks as $tick)
                <line class="rhq-grid" x1="52" x2="708" y1="{{ $tick['y'] }}" y2="{{ $tick['y'] }}" />
                <text class="rhq-axis" x="44" y="{{ $tick['y'] + 4 }}" text-anchor="end">{{ $tick['label'] }}</text>
            @endforeach

            @foreach ($paths as $path)
                @if ($area)
                    <path d="{{ $path['area'] }}" fill="{{ $path['color'] }}" fill-opacity="0.12" />
                @endif
                <path d="{{ $path['line'] }}" fill="none" stroke="{{ $path['color'] }}" stroke-width="2"
                      stroke-linejoin="round" stroke-linecap="round" />
            @endforeach

            @foreach ($labels as $label)
                <text class="rhq-axis" x="{{ $label['x'] }}" y="252" text-anchor="middle">{{ $label['label'] }}</text>
            @endforeach
        </svg>

        @includeWhen($legend, 'reportshq::partials.legend', ['entries' => $paths])
    @endif
</figure>
