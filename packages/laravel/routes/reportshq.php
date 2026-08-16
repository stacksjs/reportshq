<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;
use ReportsHQ\Laravel\Http\BuilderController;
use ReportsHQ\Laravel\Http\ReportController;

/*
 * The standalone surface.
 *
 * Mounted at a path and behind middleware the application chooses, because a
 * package cannot know whether reports belong at /reports, behind an admin
 * guard, or nowhere at all. Nothing here is registered when `routes.enabled` is
 * false, which is how an application wanting only the Filament plugin, or only
 * the query engine, avoids publishing pages it did not ask for.
 *
 * `/new` and `/{slug}/edit` before `/{slug}`, or a report called "new" is
 * unreachable and the edit page is read as a slug.
 */
Route::get('/', [ReportController::class, 'index'])->name('reportshq.index');

Route::post('/', [BuilderController::class, 'store'])->name('reportshq.store');
Route::get('/{slug}/edit', [BuilderController::class, 'edit'])->name('reportshq.edit');
Route::post('/{slug}/blocks', [BuilderController::class, 'addBlock'])->name('reportshq.blocks.add');
Route::post('/{slug}/layout', [BuilderController::class, 'saveLayout'])->name('reportshq.layout');
Route::post('/{slug}/blocks/{block}', [BuilderController::class, 'saveBlock'])->name('reportshq.blocks.save');
Route::delete('/{slug}/blocks/{block}', [BuilderController::class, 'removeBlock'])->name('reportshq.blocks.remove');
Route::post('/{slug}/publish', [BuilderController::class, 'publish'])->name('reportshq.publish');

Route::get('/{slug}', [ReportController::class, 'show'])->name('reportshq.show');
