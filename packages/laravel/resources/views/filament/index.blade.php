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
                        {{-- The page's own URL, not a hand-built one. This
                             concatenation hardcoded a `/reports/` segment while
                             ReportPage registers at `filament.slug` (default
                             `reportshq`), so every row 404'd in every
                             configuration but the one the config warns against.
                             getUrl() reads the same getSlug() the route was
                             built from, and carries the panel path with it. --}}
                        <a href="{{ \ReportsHQ\Laravel\Filament\ReportPage::getUrl(['slug' => $report->slug]) }}">
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
