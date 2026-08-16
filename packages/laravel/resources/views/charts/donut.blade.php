{{--
    A donut rather than a pie: the hole gives the total somewhere to live, and
    a reader compares arc lengths instead of judging angles at a centre.

    The legend is not optional here. Identity resting on colour alone fails for
    the readers this palette was measured for.
--}}
<figure class="rhq-block rhq-donut">
    @if ($block['title'] ?? null)
        <figcaption class="rhq-title">{{ $block['title'] }}</figcaption>
    @endif

    @if (empty($slices))
        @include('reportshq::partials.empty')
    @else
        <svg class="rhq-chart rhq-chart-donut" viewBox="-110 -110 220 220" role="img"
             aria-label="{{ $block['title'] ?? 'Chart' }}">
            @foreach ($slices as $slice)
                <path d="{{ $slice['path'] }}" fill="{{ $slice['color'] }}">
                    <title>{{ $slice['key'] }}: {{ $slice['label'] }}</title>
                </path>
            @endforeach

            <text class="rhq-donut-total" x="0" y="0" text-anchor="middle" dominant-baseline="middle">{{ $total }}</text>
            <text class="rhq-donut-caption" x="0" y="18" text-anchor="middle">total</text>
        </svg>

        <ul class="rhq-legend">
            @foreach ($slices as $slice)
                <li>
                    <span class="rhq-swatch" style="background: {{ $slice['color'] }}"></span>
                    <span>{{ $slice['key'] }}</span>
                    <span class="rhq-legend-value">{{ $slice['percent'] }}</span>
                </li>
            @endforeach
        </ul>
    @endif
</figure>
