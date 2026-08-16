<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sharing a report, and sending one.
 *
 * Both were hosted features and both move here, because the reason they lived
 * on a server was that the numbers did. Now they do not: a share link is a
 * signed route into the application that already holds the data, and a schedule
 * is a row the application's own queue reads.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reportshq_shares', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('report_id')->constrained('reportshq_reports')->cascadeOnDelete();

            // The credential. Long enough that guessing is not a strategy, and
            // unique so a collision is a database error rather than two reports
            // quietly sharing a link.
            $table->string('token', 64)->unique();

            $table->string('label')->nullable();
            $table->string('created_by')->nullable();

            // Null means it does not expire, which is a real thing to want for
            // a dashboard on a wall. Revoking is the other half and is separate
            // on purpose: an expiry is a plan and a revocation is a decision.
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();

            // Not a counter of who: the point of a share link is that the
            // reader has no account, and recording them would quietly build the
            // identity table the product refuses to keep.
            $table->unsignedInteger('views')->default(0);
            $table->timestamp('last_viewed_at')->nullable();

            $table->timestamps();

            $table->index(['report_id', 'revoked_at']);
        });

        Schema::create('reportshq_schedules', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('report_id')->constrained('reportshq_reports')->cascadeOnDelete();

            $table->string('cadence');
            $table->unsignedTinyInteger('hour')->default(8);

            // A comma separated list rather than a table. A schedule has a
            // handful of recipients and they are edited as one field; a join
            // table would be three queries to render one row.
            $table->text('recipients');

            $table->string('format')->nullable();
            $table->boolean('enabled')->default(true);

            // What stops a re-run sending twice, which is the only thing about
            // scheduling that is genuinely hard.
            $table->timestamp('last_run_at')->nullable();

            $table->timestamps();

            $table->index(['enabled', 'last_run_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reportshq_schedules');
        Schema::dropIfExists('reportshq_shares');
    }
};
