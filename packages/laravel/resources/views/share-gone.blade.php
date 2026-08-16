@extends('reportshq::layout', ['title' => 'Link unavailable'])

@section('content')
    <div class="rhq-empty rhq-empty-page">
        <h2>This report is not available</h2>
        <p>{{ $reason }}</p>
        <p>Ask whoever sent you the link for a new one.</p>
    </div>
@endsection
