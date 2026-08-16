{{--
    A block that could not run.

    Drawn on the tile rather than logged, because a grain refusal is written for
    the person looking at it and is far more often a report to correct than a
    bug to file.
--}}
<figure class="rhq-block rhq-broken">
    @if ($block['title'] ?? null)
        <figcaption class="rhq-title">{{ $block['title'] }}</figcaption>
    @endif

    <p class="rhq-error">{{ $block['error'] }}</p>
</figure>
