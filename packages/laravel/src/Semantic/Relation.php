<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * One hop from a model to another, and whether taking it multiplies rows.
 *
 * Cardinality is the only property here that matters to correctness, and it is
 * the reason this class exists rather than a pair of table names. Joining an
 * order to its member reads one row per order; joining it to its items reads
 * one row per line. A measure summed after the second join is multiplied by
 * the basket size, silently, by a factor that varies per order so the total
 * never looks like a round mistake.
 */
final class Relation
{
    public const ONE = 'one';

    public const MANY = 'many';

    public function __construct(
        public readonly string $name,
        public readonly string $target,
        public readonly string $cardinality,
        public readonly string $localKey,
        public readonly string $foreignKey,
    ) {
        if ($cardinality !== self::ONE && $cardinality !== self::MANY) {
            throw new \InvalidArgumentException("Cardinality is 'one' or 'many', not '{$cardinality}'.");
        }
    }

    /** Whether following this hop can turn one row into several. */
    public function fansOut(): bool
    {
        return $this->cardinality === self::MANY;
    }

    /**
     * The cardinality of an Eloquent relation type.
     *
     * `hasOne` and `belongsTo` read at most one row on the far side.
     * `hasMany`, `belongsToMany` and everything through a pivot read any
     * number, including zero, which is the other half of why a fan-out join
     * cannot simply be tolerated: it drops rows as well as duplicating them.
     */
    public static function cardinalityOf(string $eloquentType): string
    {
        return match ($eloquentType) {
            'BelongsTo', 'HasOne', 'HasOneThrough', 'MorphOne' => self::ONE,
            default => self::MANY,
        };
    }
}
