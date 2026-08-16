<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * One queryable thing, and everything the builder may ask of it.
 *
 * Also the security boundary. A model holds the dimensions and measures it
 * exposes and nothing else: a column absent from this list cannot be selected,
 * grouped, filtered or ordered by, whatever a request asks for. Default deny,
 * because a report builder is a `SELECT` with a drag handle on it, and one
 * that can reach `users.password` is a breach rather than a feature.
 *
 * `grain` is prose, and it is read by a person rather than by code. When the
 * compiler refuses a query it quotes both grains back, and "one row per order"
 * beside "one row per line of an order" explains the refusal in a way that two
 * table names do not.
 */
final class Model
{
    /** @var array<string, Dimension> */
    public readonly array $dimensions;

    /** @var array<string, Measure> */
    public readonly array $measures;

    /** @var array<string, Relation> */
    public readonly array $relations;

    /**
     * @param  list<Dimension>  $dimensions
     * @param  list<Measure>  $measures
     * @param  list<Relation>  $relations
     */
    public function __construct(
        public readonly string $key,
        public readonly string $table,
        public readonly string $label,
        public readonly string $grain,
        array $dimensions = [],
        array $measures = [],
        array $relations = [],
        public readonly string $primaryKey = 'id',
    ) {
        $byKey = [];

        foreach ($dimensions as $dimension) {
            if ($dimension->model !== $key) {
                throw new \InvalidArgumentException("Dimension '{$dimension->key}' belongs to '{$dimension->model}', not '{$key}'.");
            }

            $byKey[$dimension->key] = $dimension;
        }

        $this->dimensions = $byKey;
        $byKey = [];

        foreach ($measures as $measure) {
            if ($measure->model !== $key) {
                throw new \InvalidArgumentException("Measure '{$measure->key}' belongs to '{$measure->model}', not '{$key}'.");
            }

            $byKey[$measure->key] = $measure;
        }

        $this->measures = $byKey;
        $byKey = [];

        foreach ($relations as $relation) {
            $byKey[$relation->name] = $relation;
        }

        $this->relations = $byKey;
    }

    public function dimension(string $key): ?Dimension
    {
        return $this->dimensions[$key] ?? null;
    }

    public function measure(string $key): ?Measure
    {
        return $this->measures[$key] ?? null;
    }
}
