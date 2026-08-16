<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * Every model the builder may query, and the rules about combining them.
 *
 * Two questions are asked of this class and nothing else is. Can I reach that
 * dimension from this measure's grain, and does reaching it multiply my rows.
 * The second question is the one the product's credibility rests on.
 */
final class Registry
{
    /** @var array<string, Model> */
    public readonly array $models;

    /** @param list<Model> $models */
    public function __construct(array $models)
    {
        $byKey = [];

        foreach ($models as $model) {
            $byKey[$model->key] = $model;
        }

        $this->models = $byKey;
    }

    public function model(string $key): ?Model
    {
        return $this->models[$key] ?? null;
    }

    /**
     * A hop sequence from one model to another, preferring one that keeps the
     * row count.
     *
     * Two searches rather than one, and the reason is worth writing down. A
     * single breadth first walk returns the shortest route, and shortest is not
     * the property that matters: from an order line, both `order -> categories`
     * and `product -> category` are two hops, the first multiplies rows and the
     * second does not, and which one a plain walk finds first comes down to the
     * order somebody declared their relations in. So the clean routes are
     * searched on their own first, and the full graph only if that finds
     * nothing.
     *
     * When both searches fail the answer is null. When only the second
     * succeeds, the route it found is the one quoted back in the refusal, which
     * is what lets the message name the hop that multiplies.
     *
     * @return list<Relation>|null Null when there is no route at all.
     */
    public function path(string $from, string $to): ?array
    {
        return $this->search($from, $to, true) ?? $this->search($from, $to, false);
    }

    /**
     * Breadth first from one model to another.
     *
     * @param  bool  $cleanOnly  Ignore hops that multiply rows.
     * @return list<Relation>|null
     */
    private function search(string $from, string $to, bool $cleanOnly): ?array
    {
        if ($from === $to) {
            return [];
        }

        if ($this->model($from) === null || $this->model($to) === null) {
            return null;
        }

        /** @var list<array{model: string, path: list<Relation>}> $queue */
        $queue = [['model' => $from, 'path' => []]];
        $seen = [$from => true];

        while ($queue !== []) {
            $step = array_shift($queue);
            $model = $this->model($step['model']);

            if ($model === null) {
                continue;
            }

            foreach ($model->relations as $relation) {
                if ($cleanOnly && $relation->fansOut()) {
                    continue;
                }

                if (isset($seen[$relation->target])) {
                    continue;
                }

                $path = [...$step['path'], $relation];

                if ($relation->target === $to) {
                    return $path;
                }

                $seen[$relation->target] = true;
                $queue[] = ['model' => $relation->target, 'path' => $path];
            }
        }

        return null;
    }

    /** @param list<Relation> $path */
    public function fansOut(array $path): bool
    {
        foreach ($path as $relation) {
            if ($relation->fansOut()) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check that a measure and a dimension can appear in the same query.
     *
     * Throws rather than returning false, and the message is written for the
     * person who asked rather than for the person who wrote this. It names
     * both grains in prose, says which hop multiplies the rows, and where a
     * measure at the far grain exists it says to use that one instead, because
     * "revenue by category" is a reasonable thing to want and the answer is
     * not "you cannot".
     *
     * @return list<Relation> The join path, when the pairing is allowed.
     */
    public function resolve(Measure $measure, Dimension $dimension): array
    {
        $base = $this->model($measure->model);
        $target = $this->model($dimension->model);

        if ($base === null || $target === null) {
            throw new GrainMismatch("Measure '{$measure->key}' or dimension '{$dimension->key}' names a model that is not registered.");
        }

        $path = $this->path($base->key, $target->key);

        if ($path === null) {
            throw new GrainMismatch(
                "There is no relationship from {$base->label} to {$target->label}, so "
                ."'{$measure->label}' cannot be grouped by '{$dimension->label}'."
            );
        }

        if (! $this->fansOut($path)) {
            return $path;
        }

        $hop = null;

        foreach ($path as $relation) {
            if ($relation->fansOut()) {
                $hop = $relation;
                break;
            }
        }

        $message = "'{$measure->label}' counts {$base->grain}, and grouping it by "
            ."'{$dimension->label}' has to join through {$hop?->name}, which reads "
            .'several rows per one. Every value would be multiplied by how many.';

        $alternative = $this->alternativeFor($measure, $target, $path);

        if ($alternative !== null) {
            $grain = $this->model($alternative->model)?->grain ?? 'a finer grain';
            $message .= " Use '{$alternative->label}' instead: it counts {$grain}, which reaches {$target->label} without multiplying.";
        } else {
            $offending = $this->model($hop?->target ?? '');
            $message .= $offending === null
                ? ' A measure at the finer grain would answer this.'
                : " A measure counting {$offending->grain} would answer this, and there is not one yet.";
        }

        throw new GrainMismatch($message);
    }

    /**
     * The same question, asked from a grain that can actually reach the target.
     *
     * Not "a measure on the model being grouped by": grouping revenue by
     * category needs the measure on `order_items`, and `categories` has no
     * revenue of its own and never will.
     *
     * And not "any measure doing the same arithmetic that reaches the target"
     * either, which is what this did first. Matching on the aggregate alone
     * makes every `sum` in the schema a candidate, and against EasyOTC's real
     * models the advice that came out was to total a category's sort order
     * instead of its revenue. Confidently unrelated, which is worse than no
     * suggestion: somebody following it gets a number.
     *
     * The candidate has to sit **on the route** between the two grains. That is
     * what makes it the same question rather than a different one that happens
     * to add things up: the fan-out begins at a particular hop, and the model
     * on the far side of that hop is the grain the query should have started
     * from. Walking the path in order also means the nearest usable grain wins,
     * so a three hop route suggests the first workable step rather than the
     * last.
     *
     * Matched on the aggregate rather than the key, because `orders.revenue`
     * and `order_items.line_revenue` are exactly the pair this exists for and
     * they are not obliged to share a name.
     *
     * A provisional measure is never suggested. Discovery invents one per
     * numeric column, and quoting a guess back as advice is how the refusal for
     * revenue by category came to recommend totalling a category's display
     * order. Until somebody has confirmed a measure in the config, the honest
     * answer is that the grain has none yet.
     *
     * @param  list<Relation>  $path
     */
    public function alternativeFor(Measure $measure, Model $target, array $path): ?Measure
    {
        $candidates = [];

        // Anything on the route first, nearest hop first, since the fan-out
        // starts somewhere along it and the grain on the far side of that hop
        // is usually the one the query should have begun from.
        foreach ($path as $relation) {
            $candidates[] = $relation->target;
        }

        // Then anything else reachable from where we started, which covers the
        // case the route misses: an order reaches its categories directly
        // through a morph, so its lines never appear on that path even though
        // the line grain is exactly what answers the question.
        foreach (array_keys($this->models) as $key) {
            $candidates[] = $key;
        }

        foreach ($candidates as $key) {
            $model = $this->model($key);

            if ($model === null || $model->key === $measure->model) {
                continue;
            }

            // Same subject area, or the advice is a non sequitur.
            if ($this->path($measure->model, $model->key) === null) {
                continue;
            }

            $onward = $this->path($model->key, $target->key);

            if ($onward === null || $this->fansOut($onward)) {
                continue;
            }

            foreach ($model->measures as $candidate) {
                if ($candidate->aggregate === $measure->aggregate && ! $candidate->provisional) {
                    return $candidate;
                }
            }
        }

        return null;
    }
}
