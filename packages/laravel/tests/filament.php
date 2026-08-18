<?php

declare(strict_types=1);

/**
 * The Filament surface's tests.
 *
 * This file exists because the panel half shipped broken in the only
 * configuration anybody deploys it in, and nothing failed. Three separate
 * defects, none of them subtle once seen: the report page called a route the
 * package only registers when `routes.enabled` is true, so a panel install —
 * which leaves it false by definition — got a 500 instead of a report; the
 * list linked to a hardcoded `/reports/` segment while the page registered at
 * `filament.slug`, so every row 404'd; and neither page overrode canAccess(),
 * so both answered to anybody the panel admitted.
 *
 * The reason all three survived is worth stating, because it decides what this
 * file can be: the package's suite runs on plain PHP with no Illuminate and no
 * Filament, so no test here can render a Blade view or mount a page. Two of the
 * three defects therefore cannot be caught by executing anything.
 *
 * So this asserts two different kinds of thing, and is honest about which is
 * which. The authorization seam is real behaviour and is executed. The view
 * invariants are read from the Blade source as text — a weaker guard than
 * rendering, and the strongest one available without dragging Laravel and
 * Filament into a suite whose whole point is needing neither.
 *
 *     php packages/laravel/tests/filament.php
 */

/*
 * Enough of Filament to load the plugin.
 *
 * The plugin implements Filament's Plugin contract, so the file cannot even be
 * required without it. Declaring the shape here rather than requiring Filament
 * keeps this suite at "php and nothing else", which is what lets it run in CI
 * with no composer install.
 */
namespace Filament\Contracts {
    if (! interface_exists(Plugin::class)) {
        interface Plugin
        {
            public function getId(): string;

            public function register(\Filament\Panel $panel): void;

            public function boot(\Filament\Panel $panel): void;
        }
    }
}

namespace Filament {
    if (! class_exists(Panel::class)) {
        class Panel
        {
            /** @param array<int, class-string> $pages */
            public function pages(array $pages): static
            {
                return $this;
            }
        }
    }
}

namespace {
    /*
     * The container helper, reduced to what `make()` asks of it.
     *
     * `ReportsHQPlugin::make()` resolves through `app()`, and testing a
     * different construction path than the documented one is how a broken
     * `make()` ships green. Guarded, so that a suite which does have Laravel
     * loaded keeps the real helper.
     */
    if (! function_exists('app')) {
        function app(string $abstract): object
        {
            return new $abstract;
        }
    }

    require __DIR__.'/../src/Filament/ReportsHQPlugin.php';

    use ReportsHQ\Laravel\Filament\ReportsHQPlugin;

    final class Runner
    {
        public int $passed = 0;

        /** @var list<string> */
        public array $failures = [];

        public function test(string $name, callable $body): void
        {
            try {
                $body($this);
                $this->passed++;
            } catch (Throwable $error) {
                $this->failures[] = $name.': '.$error->getMessage();
            } finally {
                ReportsHQPlugin::forgetAuthorization();
            }
        }

        public function assert(bool $ok, string $message): void
        {
            if (! $ok) {
                throw new RuntimeException($message);
            }
        }

        public function same(mixed $expected, mixed $actual, string $message): void
        {
            if ($expected !== $actual) {
                throw new RuntimeException(sprintf(
                    '%s (expected %s, got %s)',
                    $message,
                    var_export($expected, true),
                    var_export($actual, true),
                ));
            }
        }
    }

    $run = new Runner;

    $view = static fn (string $name): string => (string) file_get_contents(
        __DIR__.'/../resources/views/filament/'.$name.'.blade.php'
    );

    // --- The authorization seam -------------------------------------------

    $run->test('an unconfigured install keeps the behaviour it had', function (Runner $run): void {
        // Deliberately permissive. A package that cannot see an application's
        // roles must not invent a stricter answer and lock out installs that
        // work today.
        $run->same(true, ReportsHQPlugin::allows(), 'expected the default to allow');
    });

    $run->test('a callback that refuses is obeyed', function (Runner $run): void {
        ReportsHQPlugin::make()->authorize(fn () => false);

        $run->same(false, ReportsHQPlugin::allows(), 'expected the callback to be asked');
    });

    $run->test('a callback that permits is obeyed', function (Runner $run): void {
        ReportsHQPlugin::make()->authorize(fn () => true);

        $run->same(true, ReportsHQPlugin::allows(), 'expected the callback to be asked');
    });

    $run->test('a truthy answer that is not a bool still decides', function (Runner $run): void {
        // hasRole() implementations return all sorts of things, and `?? false`
        // in a host's callback is not guaranteed.
        ReportsHQPlugin::make()->authorize(fn () => 1);
        $run->same(true, ReportsHQPlugin::allows(), 'expected 1 to permit');

        ReportsHQPlugin::make()->authorize(fn () => null);
        $run->same(false, ReportsHQPlugin::allows(), 'expected null to refuse');
    });

    $run->test('authorize() is chainable, so it can sit inside ->plugin()', function (Runner $run): void {
        $plugin = ReportsHQPlugin::make();

        $run->assert($plugin->authorize(fn () => true) === $plugin, 'expected the plugin back');
    });

    // --- The view invariants ----------------------------------------------

    $run->test('the panel never calls a route the package may not have registered', function (Runner $run) use ($view): void {
        foreach (['index', 'report'] as $name) {
            $source = $view($name);

            if (! str_contains($source, "route('reportshq.")) {
                continue;
            }

            // Not "is there a guard somewhere" but "does the guard come first":
            // a Route::has() below the call it is meant to protect is no guard.
            $guard = strpos($source, 'Route::has(');
            $call = strpos($source, "route('reportshq.");

            $run->assert($guard !== false, "{$name} calls a package route with no Route::has() guard");
            $run->assert($guard < $call, "{$name} guards its route call too late to matter");
        }
    });

    $run->test('the list does not hand-build the report page URL', function (Runner $run) use ($view): void {
        $source = $view('index');

        // The literal that 404'd: the page registers at `filament.slug`, which
        // defaults to `reportshq`, so a hardcoded segment agrees with exactly
        // one configuration — the one the config warns against choosing.
        $run->assert(
            ! str_contains($source, "'/reports/'"),
            'the list hardcodes a /reports/ segment again',
        );

        $run->assert(
            str_contains($source, 'ReportPage::getUrl('),
            'the list should ask ReportPage for its own URL',
        );
    });

    $run->test('the panel ships the script its chart elements need', function (Runner $run) use ($view): void {
        // Elements::render() emits a bare custom element with no fallback
        // children: without the module that defines the tags, each block
        // reserves its footprint and draws nothing, which reads as missing data
        // rather than a missing script.
        $source = $view('report');

        $run->assert(
            str_contains($source, 'Elements::script()'),
            'the report view renders chart elements but never defines them',
        );

        $run->assert(
            str_contains($source, '<script type="module">'),
            'the bundle is an ES module and has to be loaded as one',
        );
    });

    echo "\n";

    foreach ($run->failures as $failure) {
        echo "  FAIL  {$failure}\n";
    }

    printf("\n %d pass, %d fail\n\n", $run->passed, count($run->failures));

    exit($run->failures === [] ? 0 : 1);
}
