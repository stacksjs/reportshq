{{--
    The page around a report.

    Standalone rather than extending the host application's layout, and that is
    a decision rather than laziness: an application's own layout carries its
    navigation, its auth chrome and its CSS, none of which this package can
    predict. A page that renders correctly everywhere beats one that inherits
    beautifully in the application it was written against.

    The Filament plugin wraps these same views in the panel, so an application
    that has one gets it inside the admin it already runs, and everybody else
    gets this.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- The builder posts to its own endpoints, and Laravel's VerifyCsrfToken
         runs on the `web` middleware every application mounts these behind. --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>{{ $title ?? 'Reports' }}</title>
    <style>{!! ReportsHQ\Laravel\Charts\Elements::css() !!}</style>
</head>
<body>
    <main class="rhq-page">
        @yield('content')

        @php($notice = app(ReportsHQ\Laravel\License::class)->notice())

        @if ($notice)
            {{-- Said once, at the bottom, and never in the way of a number. --}}
            <p class="rhq-license">{{ $notice }}</p>
        @endif
    </main>
    {{-- The chart components. Inlined so there is no asset pipeline to
         configure and no second request before a number appears. --}}
    <script type="module">{!! ReportsHQ\Laravel\Charts\Elements::script() !!}</script>
</body>
</html>
