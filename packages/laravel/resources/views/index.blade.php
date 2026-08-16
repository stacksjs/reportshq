@extends('reportshq::layout', ['title' => 'Reports'])

@section('content')
    <header class="rhq-header">
        <h1>Reports</h1>
        <p class="rhq-lede">Built here, stored here, and read from your own database.</p>
    </header>

    @if ($reports->isEmpty())
        <div class="rhq-empty rhq-empty-page">
            <h2>No reports yet</h2>
            <p>The first one is the hardest.</p>
        </div>
    @else
        <ul class="rhq-list">
            @foreach ($reports as $report)
                <li>
                    <a href="{{ route('reportshq.show', $report->slug) }}">
                        <span class="rhq-list-name">{{ $report->name }}</span>
                        @if ($report->description)
                            <span class="rhq-list-desc">{{ $report->description }}</span>
                        @endif
                    </a>
                    <span class="rhq-pill {{ $report->isPublished() ? 'rhq-pill-live' : '' }}">
                        {{ $report->isPublished() ? 'published' : 'draft' }}
                    </span>
                </li>
            @endforeach
        </ul>
    @endif
@endsection
