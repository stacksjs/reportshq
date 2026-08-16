<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A link that shows one published report to somebody with no account.
 *
 * The token is the whole credential, so it is generated rather than derived and
 * is never anything a person chose. Everything else here exists to take it
 * away again: an expiry for links that were always meant to lapse, and a
 * revocation for the ones that were not.
 */
class Share extends Model
{
    protected $table = 'reportshq_shares';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'revoked_at' => 'datetime',
            'last_viewed_at' => 'datetime',
            'views' => 'integer',
        ];
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class, 'report_id');
    }

    /** 32 bytes of randomness, hex encoded. Guessing is not a strategy against it. */
    public static function newToken(): string
    {
        return Str::lower(bin2hex(random_bytes(32)));
    }

    public function isLive(): bool
    {
        if ($this->revoked_at !== null) {
            return false;
        }

        return $this->expires_at === null || $this->expires_at->isFuture();
    }

    /**
     * Why a dead link is dead, for the page that says so.
     *
     * Told apart deliberately. "This link was turned off" and "this link ran
     * out" send somebody to different people, and a single "not available"
     * sends them to whoever they saw last.
     */
    public function deadBecause(): ?string
    {
        if ($this->revoked_at !== null) {
            return 'This link was turned off.';
        }

        if ($this->expires_at !== null && $this->expires_at->isPast()) {
            return 'This link expired on '.$this->expires_at->format('j M Y').'.';
        }

        return null;
    }
}
