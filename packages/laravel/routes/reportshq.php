<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;
use ReportsHQ\Laravel\Http\ReportController;

/*
 * The standalone surface.
 *
 * Mounted at a path and behind middleware the application chooses, because a
 * package cannot know whether reports belong at /reports, behind an admin
 * guard, or nowhere at all. Nothing here is registered when `route.enabled` is
 * false, which is how an application that only wants the Filament plugin, or
 * only the query engine, avoids publishing pages it did not ask for.
 */
Route::get('/', [ReportController::class, 'index'])->name('reportshq.index');
Route::get('/{slug}', [ReportController::class, 'show'])->name('reportshq.show');
