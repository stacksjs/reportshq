<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * The registry an application declared, read from its config file.
 *
 * The counterpart to Discovery. That one guesses from Eloquent and is honest
 * about guessing; this one reads what a person decided and treats it as final.
 * Between them they are the whole of "the schema is a draft a human corrects":
 * discovery writes the file, this reads it, and nothing in the query path ever
 * touches a model that is not in it.
 *
 * Every problem here is thrown rather than skipped. A misspelt column in a
 * config file is a dimension that silently disappears from the builder, and
 * somebody then spends an afternoon wondering why they cannot group by it. An
 * exception at boot names the entry.
 */
final class Configured
{
    /**
     * @param  array<string, array<string, mixed>>  $models
     */
    public static function from(array $models): Registry
    {
        $built = [];

        foreach ($models as $key => $definition) {
            $built[] = self::model((string) $key, $definition);
        }

        return new Registry($built);
    }

    /**
     * @param  array<string, mixed>  $definition
     */
    private static function model(string $key, array $definition): Model
    {
        $table = $definition['table'] ?? null;

        if ($table === null && isset($definition['class']) && class_exists((string) $definition['class'])) {
            $class = (string) $definition['class'];
            $table = (new $class)->getTable();
        }

        if (! is_string($table) || $table === '') {
            throw new \InvalidArgumentException("Model '{$key}' needs a table, or a class to read one from.");
        }

        $dimensions = [];

        foreach ($definition['dimensions'] ?? [] as $name => $dimension) {
            $dimension = is_array($dimension) ? $dimension : [];

            $dimensions[] = new Dimension(
                key: (string) $name,
                label: (string) ($dimension['label'] ?? $name),
                model: $key,
                column: (string) ($dimension['column'] ?? $name),
                type: (string) ($dimension['type'] ?? 'string'),
            );
        }

        $measures = [];

        foreach ($definition['measures'] ?? [] as $name => $measure) {
            $measure = is_array($measure) ? $measure : [];

            $measures[] = new Measure(
                key: (string) $name,
                label: (string) ($measure['label'] ?? $name),
                aggregate: (string) ($measure['aggregate'] ?? 'count'),
                model: $key,
                column: isset($measure['column']) ? (string) $measure['column'] : null,
                // Anything a person wrote in this file is confirmed by
                // definition. Provisional is what discovery produces, and the
                // whole reason a curated file exists is to stop those being
                // treated as answers.
                provisional: false,
            );
        }

        $relations = [];

        foreach ($definition['relations'] ?? [] as $name => $relation) {
            $relation = is_array($relation) ? $relation : [];
            $target = (string) ($relation['model'] ?? '');

            if ($target === '') {
                throw new \InvalidArgumentException("Relation '{$name}' on '{$key}' does not say which model it points at.");
            }

            $pivot = null;

            if (isset($relation['pivot']) && is_array($relation['pivot'])) {
                $pivot = new Pivot(
                    table: (string) ($relation['pivot']['table'] ?? ''),
                    baseColumn: (string) ($relation['pivot']['base_column'] ?? ''),
                    targetColumn: (string) ($relation['pivot']['target_column'] ?? ''),
                    typeColumn: isset($relation['pivot']['type_column']) ? (string) $relation['pivot']['type_column'] : null,
                    typeValue: isset($relation['pivot']['type_value']) ? (string) $relation['pivot']['type_value'] : null,
                );
            }

            $relations[] = new Relation(
                name: (string) $name,
                target: $target,
                // Defaulting to `many` rather than `one`, because the failure
                // mode of guessing wrong in that direction is a refusal, and
                // guessing wrong in the other is a silently multiplied total.
                cardinality: (string) ($relation['cardinality'] ?? Relation::MANY),
                baseColumn: (string) ($relation['base_column'] ?? ''),
                targetColumn: (string) ($relation['target_column'] ?? ''),
                pivot: $pivot,
            );
        }

        return new Model(
            key: $key,
            table: $table,
            label: (string) ($definition['label'] ?? $key),
            grain: (string) ($definition['grain'] ?? "one row per {$key}"),
            dimensions: $dimensions,
            measures: $measures,
            relations: $relations,
            primaryKey: (string) ($definition['primary_key'] ?? 'id'),
        );
    }
}
