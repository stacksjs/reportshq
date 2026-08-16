<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Query;

use ReportsHQ\Laravel\Semantic\Dimension;
use ReportsHQ\Laravel\Semantic\GrainMismatch;
use ReportsHQ\Laravel\Semantic\Measure;
use ReportsHQ\Laravel\Semantic\Registry;
use ReportsHQ\Laravel\Semantic\Relation;

/**
 * A block's question, as SQL.
 *
 * Pure: names in, a string and a list of bindings out, no connection and no
 * Illuminate. That is what lets the whole of it be tested with `php` and
 * nothing else, and it is where the events engine's own tests earned their
 * keep, since the expensive bugs were all arithmetic rather than plumbing.
 *
 * Three rules run through everything here.
 *
 * **Every value is a binding and every identifier came from the registry.** A
 * column that was never declared cannot reach the statement whatever a request
 * asks for, because the only names written into SQL are ones looked up by key
 * in an allowlist. There is no escaping of caller input anywhere, because no
 * caller input is ever written into the statement.
 *
 * **A measure is only evaluated at its own grain.** Every dimension, every
 * filter and the time column are resolved against the measure's model, and a
 * join path that multiplies rows is refused rather than compiled. This is the
 * rule the product's credibility rests on: `SUM(orders.total_amount)` after a
 * join to `order_items` is inflated by the basket size, silently, by a factor
 * that varies per order.
 *
 * **A join that cannot be written exactly is refused, not approximated.** A
 * relation whose columns are unknown compiles to no `ON` clause, and a missing
 * `ON` clause is a cross product rather than an error. Better to say which
 * relation is not supported yet.
 */
final class Compiler
{
    public function __construct(
        private readonly Registry $registry,
        private readonly Dialect $dialect,
    ) {}

    public function compile(Query $query): Compiled
    {
        $base = $this->registry->model($query->measureModel);

        if ($base === null) {
            throw new GrainMismatch("No model named '{$query->measureModel}' is registered.");
        }

        $measure = $base->measure($query->measure);

        if ($measure === null) {
            throw new GrainMismatch("'{$base->label}' has no measure called '{$query->measure}'.");
        }

        $bindings = [];
        $joins = [];
        $selects = [];
        $groups = [];
        $wheres = [];

        // ---- The bucket ----------------------------------------------------
        $time = $query->time === null ? null : $this->dimensionFor($query->time, $measure, $joins);

        if ($time !== null && $query->grain !== null) {
            if (! $time->isTemporal()) {
                throw new GrainMismatch("'{$time->label}' is not a date, so it cannot be bucketed by {$query->grain}.");
            }

            $column = $this->column($time);
            $bucket = $this->dialect->bucket($column, $query->grain, $this->offsetHours($query->timezone, $query->from));

            $selects[] = "{$bucket} AS ".$this->dialect->quote('bucket');
            $groups[] = $bucket;
        }

        // ---- The split -----------------------------------------------------
        if ($query->dimension !== null) {
            $dimension = $this->dimensionFor($query->dimension, $measure, $joins);
            $column = $this->column($dimension);

            $selects[] = "{$column} AS ".$this->dialect->quote('series');
            $groups[] = $column;
        }

        // ---- The number ----------------------------------------------------
        $selects[] = $this->aggregate($measure).' AS '.$this->dialect->quote('value');

        // ---- The range -----------------------------------------------------
        if ($time !== null) {
            $column = $this->column($time);

            if ($query->from !== null) {
                $wheres[] = "{$column} >= ?";
                $bindings[] = $query->from;
            }

            if ($query->to !== null) {
                // Half open, so a row at exactly midnight belongs to one day
                // rather than to two.
                $wheres[] = "{$column} < ?";
                $bindings[] = $query->to;
            }
        }

        // ---- The conditions ------------------------------------------------
        foreach ($query->filters as $filter) {
            $dimension = $this->dimensionFor(['model' => $filter->model, 'key' => $filter->dimension], $measure, $joins);
            [$sql, $values] = $this->condition($filter, $this->column($dimension));

            $wheres[] = $sql;
            $bindings = [...$bindings, ...$values];
        }

        // ---- Assemble ------------------------------------------------------
        $sql = 'SELECT '.implode(', ', $selects)
            .' FROM '.$this->dialect->quote($base->table);

        foreach ($joins as $join) {
            $sql .= ' '.$join;
        }

        if ($wheres !== []) {
            $sql .= ' WHERE '.implode(' AND ', $wheres);
        }

        if ($groups !== []) {
            $sql .= ' GROUP BY '.implode(', ', $groups);
            $sql .= ' ORDER BY '.implode(', ', $groups);
        }

        if ($query->limit > 0) {
            // Inlined rather than bound, because it is an integer this class
            // produced from an integer property and several drivers refuse a
            // bound parameter in LIMIT.
            $sql .= ' LIMIT '.(int) $query->limit;
        }

        return new Compiled($sql, $bindings);
    }

    /**
     * Resolve a dimension against the measure's grain, adding any joins it needs.
     *
     * The gate. `Registry::resolve` throws when the path multiplies rows, and
     * that exception carries the message a person reads, so it is deliberately
     * not caught and reworded here.
     *
     * @param  array{model: string, key: string}  $reference
     * @param  list<string>  $joins
     */
    private function dimensionFor(array $reference, Measure $measure, array &$joins): Dimension
    {
        $model = $this->registry->model($reference['model']);

        if ($model === null) {
            throw new GrainMismatch("No model named '{$reference['model']}' is registered.");
        }

        $dimension = $model->dimension($reference['key']);

        if ($dimension === null) {
            // Also the allowlist speaking: a column absent from the registry is
            // indistinguishable from one that never existed, which is the
            // point.
            throw new GrainMismatch("'{$model->label}' has no field called '{$reference['key']}'.");
        }

        $path = $this->registry->resolve($measure, $dimension);

        $from = $this->registry->model($measure->model);

        foreach ($path as $relation) {
            $target = $this->registry->model($relation->target);

            if ($from === null || $target === null) {
                throw new GrainMismatch("The route to '{$dimension->label}' passes through a model that is not registered.");
            }

            foreach ($this->join($relation, $from->table, $target->table) as $clause) {
                // A dimension and a filter often travel the same hop, and
                // joining a table twice is an ambiguous column reference rather
                // than a duplicate row.
                if (! in_array($clause, $joins, true)) {
                    $joins[] = $clause;
                }
            }

            $from = $target;
        }

        return $dimension;
    }

    /**
     * One hop as its `JOIN` clauses, or a refusal naming what is unsupported.
     *
     * `LEFT JOIN` throughout. An inner join would drop the rows a measure is
     * counting whenever the far side is missing, so an order with no member
     * would vanish from a total rather than appearing under a blank label,
     * which is a wrong number rather than an untidy chart.
     *
     * @return list<string>
     */
    private function join(Relation $relation, string $baseTable, string $targetTable): array
    {
        if ($relation->pivot === null) {
            if ($relation->baseColumn === '' || $relation->targetColumn === '') {
                throw new GrainMismatch(
                    "The '{$relation->name}' relationship does not say which columns link the two tables, "
                    .'so it cannot be joined. Declare it in the config.'
                );
            }

            return [
                'LEFT JOIN '.$this->dialect->quote($targetTable)
                    .' ON '.$this->dialect->qualify($targetTable, $relation->targetColumn)
                    .' = '.$this->dialect->qualify($baseTable, $relation->baseColumn),
            ];
        }

        $pivot = $relation->pivot;

        $first = 'LEFT JOIN '.$this->dialect->quote($pivot->table)
            .' ON '.$this->dialect->qualify($pivot->table, $pivot->baseColumn)
            .' = '.$this->dialect->qualify($baseTable, $relation->baseColumn);

        if ($pivot->isMorph()) {
            // Without this the pivot hands back every owner's rows, since one
            // table holds them all.
            $first .= ' AND '.$this->dialect->qualify($pivot->table, (string) $pivot->typeColumn)
                ." = '".str_replace("'", "''", (string) $pivot->typeValue)."'";
        }

        return [
            $first,
            'LEFT JOIN '.$this->dialect->quote($targetTable)
                .' ON '.$this->dialect->qualify($targetTable, $relation->targetColumn)
                .' = '.$this->dialect->qualify($pivot->table, $pivot->targetColumn),
        ];
    }

    private function aggregate(Measure $measure): string
    {
        $model = $this->registry->model($measure->model);
        $column = $measure->column === null || $model === null
            ? null
            : $this->dialect->qualify($model->table, $measure->column);

        return match ($measure->aggregate) {
            'count' => 'COUNT(*)',
            'count_distinct' => "COUNT(DISTINCT {$column})",
            // COALESCE, so a range with no matching rows reports zero revenue
            // rather than null, which a chart would otherwise draw as a gap and
            // a total would read as unknown.
            'sum' => "COALESCE(SUM({$column}), 0)",
            'avg' => "AVG({$column})",
            'min' => "MIN({$column})",
            'max' => "MAX({$column})",
        };
    }

    private function column(Dimension $dimension): string
    {
        $model = $this->registry->model($dimension->model);

        if ($model === null) {
            throw new GrainMismatch("Dimension '{$dimension->key}' names a model that is not registered.");
        }

        return $this->dialect->qualify($model->table, $dimension->column);
    }

    /** @return array{0: string, 1: list<string|int|float|bool>} */
    private function condition(Filter $filter, string $column): array
    {
        return match ($filter->operator) {
            'is' => ["{$column} = ?", [$filter->value]],
            // `IS DISTINCT FROM` semantics by hand: a null column is not equal
            // to anything, so a plain `<> ?` silently drops every row that has
            // no value, and "status is not cancelled" would lose the orders
            // with no status at all.
            'is_not' => ["({$column} <> ? OR {$column} IS NULL)", [$filter->value]],
            'contains' => [$this->dialect->contains($column), ['%'.$filter->value.'%']],
            'starts_with' => [$this->dialect->contains($column), [$filter->value.'%']],
            'gt' => ["{$column} > ?", [$filter->value]],
            'lt' => ["{$column} < ?", [$filter->value]],
            'exists' => ["{$column} IS NOT NULL", []],
            'not_exists' => ["{$column} IS NULL", []],
        };
    }

    /**
     * The zone's offset in hours at the start of the range.
     *
     * Taken once rather than per row, which is the trade the dialects document:
     * exact except across a daylight saving boundary, where one bucket is an
     * hour wide or three.
     */
    private function offsetHours(string $timezone, ?string $at): float
    {
        try {
            $zone = new \DateTimeZone($timezone);
        } catch (\Exception) {
            return 0.0;
        }

        $moment = new \DateTimeImmutable($at ?? 'now', new \DateTimeZone('UTC'));

        return $zone->getOffset($moment) / 3600;
    }
}
