<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * One hop from a model to another, and whether taking it multiplies rows.
 *
 * Cardinality is the property correctness rests on, and it is why this class
 * exists rather than a pair of table names. Joining an order to its member
 * reads one row per order; joining it to its items reads one row per line. A
 * measure summed after the second join is multiplied by the basket size,
 * silently, by a factor that varies per order so the total never looks like a
 * round mistake.
 *
 * The two columns are named for the side they sit on rather than borrowed from
 * Eloquent's vocabulary. `localKey` and `foreignKey` mean opposite things on a
 * `belongsTo` and a `hasMany`: an order's member is `members.id =
 * orders.member_id`, and an order's items are `order_items.order_id =
 * orders.id`. Writing the join from a pair called "local" and "foreign"
 * requires knowing which kind of relation produced them, which is exactly the
 * knowledge the compiler should not need. `base` and `target` always mean the
 * same thing, so the join is always `target.targetColumn = base.baseColumn`.
 */
final class Relation
{
    public const ONE = 'one';

    public const MANY = 'many';

    /**
     * @param  string  $baseColumn  The column on the model being joined from.
     * @param  string  $targetColumn  The column on the model being joined to.
     * @param  Pivot|null  $pivot  Set when the two are linked through a third table.
     */
    public function __construct(
        public readonly string $name,
        public readonly string $target,
        public readonly string $cardinality,
        public readonly string $baseColumn,
        public readonly string $targetColumn,
        public readonly ?Pivot $pivot = null,
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
     * `hasOne` and `belongsTo` read at most one row on the far side. Everything
     * else reads any number, including zero, which is the other half of why a
     * fan-out join cannot simply be tolerated: it drops rows as well as
     * duplicating them.
     *
     * Anything unrecognised is assumed to multiply. That is the assumption
     * whose failure mode is a refusal rather than a wrong number, and a
     * relation type nobody has thought about is exactly when that matters.
     */
    public static function cardinalityOf(string $eloquentType): string
    {
        return match ($eloquentType) {
            'BelongsTo', 'HasOne', 'HasOneThrough', 'MorphOne' => self::ONE,
            default => self::MANY,
        };
    }
}
