<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * The table standing between two models in a many to many relationship.
 *
 * Its own type rather than three nullable strings on Relation, so a hop either
 * has a complete pivot or none: a half described one compiles to a join whose
 * `ON` clause is missing a side, and the database answers that with a cross
 * product rather than an error.
 *
 * A morph pivot also carries the type column and the value to match, since
 * `categorizables` holds the categories of orders and of products in the same
 * rows and joining without that condition reads somebody else's.
 */
final class Pivot
{
    public function __construct(
        public readonly string $table,
        /** The column on the pivot matching the base model's key. */
        public readonly string $baseColumn,
        /** The column on the pivot matching the target model's key. */
        public readonly string $targetColumn,
        /** For a morph pivot, the column holding the base model's class. */
        public readonly ?string $typeColumn = null,
        /** For a morph pivot, the value that column has to hold. */
        public readonly ?string $typeValue = null,
    ) {
        if (($typeColumn === null) !== ($typeValue === null)) {
            throw new \InvalidArgumentException('A morph pivot needs both a type column and a type value, or neither.');
        }
    }

    public function isMorph(): bool
    {
        return $this->typeColumn !== null;
    }
}
