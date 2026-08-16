{{-- The numbers as numbers, and the accessible reading of every other chart. --}}
<figure class="rhq-block">
    @if ($block['title'] ?? null)
        <figcaption class="rhq-title">{{ $block['title'] }}</figcaption>
    @endif

    @if (empty($rows))
        @include('reportshq::partials.empty')
    @else
        <div class="rhq-scroll">
            <table class="rhq-table">
                <thead>
                    <tr>
                        <th scope="col">{{ $label }}</th>
                        <th scope="col" class="rhq-right">Value</th>
                        <th scope="col" class="rhq-right">Share</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach ($rows as $row)
                        <tr>
                            <td>
                                <span class="rhq-swatch" style="background: {{ $row['color'] }}"></span>
                                {{ $row['key'] }}
                            </td>
                            <td class="rhq-right rhq-num">{{ $row['value'] }}</td>
                            <td class="rhq-right rhq-num rhq-muted">{{ $row['share'] }}</td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </div>
    @endif
</figure>
