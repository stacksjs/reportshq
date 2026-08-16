<?php

declare(strict_types=1);

/**
 * The semantic layer's tests.
 *
 * Same plain runner as run.php next door, and for the same reason: everything
 * asserted here is grain arithmetic with no Illuminate in it, so it needs php
 * and nothing else. Discovery is the half that genuinely needs a booted
 * application, and it is exercised against a real one rather than mocked.
 *
 * The fixture is EasyOTC's actual shape, cut down: an order has many items and
 * belongs to one member, an item belongs to one product, a product belongs to
 * one category. Those four models are enough to produce every case that
 * matters, and they are the four the first real report will touch.
 *
 *     php packages/laravel/tests/semantic.php
 */

require __DIR__.'/../src/Semantic/GrainMismatch.php';
require __DIR__.'/../src/Semantic/Relation.php';
require __DIR__.'/../src/Semantic/Measure.php';
require __DIR__.'/../src/Semantic/Dimension.php';
require __DIR__.'/../src/Semantic/Model.php';
require __DIR__.'/../src/Semantic/Registry.php';

use ReportsHQ\Laravel\Semantic\Dimension;
use ReportsHQ\Laravel\Semantic\GrainMismatch;
use ReportsHQ\Laravel\Semantic\Measure;
use ReportsHQ\Laravel\Semantic\Model;
use ReportsHQ\Laravel\Semantic\Registry;
use ReportsHQ\Laravel\Semantic\Relation;

final class Runner
{
    public int $passed = 0;

    /** @var list<string> */
    public array $failures = [];

    public function test(string $name, callable $body): void
    {
        try {
            $body($this);
            $this->passed++;
        } catch (Throwable $error) {
            $this->failures[] = $name.': '.$error->getMessage();
        }
    }

    public function assert(bool $condition, string $message): void
    {
        if (! $condition) {
            throw new RuntimeException($message);
        }
    }

    public function same(mixed $expected, mixed $actual, string $message): void
    {
        if ($expected !== $actual) {
            throw new RuntimeException(sprintf(
                '%s (expected %s, got %s)',
                $message,
                json_encode($expected, JSON_UNESCAPED_SLASHES),
                json_encode($actual, JSON_UNESCAPED_SLASHES),
            ));
        }
    }

    public function refuses(callable $body, string $expectedFragment, string $message): void
    {
        try {
            $body();
        } catch (GrainMismatch $error) {
            $this->assert(
                str_contains($error->getMessage(), $expectedFragment),
                $message.' (message was: '.$error->getMessage().')',
            );

            return;
        }

        throw new RuntimeException($message.' (nothing was thrown)');
    }
}

function registry(): Registry
{
    return new Registry([
        new Model(
            key: 'order',
            table: 'orders',
            label: 'Order',
            grain: 'one row per order',
            dimensions: [
                new Dimension('status', 'Status', 'order', 'status'),
                new Dimension('created_at', 'Placed', 'order', 'created_at', 'date'),
            ],
            measures: [
                new Measure('revenue', 'Revenue', 'sum', 'order', 'total_amount'),
                new Measure('count', 'Orders', 'count', 'order'),
                new Measure('customers', 'Buying customers', 'count_distinct', 'order', 'member_id'),
            ],
            relations: [
                new Relation('items', 'order_item', Relation::MANY, 'id', 'order_id'),
                new Relation('member', 'member', Relation::ONE, 'member_id', 'id'),
            ],
        ),
        new Model(
            key: 'order_item',
            table: 'order_items',
            label: 'Order line',
            grain: 'one row per line of an order',
            dimensions: [new Dimension('quantity', 'Quantity', 'order_item', 'quantity', 'number')],
            measures: [new Measure('line_revenue', 'Line revenue', 'sum', 'order_item', 'total_price')],
            relations: [
                new Relation('order', 'order', Relation::ONE, 'order_id', 'id'),
                new Relation('product', 'product', Relation::ONE, 'product_id', 'id'),
            ],
        ),
        new Model(
            key: 'product',
            table: 'products',
            label: 'Product',
            grain: 'one row per product',
            dimensions: [new Dimension('name', 'Name', 'product', 'name')],
            measures: [new Measure('count', 'Products', 'count', 'product')],
            relations: [new Relation('category', 'category', Relation::ONE, 'category_id', 'id')],
        ),
        new Model(
            key: 'category',
            table: 'categories',
            label: 'Category',
            grain: 'one row per category',
            dimensions: [new Dimension('name', 'Name', 'category', 'name')],
            measures: [],
            relations: [],
        ),
        new Model(
            key: 'member',
            table: 'members',
            label: 'Member',
            grain: 'one row per member',
            dimensions: [new Dimension('state', 'State', 'member', 'state')],
            measures: [new Measure('count', 'Members', 'count', 'member')],
            relations: [new Relation('orders', 'order', Relation::MANY, 'id', 'member_id')],
        ),
    ]);
}

$run = new Runner;

/*
 * Paths.
 */
$run->test('a model reaches itself in no hops', function (Runner $run): void {
    $run->same([], registry()->path('order', 'order'), 'expected an empty path');
});

$run->test('a route that does not exist is null, not an empty path', function (Runner $run): void {
    // The difference matters: an empty path means "already there" and would
    // otherwise be read as "join nothing", which is how a category dimension
    // would end up silently selected off the orders table.
    $run->same(null, registry()->path('category', 'member'), 'expected no route');
});

$run->test('the one hop route is preferred over the many hop route', function (Runner $run): void {
    // orders reaches member directly, and also through items and back. The
    // first is the one that keeps the row count.
    $path = registry()->path('order', 'member');

    $run->same(1, count($path ?? []), 'expected a single hop');
    $run->same('member', $path[0]->name, 'expected the belongsTo');
});

$run->test('a route through several models is found', function (Runner $run): void {
    $path = registry()->path('order_item', 'category');

    $run->same(['product', 'category'], array_map(static fn ($r) => $r->name, $path ?? []), 'expected item to product to category');
});

/*
 * Fan-out, which is the whole point.
 */
$run->test('an order grain measure groups by an order dimension', function (Runner $run): void {
    $registry = registry();
    $path = $registry->resolve($registry->model('order')->measure('revenue'), $registry->model('order')->dimension('status'));

    $run->same([], $path, 'expected no join at all');
});

$run->test('an order grain measure groups by its member, which does not fan out', function (Runner $run): void {
    $registry = registry();
    $path = $registry->resolve($registry->model('order')->measure('revenue'), $registry->model('member')->dimension('state'));

    $run->same(1, count($path), 'expected one hop and no refusal');
});

$run->test('revenue by category is refused, and says why', function (Runner $run): void {
    $registry = registry();

    // The report anybody builds first, and the one that is wrong by default in
    // every tool that does not check this.
    $run->refuses(
        static fn () => $registry->resolve(
            $registry->model('order')->measure('revenue'),
            $registry->model('category')->dimension('name'),
        ),
        'reads several rows per one',
        'expected the fan-out named',
    );
});

$run->test('the refusal names both grains in prose', function (Runner $run): void {
    $registry = registry();

    try {
        $registry->resolve(
            $registry->model('order')->measure('revenue'),
            $registry->model('category')->dimension('name'),
        );
    } catch (GrainMismatch $error) {
        $run->assert(str_contains($error->getMessage(), 'one row per order'), 'expected the base grain');
        $run->assert(str_contains($error->getMessage(), 'items'), 'expected the hop that multiplies');

        return;
    }

    $run->assert(false, 'expected a refusal');
});

$run->test('the refusal offers the measure at the other grain', function (Runner $run): void {
    $registry = registry();

    $run->refuses(
        static fn () => $registry->resolve(
            $registry->model('order')->measure('revenue'),
            $registry->model('category')->dimension('name'),
        ),
        "Use 'Line revenue' instead",
        'expected the line grain measure suggested',
    );
});

$run->test('the line grain measure answers the same question', function (Runner $run): void {
    $registry = registry();

    // Revenue by category, asked properly: from the item grain the join to
    // product and category is one to one the whole way.
    $path = $registry->resolve(
        $registry->model('order_item')->measure('line_revenue'),
        $registry->model('category')->dimension('name'),
    );

    $run->same(['product', 'category'], array_map(static fn ($r) => $r->name, $path), 'expected a clean two hop join');
});

$run->test('a member grain measure grouped by an order dimension is refused too', function (Runner $run): void {
    // The mirror case, and the one that is easier to miss: counting members by
    // order status reads a member once per order they placed.
    $registry = registry();

    $run->refuses(
        static fn () => $registry->resolve(
            $registry->model('member')->measure('count'),
            $registry->model('order')->dimension('status'),
        ),
        'reads several rows per one',
        'expected the reverse direction refused as well',
    );
});

$run->test('an unrelated pairing is refused with a different message', function (Runner $run): void {
    $registry = registry();

    $run->refuses(
        static fn () => $registry->resolve(
            $registry->model('category')->measure('count') ?? new Measure('x', 'X', 'count', 'category'),
            $registry->model('member')->dimension('state'),
        ),
        'no relationship',
        'expected an unreachable pairing to say so',
    );
});

/*
 * The value objects refuse nonsense at the door.
 */
$run->test('a sum without a column is refused', function (Runner $run): void {
    try {
        new Measure('x', 'X', 'sum', 'order');
        $run->assert(false, 'expected a refusal');
    } catch (InvalidArgumentException $error) {
        $run->assert(str_contains($error->getMessage(), 'needs a column'), 'expected the reason');
    }
});

$run->test('count is the one aggregate that needs no column', function (Runner $run): void {
    $measure = new Measure('x', 'X', 'count', 'order');
    $run->same(null, $measure->column, 'expected no column');
});

$run->test('a measure cannot be attached to a model it does not belong to', function (Runner $run): void {
    try {
        new Model(
            key: 'order',
            table: 'orders',
            label: 'Order',
            grain: 'one row per order',
            measures: [new Measure('x', 'X', 'count', 'member')],
        );
        $run->assert(false, 'expected a refusal');
    } catch (InvalidArgumentException $error) {
        $run->assert(str_contains($error->getMessage(), 'belongs to'), 'expected the mismatch named');
    }
});

$run->test('no measure claims to survive a fan-out', function (Runner $run): void {
    // min and max happen to survive duplication by luck. Treating them as safe
    // would give a report where four tiles are wrong and two are right, which
    // reads as a data problem rather than a bug.
    foreach (Measure::AGGREGATES as $aggregate) {
        $measure = new Measure('x', 'X', $aggregate, 'order', 'total_amount');
        $run->assert(! $measure->survivesFanOut(), "expected {$aggregate} to be unsafe across a fan-out");
    }
});

$run->test('cardinality is read from the Eloquent relation type', function (Runner $run): void {
    $run->same(Relation::ONE, Relation::cardinalityOf('BelongsTo'), 'belongsTo reads one row');
    $run->same(Relation::ONE, Relation::cardinalityOf('HasOne'), 'hasOne reads one row');
    $run->same(Relation::MANY, Relation::cardinalityOf('HasMany'), 'hasMany reads many');
    $run->same(Relation::MANY, Relation::cardinalityOf('BelongsToMany'), 'belongsToMany reads many');
    // Anything unrecognised is assumed to multiply, because that is the
    // assumption whose failure mode is a refusal rather than a wrong number.
    $run->same(Relation::MANY, Relation::cardinalityOf('SomethingNew'), 'an unknown relation is assumed to fan out');
});

$run->test('a provisional measure is queryable but never recommended', function (Runner $run): void {
    // Discovery invents a sum per numeric column. Against EasyOTC's real
    // models the nearest same-aggregate candidate for "revenue by category"
    // was a category's display order, which is arithmetic rather than an
    // answer. Confidently unrelated advice is worse than none, because
    // somebody who follows it gets a number.
    $registry = new Registry([
        new Model(
            key: 'order',
            table: 'orders',
            label: 'Order',
            grain: 'one row per order',
            dimensions: [],
            measures: [new Measure('revenue', 'Revenue', 'sum', 'order', 'total_amount')],
            relations: [new Relation('categories', 'category', Relation::MANY, 'id', 'order_id')],
        ),
        new Model(
            key: 'category',
            table: 'categories',
            label: 'Category',
            grain: 'one row per category',
            dimensions: [new Dimension('name', 'Name', 'category', 'name')],
            measures: [new Measure('display_order_sum', 'Total display order', 'sum', 'category', 'display_order', provisional: true)],
            relations: [],
        ),
    ]);

    try {
        $registry->resolve($registry->model('order')->measure('revenue'), $registry->model('category')->dimension('name'));
        $run->assert(false, 'expected a refusal');
    } catch (GrainMismatch $error) {
        $run->assert(
            ! str_contains($error->getMessage(), 'Total display order'),
            'expected the guess withheld, got: '.$error->getMessage(),
        );
        $run->assert(
            str_contains($error->getMessage(), 'there is not one yet'),
            'expected it to say no measure exists, got: '.$error->getMessage(),
        );
    }
});

echo "\n";

foreach ($run->failures as $failure) {
    echo "  FAIL  {$failure}\n";
}

printf("\n %d pass, %d fail\n\n", $run->passed, count($run->failures));

exit($run->failures === [] ? 0 : 1);
