<ul class="rhq-legend">
    @foreach ($entries as $entry)
        <li>
            <span class="rhq-swatch" style="background: {{ $entry['color'] }}"></span>
            <span>{{ $entry['key'] }}</span>
        </li>
    @endforeach
</ul>
