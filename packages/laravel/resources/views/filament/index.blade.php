<div>
    <style>{!! ReportsHQ\Laravel\Charts\Assets::css() !!}</style>

    <div class="rhq-page" style="padding: 0; max-width: none;">
        @if ($reports->isEmpty())
            <div class="rhq-empty rhq-empty-page">
                <h2>No reports yet</h2>
                <p>The first one is the hardest.</p>
            </div>
        @else
            <ul class="rhq-list">
                @foreach ($reports as $report)
                    <li>
                        <a href="{{ \Filament\Facades\Filament::getCurrentPanel()->getUrl().'/reports/'.$report->slug }}">
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
    </div>
</div>
