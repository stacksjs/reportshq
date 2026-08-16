{{--
    The email.

    Headline numbers only, as text. An email client renders a fraction of the
    CSS a browser does and blocks most images, so a chart in here is either a
    tracking pixel by another name or a broken box; the attachment carries the
    detail and the link carries the rest.
--}}
<x-mail::message>
# {{ $report->name }}

@if ($report->description)
{{ $report->description }}
@endif

@foreach ($blocks as $block)
@if (($block['kind'] ?? null) === 'big_number' && ($block['error'] ?? null) === null)
**{{ $block['title'] ?: 'Total' }}:** {{ ReportsHQ\Laravel\Charts\Format::compact($block['total'] ?? 0) }}
@endif
@endforeach

@php($broken = collect($blocks)->filter(fn ($b) => ($b['error'] ?? null) !== null)->count())

@if ($broken > 0)
{{ $broken }} block(s) could not be calculated. Open the report to see why.
@endif

Numbers are for {{ $report->timezone }}.
</x-mail::message>
