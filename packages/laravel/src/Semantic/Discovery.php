<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

use Illuminate\Database\Eloquent\Model as Eloquent;
use Illuminate\Database\Eloquent\Relations\Relation as EloquentRelation;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * A first draft of the registry, read from the application's own models.
 *
 * Deliberately a draft. Discovery gets the shape right and cannot get the
 * meaning right: it can see that `orders.total_amount` is an integer, and it
 * cannot see that the integer is cents, that `member_id` is the customer while
 * `user_id` is the login, or that a subscription's value is `unit_price`
 * multiplied by `quantity` and lives in no column at all. So this writes a
 * config file for a person to correct, and the corrected file is what ships.
 *
 * The one thing discovery is trusted with completely is exclusion. Every
 * column starts hidden and has to be recognised as safe to appear, rather than
 * starting visible and having to be recognised as dangerous. A builder is a
 * `SELECT` with a drag handle on it, and the cost of the two mistakes is not
 * symmetric: a missing dimension is an afternoon, and an exposed password
 * column is a disclosure.
 */
final class Discovery
{
    /**
     * Columns that never become dimensions, whatever they are called.
     *
     * Matched as substrings on a lowercased name, so `password`,
     * `password_hash` and `encrypted_password` are all caught by one entry.
     * Erring wide is free here: anything wrongly excluded is added back by
     * hand in the config, in the file whose whole purpose is being read.
     */
    public const NEVER = [
        'password', 'token', 'secret', 'api_key', 'private_key', 'signature',
        'remember_', 'two_factor', 'otp', 'recovery_code', 'session',
        'ssn', 'social_security', 'tax_id', 'card_number', 'cvv', 'iban',
        'date_of_birth', 'dob', 'passport', 'licence_number', 'license_number',
    ];

    /**
     * Columns that are identifiers rather than dimensions.
     *
     * A foreign key is how a join happens, not something to group by: grouping
     * revenue by `member_id` makes one series per customer, which for this
     * application is forty thousand series and a chart that is a solid block
     * of colour. The relationship it implies is discovered separately and is
     * the useful half.
     */
    private const IDENTIFIER_SUFFIXES = ['_id', '_uuid', '_key', '_hash'];

    /**
     * @param  list<class-string<Eloquent>>  $classes
     */
    public static function draft(array $classes): Registry
    {
        $models = [];

        foreach ($classes as $class) {
            $model = self::model($class);

            if ($model !== null) {
                $models[] = $model;
            }
        }

        return new Registry($models);
    }

    /** @param class-string<Eloquent> $class */
    public static function model(string $class): ?Model
    {
        if (! is_subclass_of($class, Eloquent::class)) {
            return null;
        }

        $instance = new $class;
        $table = $instance->getTable();

        if (! Schema::hasTable($table)) {
            return null;
        }

        $key = Str::snake(class_basename($class));
        $label = Str::headline(class_basename($class));
        $casts = $instance->getCasts();

        $dimensions = [];
        $measures = [];

        foreach (Schema::getColumnListing($table) as $column) {
            if (self::excluded($column)) {
                continue;
            }

            $type = self::typeOf($column, $casts[$column] ?? null, Schema::getColumnType($table, $column));

            $dimensions[] = new Dimension(
                key: $column,
                label: Str::headline($column),
                model: $key,
                column: $column,
                type: $type,
            );

            // A numeric column gets a sum and an average offered against it.
            // Most will be wrong to use and are removed in the config; the
            // point of offering them is that the person editing that file sees
            // the candidates rather than having to remember them.
            if ($type === 'number' && ! self::isIdentifier($column)) {
                $measures[] = new Measure(
                    key: "{$column}_sum",
                    label: 'Total '.Str::lower(Str::headline($column)),
                    aggregate: 'sum',
                    model: $key,
                    column: $column,
                    provisional: true,
                );
            }
        }

        // Counting rows is the one measure that is right on every model
        // without anybody checking it.
        $measures[] = new Measure(
            key: 'count',
            label: Str::plural($label),
            aggregate: 'count',
            model: $key,
        );

        return new Model(
            key: $key,
            table: $table,
            label: $label,
            grain: 'one row per '.Str::lower(Str::singular($label)),
            dimensions: $dimensions,
            measures: $measures,
            relations: self::relations($instance, $class),
            primaryKey: $instance->getKeyName(),
        );
    }

    /**
     * The relations a model declares, and their cardinality.
     *
     * Found by calling every public method that takes no arguments and seeing
     * what comes back, which is the only way Eloquent offers: a relationship
     * is a method returning a Relation and there is no manifest of them.
     * Anything that throws is skipped, because a method with side effects or
     * an unmet dependency is not a relationship and must not stop discovery.
     *
     * @param  class-string<Eloquent>  $class
     * @return list<Relation>
     */
    private static function relations(Eloquent $instance, string $class): array
    {
        $relations = [];

        foreach ((new \ReflectionClass($class))->getMethods(\ReflectionMethod::IS_PUBLIC) as $method) {
            if ($method->class !== $class || $method->getNumberOfParameters() > 0 || $method->isStatic()) {
                continue;
            }

            $returns = $method->getReturnType();

            if (! $returns instanceof \ReflectionNamedType || $returns->isBuiltin()) {
                continue;
            }

            if (! is_a($returns->getName(), EloquentRelation::class, true)) {
                continue;
            }

            try {
                $relation = $instance->{$method->getName()}();
            } catch (\Throwable) {
                continue;
            }

            if (! $relation instanceof EloquentRelation) {
                continue;
            }

            $related = $relation->getRelated();

            $relations[] = new Relation(
                name: $method->getName(),
                target: Str::snake(class_basename($related)),
                cardinality: Relation::cardinalityOf(class_basename($relation)),
                localKey: $instance->getKeyName(),
                foreignKey: method_exists($relation, 'getForeignKeyName')
                    ? (string) $relation->getForeignKeyName()
                    : $related->getKeyName(),
            );
        }

        return $relations;
    }

    private static function excluded(string $column): bool
    {
        $name = Str::lower($column);

        foreach (self::NEVER as $fragment) {
            if (str_contains($name, $fragment)) {
                return true;
            }
        }

        return false;
    }

    private static function isIdentifier(string $column): bool
    {
        if ($column === 'id') {
            return true;
        }

        foreach (self::IDENTIFIER_SUFFIXES as $suffix) {
            if (str_ends_with(Str::lower($column), $suffix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The dimension type, preferring the model's own cast.
     *
     * A cast is the application saying what it means; the column type is the
     * database saying how it is stored. They disagree often enough to matter:
     * an enum cast over a varchar, a boolean over a tinyint, a datetime over a
     * string. Where a cast exists it wins.
     */
    private static function typeOf(string $column, ?string $cast, string $databaseType): string
    {
        $cast = $cast === null ? null : Str::before(Str::lower($cast), ':');

        if ($cast !== null) {
            if (in_array($cast, ['date', 'datetime', 'immutable_date', 'immutable_datetime', 'timestamp'], true)) {
                return 'date';
            }

            if (in_array($cast, ['bool', 'boolean'], true)) {
                return 'boolean';
            }

            if (in_array($cast, ['int', 'integer', 'float', 'double', 'real', 'decimal'], true)) {
                return 'number';
            }

            // An enum cast is a string with a short list of values, which is
            // exactly what a dimension wants to be.
            if (enum_exists($cast)) {
                return 'string';
            }
        }

        if (str_contains($databaseType, 'date') || str_contains($databaseType, 'time')) {
            return 'date';
        }

        if (in_array($databaseType, ['boolean', 'bool'], true)) {
            return 'boolean';
        }

        if (in_array($databaseType, ['integer', 'bigint', 'smallint', 'decimal', 'float', 'double', 'numeric'], true)) {
            return 'number';
        }

        return 'string';
    }
}
