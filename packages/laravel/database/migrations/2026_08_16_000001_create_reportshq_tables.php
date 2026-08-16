<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where a report lives.
 *
 * In the application's own database, prefixed, and nowhere else. That is the
 * whole point of the embedded shape: the numbers never leave, and neither do
 * the questions, so an export and a share link work with the network down and
 * there is nothing to argue about over whether a filter value counts as
 * somebody's data.
 *
 * Three tables and no more. A report, its blocks, and a revision per publish.
 * Schedules and shares will want their own and are not written until something
 * uses them, because an unused table still has to be migrated by every
 * application that installs this.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reportshq_reports', function (Blueprint $table): void {
            $table->id();
            $table->string('name');

            // Stable across renames, which is what a bookmark and a share link
            // both need. Unique, because it is how a report is addressed.
            $table->string('slug')->unique();
            $table->text('description')->nullable();

            // draft until somebody publishes. A viewer reads the published
            // snapshot, so a half arranged grid is never what a colleague opens.
            $table->string('status')->default('draft');
            $table->timestamp('published_at')->nullable();

            // Nullable and deliberately not a foreign key. An application's
            // users table may be called anything, may use a uuid, and may not
            // exist at all in a queue worker; a dangling id is a smaller
            // problem than a migration that will not run.
            $table->string('owner_id')->nullable()->index();

            // The zone every bucket and every range is computed in. On the
            // report rather than on the reader, because "yesterday" has to mean
            // the same day for everybody looking at the same numbers.
            $table->string('timezone')->default('UTC');

            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'updated_at']);
        });

        Schema::create('reportshq_blocks', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('report_id')->constrained('reportshq_reports')->cascadeOnDelete();

            $table->string('kind');
            $table->string('title')->nullable();

            // The query as JSON: measure, dimension, grain, filters. Names
            // rather than resolved objects, so a stored report survives the
            // registry changing underneath it and says so when a name is gone
            // rather than quietly dropping a condition.
            $table->json('query')->nullable();

            // A note's prose. Separate from `query` because it is not one.
            $table->text('body')->nullable();

            // The twelve column grid, matching what the builder drags.
            $table->unsignedSmallInteger('x')->default(0);
            $table->unsignedSmallInteger('y')->default(0);
            $table->unsignedSmallInteger('w')->default(4);
            $table->unsignedSmallInteger('h')->default(4);

            $table->timestamps();

            // Every read is "the blocks of this report, in grid order".
            $table->index(['report_id', 'y', 'x']);
        });

        Schema::create('reportshq_revisions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('report_id')->constrained('reportshq_reports')->cascadeOnDelete();

            // The whole report and its blocks, as they were. Wholesale rather
            // than a diff: a revision exists to be restored, and restoring a
            // chain of diffs is a feature nobody asked for with a failure mode
            // nobody can debug.
            $table->json('snapshot');

            // 'publish', 'upgrade', 'restore'. Free text on purpose, since the
            // set will grow and a check constraint on it would need a migration
            // each time.
            $table->string('reason')->nullable();
            $table->string('owner_id')->nullable();

            $table->timestamp('created_at')->nullable();

            $table->index(['report_id', 'created_at']);
        });
    }

    public function down(): void
    {
        // Children first: the constraints point upward, and dropping the parent
        // while they exist fails on every database that enforces them.
        Schema::dropIfExists('reportshq_revisions');
        Schema::dropIfExists('reportshq_blocks');
        Schema::dropIfExists('reportshq_reports');
    }
};
