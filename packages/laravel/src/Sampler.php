<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

/**
 * Deterministic sampling, on the subject rather than on the event.
 *
 * Sampling events independently is the obvious implementation and it quietly
 * ruins the reports it feeds. A funnel asks how many people who viewed a
 * product went on to check out; if each of those events is kept or dropped by
 * its own coin flip, the steps stop belonging to the same people and every
 * conversion rate becomes noise. Hashing the subject means somebody is either
 * wholly in the sample or wholly out, and funnels, retention and unique counts
 * stay internally consistent.
 *
 * The same FNV-1a hash as the Stacks SDK, so the two agree about who is in a
 * sample. An application migrating between them keeps a continuous history
 * rather than a step change at the switchover.
 */
final class Sampler
{
    /** @param array<string, mixed> $event */
    public static function keep(array $event, float $rate): bool
    {
        if ($rate >= 1.0) {
            return true;
        }

        if ($rate <= 0.0) {
            return false;
        }

        $subject = (string) ($event['user_key'] ?? $event['session_key'] ?? '');

        if ($subject === '') {
            // Nothing to be consistent with, so a per-event decision is the
            // best available.
            return (mt_rand() / mt_getrandmax()) < $rate;
        }

        return (self::hash($subject) % 10000) / 10000 < $rate;
    }

    /** FNV-1a, 32-bit, matching the Stacks SDK exactly. */
    public static function hash(string $subject): int
    {
        $hash = 2166136261;

        for ($index = 0, $length = strlen($subject); $index < $length; $index++) {
            $hash ^= ord($subject[$index]);
            // Multiply in 32-bit space. PHP integers are 64-bit, so the mask
            // is what keeps this identical to the JavaScript Math.imul.
            $hash = ($hash * 16777619) & 0xFFFFFFFF;
        }

        return $hash & 0xFFFFFFFF;
    }
}
