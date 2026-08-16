<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

/**
 * The licence key, checked offline.
 *
 * There is no network call here and there is not going to be one. The whole
 * claim of the embedded shape is that an application's data never leaves it,
 * and a package that phones home on boot has quietly made a different claim:
 * that the vendor knows which applications are running, how often they restart
 * and when they are deployed. A licence check is not worth that.
 *
 * So the key is verified for shape rather than for existence. A signed key
 * proves somebody was issued one; it cannot prove they still should have it,
 * and pretending otherwise would need the call this refuses to make. That is a
 * deliberate trade and it is the same one every offline licence makes: it stops
 * an accident, not a determined person.
 *
 * **Nothing here gates the reports.** An unlicensed application reports on its
 * own data exactly as a licensed one does. What the absence of a key changes is
 * that the pages say so. A reporting tool that blanks somebody's dashboard over
 * a billing state is a reporting tool that cannot be trusted with the dashboard.
 */
final class License
{
    /**
     * The prefix a key carries, so a leaked one is identifiable in a log or a
     * paste, and so a key pasted into the wrong field is obvious immediately.
     */
    public const PREFIX = 'rhq_lic_';

    public function __construct(private readonly ?string $key = null) {}

    public function present(): bool
    {
        return $this->key !== null && $this->key !== '';
    }

    /**
     * Whether the key looks like one we issued.
     *
     * Shape only: the prefix and thirty two hex characters, which is what the
     * issuer emits. This says "that is not a ReportsHQ key" to somebody who
     * pasted the wrong thing, and it says nothing at all about whether the
     * licence is current.
     */
    public function valid(): bool
    {
        if (! $this->present()) {
            return false;
        }

        return (bool) preg_match('/^'.preg_quote(self::PREFIX, '/').'[0-9a-f]{32}$/', (string) $this->key);
    }

    /**
     * What to say on the page, or null when there is nothing to say.
     *
     * Written for the person who sees it rather than for the person who owns
     * the licence: they are often not the same, and an engineer looking at a
     * dashboard cannot act on "your subscription has lapsed".
     */
    public function notice(): ?string
    {
        if ($this->valid()) {
            return null;
        }

        if (! $this->present()) {
            return 'Unlicensed. Reports work in full; set REPORTSHQ_LICENSE to remove this notice.';
        }

        return 'That licence key is not in the expected format. Reports are unaffected.';
    }
}
