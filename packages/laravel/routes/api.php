<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;
use ReportsHQ\Laravel\Http\ApiController;
use ReportsHQ\Laravel\Http\BuilderController;

/*
 * The JSON surface the stx client reads.
 *
 * Mounted separately from the pages, with its own prefix and its own
 * middleware, because the two are guarded differently in most applications: a
 * page wants a session and a redirect to a login, and an API call wants a token
 * and a 401.
 *
 * The write endpoints are the builder's, reused rather than duplicated. A
 * second set of routes doing the same writes is a second set of rules about
 * what a drag means.
 */
Route::get('/reports', [ApiController::class, 'index'])->name('reportshq.api.index');
Route::get('/reports/{slug}', [ApiController::class, 'show'])->name('reportshq.api.show');
Route::get('/reports/{slug}/draft', [ApiController::class, 'draft'])->name('reportshq.api.draft');
Route::get('/schema', [ApiController::class, 'schema'])->name('reportshq.api.schema');

Route::post('/reports', [BuilderController::class, 'store'])->name('reportshq.api.store');
Route::post('/reports/{slug}/blocks', [BuilderController::class, 'addBlock'])->name('reportshq.api.blocks.add');
Route::post('/reports/{slug}/layout', [BuilderController::class, 'saveLayout'])->name('reportshq.api.layout');
Route::post('/reports/{slug}/blocks/{block}', [BuilderController::class, 'saveBlock'])->name('reportshq.api.blocks.save');
Route::delete('/reports/{slug}/blocks/{block}', [BuilderController::class, 'removeBlock'])->name('reportshq.api.blocks.remove');
Route::post('/reports/{slug}/publish', [BuilderController::class, 'publish'])->name('reportshq.api.publish');

Route::get('/reports/{slug}/shares', [ApiController::class, 'shares'])->name('reportshq.api.shares');
Route::post('/reports/{slug}/shares', [ApiController::class, 'createShare'])->name('reportshq.api.shares.create');
Route::delete('/reports/{slug}/shares/{share}', [ApiController::class, 'revokeShare'])->name('reportshq.api.shares.revoke');
