{{--
    One number, and what it means.

    The total comes from the runner's own headline query rather than from the
    series beside it, and for `avg` and `count_distinct` those two genuinely
    differ. Reading it off the series would reintroduce the arithmetic the
    hosted engine shipped wrong twice.
--}}
<figure class="rhq-block rhq-big">
    @if ($block['title'] ?? null)
        <figcaption class="rhq-title">{{ $block['title'] }}</figcaption>
    @endif

    <p class="rhq-number">{{ $value }}</p>

    @if ($caption)
        <p class="rhq-caption">{{ $caption }}</p>
    @endif
</figure>
