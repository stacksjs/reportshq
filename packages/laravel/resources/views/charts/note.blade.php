{{-- Prose. The one block that asks the database nothing. --}}
<figure class="rhq-block rhq-note">
    @if ($block['title'] ?? null)
        <figcaption class="rhq-title">{{ $block['title'] }}</figcaption>
    @endif

    <p>{{ $block['body'] }}</p>
</figure>
