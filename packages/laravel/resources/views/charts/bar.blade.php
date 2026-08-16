{{--
    Bars over time.

    `preserveAspectRatio="none"` is deliberately absent: the geometry is
    computed at a fixed box and scaled uniformly, so a wide card does not
    stretch the type inside the SVG into something unreadable.
--}}
<figure class="rhq-block">
    @if ($block['title'] ?? null)
        <figcaption class="rhq-title">{{ $block['title'] }}</figcaption>
    @endif

    @if (empty($rects))
        @include('reportshq::partials.empty')
    @else
        <svg class="rhq-chart" viewBox="0 0 720 260" role="img"
             aria-label="{{ $block['title'] ?? 'Chart' }}">
            @foreach ($ticks as $tick)
                <line class="rhq-grid" x1="52" x2="708" y1="{{ $tick['y'] }}" y2="{{ $tick['y'] }}" />
                <text class="rhq-axis" x="44" y="{{ $tick['y'] + 4 }}" text-anchor="end">{{ $tick['label'] }}</text>
            @endforeach

            @foreach ($rects as $rect)
                <rect x="{{ $rect['x'] }}" y="{{ $rect['y'] }}"
                      width="{{ $rect['width'] }}" height="{{ $rect['height'] }}"
                      rx="1" fill="{{ $color }}">
                    <title>{{ $rect['label'] }}: {{ $rect['value'] }}</title>
                </rect>
            @endforeach

            @foreach ($labels as $label)
                <text class="rhq-axis" x="{{ $label['x'] }}" y="252" text-anchor="middle">{{ $label['label'] }}</text>
            @endforeach
        </svg>
    @endif
</figure>
