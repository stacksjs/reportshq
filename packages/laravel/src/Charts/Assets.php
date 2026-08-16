<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Charts;

/**
 * The stylesheet, read from the package.
 *
 * A class rather than a `file_get_contents` in the layout, and the reason is
 * worth recording: Blade compiles a template into `storage/framework/views`, so
 * `__DIR__` inside a `.blade.php` file resolves to the cache directory and not
 * to where the template was written. Every path relative to a view is wrong,
 * silently, and only once the cache is warm.
 *
 * Inlined rather than served as an asset, so an application does not have to
 * publish anything, run a build, or teach its bundler about this package to see
 * a report. It is a few kilobytes; a request saved is a worse trade.
 */
final class Assets
{
    private static ?string $css = null;

    private static ?string $builder = null;

    public static function css(): string
    {
        // Read once per process. A report page is one request and a queue
        // worker rendering a scheduled one may do hundreds.
        return self::$css ??= (string) file_get_contents(__DIR__.'/../../resources/css/reportshq.css');
    }

    /**
     * The arranging script, for the builder page only.
     *
     * Never on a viewer: a report is read rather than operated, and shipping
     * the drag handling to somebody who cannot edit is bytes they will not use
     * against a grid they cannot move.
     */
    public static function builderScript(): string
    {
        return self::$builder ??= (string) file_get_contents(__DIR__.'/../../resources/js/builder.js');
    }
}
