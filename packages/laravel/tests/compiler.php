<?php

declare(strict_types=1);

/**
 * The compiler's tests.
 *
 * Same plain runner, same reason: the compiler is names in and a string out,
 * with no connection anywhere, so it needs `php` and nothing else. What it
 * produces is checked against SQL written by hand, because the expensive
 * mistakes here are arithmetic and every one of them runs perfectly well.
 *
 * The fixture is EasyOTC's real shape: an order has many items and belongs to
 * one member, an item belongs to one product, a product belongs to one
 * category, and an order reaches categories directly through a morph pivot.
 * That last one is not invented for the tests; it is why revenue by category
 * has no clean route from the order grain in that application.
 *
 *     php packages/laravel/tests/compiler.php
 */

require __DIR__.'/../src/Semantic/GrainMismatch.php';
require __DIR__.'/../src/Semantic/Pivot.php';
require __DIR__.'/../src/Semantic/Relation.php';
require __DIR__.'/../src/Semantic/Measure.php';
require __DIR__.'/../src/Semantic/Dimension.php';
require __DIR__.'/../src/Semantic/Model.php';
require __DIR__.'/../src/Semantic/Registry.php';
require __DIR__.'/../src/Query/Dialect.php';
require __DIR__.'/../src/Query/PostgresDialect.php';
require __DIR__.'/../src/Query/MySqlDialect.php';
require __DIR__.'/../src/Query/SqliteDialect.php';
require __DIR__.'/../src/Query/Filter.php';
require __DIR__.'/../src/Query/Query.php';
require __DIR__.'/../src/Query/Compiled.php';
require __DIR__.'/../src/Query/Compiler.php';

use ReportsHQ\Laravel\Query\Compiler;
use ReportsHQ\Laravel\Query\Dialect;
use ReportsHQ\Laravel\Query\Filter;
use ReportsHQ\Laravel\Query\MySqlDialect;
use ReportsHQ\Laravel\Query\PostgresDialect;
use ReportsHQ\Laravel\Query\Query;
use ReportsHQ\Laravel\Query\SqliteDialect;
use ReportsHQ\Laravel\Semantic\Dimension;
use ReportsHQ\Laravel\Semantic\GrainMismatch;
use ReportsHQ\Laravel\Semantic\Measure;
use ReportsHQ\Laravel\Semantic\Model;
use ReportsHQ\Laravel\Semantic\Pivot;
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
            throw new RuntimeException(sprintf("%s\n  expected: %s\n  actual:   %s", $message, $expected, $actual));
        }
    }

    public function contains(string $needle, string $haystack, string $message): void
    {
        if (! str_contains($haystack, $needle)) {
            throw new RuntimeException("{$message}\n  wanted:   {$needle}\n  in:       {$haystack}");
        }
    }

    public function refuses(callable $body, string $fragment, string $message): void
    {
        try {
            $body();
        } catch (GrainMismatch $error) {
            $this->assert(str_contains($error->getMessage(), $fragment), $message.' (message: '.$error->getMessage().')');

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
                new Measure('average', 'Average order', 'avg', 'order', 'total_amount'),
            ],
            relations: [
                new Relation('items', 'order_item', Relation::MANY, 'id', 'order_id'),
                new Relation('member', 'member', Relation::ONE, 'member_id', 'id'),
                new Relation('categories', 'category', Relation::MANY, 'id', 'id', new Pivot(
                    table: 'categorizables',
                    baseColumn: 'categorizable_id',
                    targetColumn: 'category_id',
                    typeColumn: 'categorizable_type',
                    typeValue: 'App\\Models\\Order',
                )),
            ],
        ),
        new Model(
            key: 'order_item',
            table: 'order_items',
            label: 'Order line',
            grain: 'one row per line of an order',
            dimensions: [],
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
            measures: [],
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

function sqlite(): Compiler
{
    return new Compiler(registry(), new SqliteDialect);
}

$run = new Runner;

/*
 * The simple shapes.
 */
$run->test('a bare measure is one aggregate over one table', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(measureModel: 'order', measure: 'revenue'));

    $run->same(
        'SELECT COALESCE(SUM("orders"."total_amount"), 0) AS "value" FROM "orders"',
        $compiled->sql,
        'expected the plainest possible statement',
    );
    $run->same([], $compiled->bindings, 'expected no bindings');
});

$run->test('count needs no column and never gets one', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(measureModel: 'order', measure: 'count'));

    $run->contains('COUNT(*)', $compiled->sql, 'expected a plain row count');
});

$run->test('a distinct count names the column it is distinct on', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(measureModel: 'order', measure: 'customers'));

    $run->contains('COUNT(DISTINCT "orders"."member_id")', $compiled->sql, 'expected the distinct column');
});

$run->test('a sum coalesces and an average does not', function (Runner $run): void {
    // An empty range should report zero revenue rather than null, which a chart
    // draws as a gap. An empty average is genuinely unknown, and coalescing it
    // to zero would claim every order was free.
    $run->contains('COALESCE(SUM(', sqlite()->compile(new Query(measureModel: 'order', measure: 'revenue'))->sql, 'sum');
    $run->contains('AVG("orders"."total_amount")', sqlite()->compile(new Query(measureModel: 'order', measure: 'average'))->sql, 'avg');
});

/*
 * Splitting and joining.
 */
$run->test('a same table split needs no join at all', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order',
        measure: 'revenue',
        dimension: ['model' => 'order', 'key' => 'status'],
    ));

    $run->assert(! str_contains($compiled->sql, 'JOIN'), 'expected no join: '.$compiled->sql);
    $run->contains('GROUP BY "orders"."status"', $compiled->sql, 'expected the group');
});

$run->test('a one hop split joins on the columns the relation names', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order',
        measure: 'revenue',
        dimension: ['model' => 'member', 'key' => 'state'],
    ));

    $run->contains(
        'LEFT JOIN "members" ON "members"."id" = "orders"."member_id"',
        $compiled->sql,
        'expected the belongsTo written from base to target',
    );
});

$run->test('the join is a LEFT JOIN, so a measure keeps its rows', function (Runner $run): void {
    // An inner join drops orders with no member, which turns a total into a
    // different and smaller total. An untidy chart beats a wrong number.
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order',
        measure: 'revenue',
        dimension: ['model' => 'member', 'key' => 'state'],
    ));

    $run->assert(! str_contains($compiled->sql, 'INNER JOIN'), 'expected no inner join');
    $run->contains('LEFT JOIN', $compiled->sql, 'expected a left join');
});

$run->test('a two hop route joins both tables in order', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order_item',
        measure: 'line_revenue',
        dimension: ['model' => 'category', 'key' => 'name'],
    ));

    $run->contains('LEFT JOIN "products" ON "products"."id" = "order_items"."product_id"', $compiled->sql, 'first hop');
    $run->contains('LEFT JOIN "categories" ON "categories"."id" = "products"."category_id"', $compiled->sql, 'second hop');
});

$run->test('a table is joined once however many things need it', function (Runner $run): void {
    // Grouping by a member's state and filtering on it as well travels the same
    // hop twice. Joining twice is an ambiguous column reference, not a
    // duplicate row, so it fails loudly rather than quietly; either way it is
    // wrong.
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order',
        measure: 'revenue',
        dimension: ['model' => 'member', 'key' => 'state'],
        filters: [new Filter('member', 'state', 'is', 'CA')],
    ));

    $run->same(1, substr_count($compiled->sql, 'LEFT JOIN "members"'), 'expected exactly one join');
});

/*
 * Fan-out, which is the whole point.
 */
$run->test('revenue by category is refused from the order grain', function (Runner $run): void {
    $run->refuses(
        static fn () => sqlite()->compile(new Query(
            measureModel: 'order',
            measure: 'revenue',
            dimension: ['model' => 'category', 'key' => 'name'],
        )),
        'reads several rows per one',
        'expected the fan-out refused before any SQL was written',
    );
});

$run->test('the same question compiles from the line grain', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order_item',
        measure: 'line_revenue',
        dimension: ['model' => 'category', 'key' => 'name'],
    ));

    $run->contains('SUM("order_items"."total_price")', $compiled->sql, 'expected the line grain measure');
});

$run->test('a filter through a fanning hop is refused too', function (Runner $run): void {
    // Easy to miss, because the dimension being grouped by is innocent. A
    // filter joins exactly the same way and multiplies exactly the same rows.
    $run->refuses(
        static fn () => sqlite()->compile(new Query(
            measureModel: 'order',
            measure: 'revenue',
            filters: [new Filter('category', 'name', 'is', 'Pain relief')],
        )),
        'reads several rows per one',
        'expected a filter to be checked as strictly as a dimension',
    );
});

/*
 * Time.
 */
$run->test('a daily bucket groups and orders by the bucket', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order',
        measure: 'revenue',
        time: ['model' => 'order', 'key' => 'created_at'],
        grain: 'day',
        from: '2026-08-01T00:00:00Z',
        to: '2026-09-01T00:00:00Z',
    ));

    $run->contains('AS "bucket"', $compiled->sql, 'expected a bucket column');
    $run->contains('GROUP BY strftime', $compiled->sql, 'expected the bucket grouped');
    $run->contains('ORDER BY strftime', $compiled->sql, 'expected the bucket ordered');
    $run->same(['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'], $compiled->bindings, 'expected the range bound');
});

$run->test('the range is half open', function (Runner $run): void {
    // A row at exactly midnight belongs to one day, not to two.
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order',
        measure: 'revenue',
        time: ['model' => 'order', 'key' => 'created_at'],
        from: '2026-08-01T00:00:00Z',
        to: '2026-09-01T00:00:00Z',
    ));

    $run->contains('>= ?', $compiled->sql, 'expected an inclusive start');
    $run->contains('< ?', $compiled->sql, 'expected an exclusive end');
});

$run->test('a non date column cannot be bucketed', function (Runner $run): void {
    $run->refuses(
        static fn () => sqlite()->compile(new Query(
            measureModel: 'order',
            measure: 'revenue',
            time: ['model' => 'order', 'key' => 'status'],
            grain: 'day',
        )),
        'is not a date',
        'expected a string column refused as a time axis',
    );
});

$run->test('a timezone shifts the bucket, and UTC does not', function (Runner $run): void {
    $utc = sqlite()->compile(new Query(
        measureModel: 'order', measure: 'revenue',
        time: ['model' => 'order', 'key' => 'created_at'], grain: 'day',
        from: '2026-08-01T00:00:00Z', timezone: 'UTC',
    ));

    $la = sqlite()->compile(new Query(
        measureModel: 'order', measure: 'revenue',
        time: ['model' => 'order', 'key' => 'created_at'], grain: 'day',
        from: '2026-08-01T00:00:00Z', timezone: 'America/Los_Angeles',
    ));

    $run->assert(! str_contains($utc->sql, 'hours'), 'expected no shift for UTC: '.$utc->sql);
    // August is daylight saving, so Los Angeles is seven hours behind.
    $run->contains("'-7 hours'", $la->sql, 'expected the summer offset');
});

$run->test('an unparseable zone falls back to UTC rather than throwing', function (Runner $run): void {
    // A stored report carrying a zone that has since been renamed should draw
    // in UTC, not fail to draw.
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order', measure: 'revenue',
        time: ['model' => 'order', 'key' => 'created_at'], grain: 'day',
        timezone: 'Mars/Olympus_Mons',
    ));

    $run->assert(! str_contains($compiled->sql, 'hours'), 'expected no shift');
});

/*
 * Filters.
 */
$run->test('every value travels as a binding', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order',
        measure: 'revenue',
        filters: [new Filter('order', 'status', 'is', "'; DROP TABLE orders; --")],
    ));

    $run->contains('"orders"."status" = ?', $compiled->sql, 'expected a placeholder');
    $run->same(["'; DROP TABLE orders; --"], $compiled->bindings, 'expected the value bound, not written');
});

$run->test('is_not keeps the rows that have no value at all', function (Runner $run): void {
    // A plain <> drops nulls, so "status is not cancelled" would lose every
    // order with no status, and the total would quietly shrink.
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order',
        measure: 'revenue',
        filters: [new Filter('order', 'status', 'is_not', 'cancelled')],
    ));

    $run->contains('IS NULL', $compiled->sql, 'expected nulls kept');
});

$run->test('contains and starts_with differ only in the wildcard', function (Runner $run): void {
    $contains = sqlite()->compile(new Query(
        measureModel: 'order', measure: 'revenue',
        filters: [new Filter('order', 'status', 'contains', 'ship')],
    ));

    $starts = sqlite()->compile(new Query(
        measureModel: 'order', measure: 'revenue',
        filters: [new Filter('order', 'status', 'starts_with', 'ship')],
    ));

    $run->same(['%ship%'], $contains->bindings, 'expected wildcards on both sides');
    $run->same(['ship%'], $starts->bindings, 'expected a trailing wildcard only');
});

$run->test('the presence operators carry no value', function (Runner $run): void {
    $compiled = sqlite()->compile(new Query(
        measureModel: 'order', measure: 'revenue',
        filters: [new Filter('order', 'status', 'exists')],
    ));

    $run->contains('IS NOT NULL', $compiled->sql, 'expected a presence test');
    $run->same([], $compiled->bindings, 'expected nothing bound');
});

$run->test('a filter needing a value is refused without one', function (Runner $run): void {
    try {
        new Filter('order', 'status', 'is');
        $run->assert(false, 'expected a refusal');
    } catch (InvalidArgumentException $error) {
        $run->contains('needs a value', $error->getMessage(), 'expected the reason');
    }
});

/*
 * The allowlist.
 */
$run->test('a column that is not a declared dimension cannot be reached', function (Runner $run): void {
    // The security boundary, stated as a test. There is no escaping anywhere in
    // the compiler because no caller input is ever written into the statement:
    // an unknown name simply has nothing to look up.
    $run->refuses(
        static fn () => sqlite()->compile(new Query(
            measureModel: 'order',
            measure: 'revenue',
            dimension: ['model' => 'member', 'key' => 'password'],
        )),
        'has no field called',
        'expected an undeclared column refused',
    );
});

$run->test('an unknown measure is refused by name', function (Runner $run): void {
    $run->refuses(
        static fn () => sqlite()->compile(new Query(measureModel: 'order', measure: 'profit')),
        "has no measure called 'profit'",
        'expected the missing measure named',
    );
});

$run->test('a relation with no join columns is refused, not guessed', function (Runner $run): void {
    // Discovery keeps a relation it cannot read the columns of, so the grain
    // check still sees the hop. The compiler is where it stops, because a join
    // missing its ON clause is a cross product rather than an error.
    $registry = new Registry([
        new Model(
            key: 'order', table: 'orders', label: 'Order', grain: 'one row per order',
            measures: [new Measure('count', 'Orders', 'count', 'order')],
            relations: [new Relation('mystery', 'thing', Relation::ONE, '', '')],
        ),
        new Model(
            key: 'thing', table: 'things', label: 'Thing', grain: 'one row per thing',
            dimensions: [new Dimension('name', 'Name', 'thing', 'name')],
        ),
    ]);

    $compiler = new Compiler($registry, new SqliteDialect);

    $run->refuses(
        static fn () => $compiler->compile(new Query(
            measureModel: 'order', measure: 'count',
            dimension: ['model' => 'thing', 'key' => 'name'],
        )),
        'does not say which columns',
        'expected the unjoinable relation named',
    );
});

/*
 * Pivots.
 */
$run->test('a many to many pivot is always refused, whatever the measure', function (Runner $run): void {
    // Worth stating plainly: belongsToMany and morphToMany multiply by
    // definition, so no measure survives one and the grain check refuses every
    // query that needs a pivot hop. EasyOTC's orders reach their categories
    // this way, which is why that report has no clean route from the order
    // grain and needs the line grain instead.
    $run->refuses(
        static fn () => sqlite()->compile(new Query(
            measureModel: 'order',
            measure: 'count',
            dimension: ['model' => 'category', 'key' => 'name'],
        )),
        'reads several rows per one',
        'expected the pivot hop refused',
    );
});

$run->test('a one to one pivot joins twice and pins the owner type', function (Runner $run): void {
    // The only shape that reaches the compiler's pivot branch: a pivot row that
    // exists at most once per owner. Without the type condition the pivot hands
    // back every owner's rows, since one table holds them all.
    $registry = new Registry([
        new Model(
            key: 'order', table: 'orders', label: 'Order', grain: 'one row per order',
            measures: [new Measure('count', 'Orders', 'count', 'order')],
            relations: [new Relation('label', 'category', Relation::ONE, 'id', 'id', new Pivot(
                table: 'categorizables',
                baseColumn: 'categorizable_id',
                targetColumn: 'category_id',
                typeColumn: 'categorizable_type',
                typeValue: 'App\\Models\\Order',
            ))],
        ),
        new Model(
            key: 'category', table: 'categories', label: 'Category', grain: 'one row per category',
            dimensions: [new Dimension('name', 'Name', 'category', 'name')],
        ),
    ]);

    $compiled = (new Compiler($registry, new SqliteDialect))->compile(new Query(
        measureModel: 'order',
        measure: 'count',
        dimension: ['model' => 'category', 'key' => 'name'],
    ));

    $run->contains('LEFT JOIN "categorizables" ON "categorizables"."categorizable_id" = "orders"."id"', $compiled->sql, 'expected the pivot joined');
    $run->contains('"categorizables"."categorizable_type" = \'App\\Models\\Order\'', $compiled->sql, 'expected the type pinned');
    $run->contains('LEFT JOIN "categories" ON "categories"."id" = "categorizables"."category_id"', $compiled->sql, 'expected the second hop');
});

$run->test('a morph pivot without both type parts is refused at construction', function (Runner $run): void {
    try {
        new Pivot('categorizables', 'categorizable_id', 'category_id', typeColumn: 'categorizable_type');
        $run->assert(false, 'expected a refusal');
    } catch (InvalidArgumentException $error) {
        $run->contains('both a type column and a type value', $error->getMessage(), 'expected the reason');
    }
});

/*
 * Dialects.
 */
$run->test('each database buckets a day its own way', function (Runner $run): void {
    $query = new Query(
        measureModel: 'order', measure: 'revenue',
        time: ['model' => 'order', 'key' => 'created_at'], grain: 'day',
        from: '2026-08-01T00:00:00Z',
    );

    $run->contains('strftime', (new Compiler(registry(), new SqliteDialect))->compile($query)->sql, 'sqlite');
    $run->contains('date_trunc', (new Compiler(registry(), new PostgresDialect))->compile($query)->sql, 'postgres');
    $run->contains('DATE_FORMAT', (new Compiler(registry(), new MySqlDialect))->compile($query)->sql, 'mysql');
});

$run->test('each database quotes identifiers its own way', function (Runner $run): void {
    $query = new Query(measureModel: 'order', measure: 'count');

    $run->contains('"orders"', (new Compiler(registry(), new SqliteDialect))->compile($query)->sql, 'sqlite');
    $run->contains('"orders"', (new Compiler(registry(), new PostgresDialect))->compile($query)->sql, 'postgres');
    $run->contains('`orders`', (new Compiler(registry(), new MySqlDialect))->compile($query)->sql, 'mysql');
});

$run->test('a week starts on Monday everywhere', function (Runner $run): void {
    // SQLite counts %w from Sunday and MySQL's %V/%X pair starts weeks on
    // Sunday too. Either one on its own moves a seventh of the rows into the
    // wrong bucket, which reads as a quiet Monday rather than as a bug.
    $query = new Query(
        measureModel: 'order', measure: 'revenue',
        time: ['model' => 'order', 'key' => 'created_at'], grain: 'week',
    );

    $run->contains('+ 6) % 7', (new Compiler(registry(), new SqliteDialect))->compile($query)->sql, 'sqlite backs up to Monday');
    $run->contains('WEEKDAY(', (new Compiler(registry(), new MySqlDialect))->compile($query)->sql, 'mysql WEEKDAY is Monday based');
});

$run->test('an unknown grain is refused', function (Runner $run): void {
    try {
        (new SqliteDialect)->bucket('x', 'fortnight', 0.0);
        $run->assert(false, 'expected a refusal');
    } catch (InvalidArgumentException $error) {
        $run->contains('Unknown grain', $error->getMessage(), 'expected the grain named');
    }
});

$run->test('an unsupported driver is named rather than guessed', function (Runner $run): void {
    try {
        Dialect::for('oracle');
        $run->assert(false, 'expected a refusal');
    } catch (InvalidArgumentException $error) {
        $run->contains('oracle', $error->getMessage(), 'expected the driver named');
    }
});

echo "\n";

foreach ($run->failures as $failure) {
    echo "  FAIL  {$failure}\n";
}

printf("\n %d pass, %d fail\n\n", $run->passed, count($run->failures));

exit($run->failures === [] ? 0 : 1);
