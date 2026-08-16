<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * A number, and the grain it is a number of.
 *
 * The grain is the whole point. `SUM(orders.total_amount)` is revenue per
 * order; `SUM(order_items.total_price)` is revenue per line. They come to the
 * same total over the same orders and they are not interchangeable, because
 * only one of them survives a join to the other's table.
 *
 * A measure therefore knows which model it belongs to, and the compiler
 * refuses to evaluate it once the query has joined its way to a different
 * grain. That refusal is the single most valuable thing this layer does.
 */
final class Measure
{
    public const AGGREGATES = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'];

    /**
     * @param  bool  $provisional  A guess from discovery that no person has confirmed.
     *
     * Discovery offers a sum against every numeric column it finds, because
     * showing the candidates is how somebody editing the config remembers what
     * is there. Most of those are wrong to use: totalling a category's display
     * order is arithmetic, not a number anybody wants.
     *
     * The flag exists because the compiler quotes measures back at people. When
     * it refuses "revenue by category" it names the measure to use instead, and
     * against a draft registry the nearest same-aggregate candidate was
     * "Total display order". Confidently unrelated advice is worse than none,
     * since somebody who follows it gets a number. So a provisional measure can
     * be queried, and is never recommended.
     */
    public function __construct(
        public readonly string $key,
        public readonly string $label,
        public readonly string $aggregate,
        public readonly string $model,
        public readonly ?string $column = null,
        public readonly bool $provisional = false,
    ) {
        if (! in_array($aggregate, self::AGGREGATES, true)) {
            throw new \InvalidArgumentException(
                "Unknown aggregate '{$aggregate}'. Known: ".implode(', ', self::AGGREGATES).'.'
            );
        }

        // `count` is the only aggregate that means something without a column,
        // because counting rows needs no value from them. Everything else
        // reading a column it was never given would produce a query that runs
        // and answers the wrong question.
        if ($aggregate !== 'count' && $column === null) {
            throw new \InvalidArgumentException("Measure '{$key}' uses {$aggregate} and needs a column.");
        }
    }

    /**
     * Whether this measure survives being computed over duplicated rows.
     *
     * Nothing does, and that is not a pessimism: `count` and `sum` are
     * multiplied by the fan-out, `avg` is dragged toward whichever rows
     * duplicated most, and `min`/`max` happen to survive by luck rather than
     * by arithmetic. Treating the last two as safe would mean a report where
     * four tiles are wrong and two are right, which is worse than six wrong
     * tiles because it reads as a data problem rather than a bug.
     */
    public function survivesFanOut(): bool
    {
        return false;
    }
}
