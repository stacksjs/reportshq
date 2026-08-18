<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Filament;

use Closure;
use Filament\Contracts\Plugin;
use Filament\Panel;

/**
 * The reports, inside a Filament panel.
 *
 * Deliberately thin. It registers two pages and does nothing else, and the
 * pages render the same Blade views the standalone routes serve. The moment
 * this holds logic of its own, an application without Filament has a second
 * class version of the product, and most Laravel applications do not run
 * Filament.
 *
 * Filament is a `suggest` rather than a `require`. This file is only ever
 * loaded by an application that already has it, and referencing its classes
 * costs nothing until then.
 *
 * ```php
 * // app/Providers/Filament/AdminPanelProvider.php
 * ->plugin(\ReportsHQ\Laravel\Filament\ReportsHQPlugin::make())
 * ```
 *
 * A panel usually admits more people than a report should. Pass a callback and
 * both pages ask it before they will render:
 *
 * ```php
 * ->plugin(ReportsHQPlugin::make()->authorize(
 *     fn () => auth()->user()?->hasRole('admin') ?? false,
 * ))
 * ```
 *
 * A callback rather than a config value, because this is a decision in PHP
 * about the application's own roles: a closure in a config file is not
 * serialisable and disappears the moment somebody runs `config:cache`.
 */
class ReportsHQPlugin implements Plugin
{
    /**
     * Who may see the reports, or null for anybody the panel already admits.
     *
     * Static because Filament asks the PAGES, through a static `canAccess()`,
     * and a static has no instance to ask. Reaching back through
     * `Filament::getCurrentPanel()->getPlugin('reportshq')` would tie the
     * answer to the plugin being registered as a plugin, and a page mounted
     * directly with `->pages([...])` — which is how an application subclasses
     * these — would then throw rather than answer.
     */
    protected static ?Closure $authorize = null;

    public function getId(): string
    {
        return 'reportshq';
    }

    /**
     * Restrict both pages to the callers this callback approves.
     *
     * Returning false hides the navigation item AND refuses the URL: Filament
     * enforces `canAccess()` on mount and on every Livewire hydration, which is
     * what makes this different from hiding a nav entry.
     */
    public function authorize(Closure $callback): static
    {
        static::$authorize = $callback;

        return $this;
    }

    /**
     * Whether the current caller may see the reports.
     *
     * Defaults to true, which is what the pages did before this existed. A
     * package that cannot see an application's roles has no business inventing
     * a stricter answer and locking out the installs that are working today;
     * it can only make the decision reachable, and say so loudly in the README.
     */
    public static function allows(): bool
    {
        $callback = static::$authorize;

        return $callback === null || (bool) $callback();
    }

    /**
     * Forget the callback. For tests, which would otherwise leak one case's
     * answer into the next.
     */
    public static function forgetAuthorization(): void
    {
        static::$authorize = null;
    }

    public function register(Panel $panel): void
    {
        $panel->pages([
            ReportsPage::class,
            ReportPage::class,
        ]);
    }

    public function boot(Panel $panel): void
    {
        // Nothing. The pages carry their own views and the container already
        // holds the runner, so there is nothing to arrange at boot.
    }

    public static function make(): static
    {
        return app(static::class);
    }
}
