<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Reports;

use Illuminate\Database\ConnectionInterface;
use ReportsHQ\Laravel\Query\Compiler;
use ReportsHQ\Laravel\Query\Dialect;
use ReportsHQ\Laravel\Query\Filter;
use ReportsHQ\Laravel\Query\Query;
use ReportsHQ\Laravel\Semantic\GrainMismatch;
use ReportsHQ\Laravel\Semantic\Registry;

/**
 * A stored block, as numbers.
 *
 * The one place the pure half meets a database. Everything below it is names
 * and strings; everything above it draws pictures. Keeping the seam here is
 * what let the compiler be tested without a connection and the registry
 * without either.
 *
 * A block that cannot run does not stop the report. Its result carries the
 * message instead, and the viewer draws that message on the tile, because one
 * misconfigured block among eight is a bad tile rather than a blank page. The
 * message is written for the person reading it: a grain refusal explains which
 * two grains disagree and what to use instead.
 */
final class Runner
{
    public function __construct(
        private readonly Registry $registry,
        private readonly ConnectionInterface $connection,
        private readonly ?Dialect $dialect = null,
    ) {}

    /**
     * Run every block of a report.
     *
     * @param  list<array<string, mixed>>  $blocks
     * @return list<array<string, mixed>>
     */
    public function report(array $blocks, string $timezone = 'UTC', ?string $from = null, ?string $to = null): array
    {
        $results = [];

        foreach ($blocks as $block) {
            $results[] = $this->block($block, $timezone, $from, $to);
        }

        return $results;
    }

    /**
     * Run one block, or explain why it did not run.
     *
     * @param  array<string, mixed>  $block
     * @return array<string, mixed>
     */
    public function block(array $block, string $timezone = 'UTC', ?string $from = null, ?string $to = null): array
    {
        $rendered = $block + ['error' => null, 'series' => [], 'total' => null];

        if (($block['kind'] ?? null) === 'note') {
            return $rendered;
        }

        try {
            $query = $this->queryFor($block, $timezone, $from, $to);
            $compiled = (new Compiler($this->registry, $this->dialect ?? $this->dialectForConnection()))->compile($query);
            $rows = $this->connection->select($compiled->sql, $compiled->bindings);

            $rendered['series'] = $this->shape($rows, $this->castFor($block));
            $rendered['total'] = $this->total($block, $timezone, $from, $to);
        } catch (GrainMismatch $error) {
            // The one error a person can act on without knowing any SQL, and
            // the message is already written for them, so it is passed through
            // rather than reworded.
            $rendered['error'] = $error->getMessage();
        } catch (\Throwable $error) {
            // Everything else is ours. Say something true and short rather
            // than putting a driver's exception on a dashboard.
            $rendered['error'] = 'This block could not be calculated.';
            $rendered['detail'] = $error->getMessage();
        }

        return $rendered;
    }

    /**
     * The headline number, asked over the whole range.
     *
     * Its own query with no grain, deliberately, and this is the lesson the
     * events engine paid for twice. `avg` folded from daily buckets is a mean
     * of daily means, which weights a Tuesday with one order like a Saturday
     * with forty. `count_distinct` folded is daily distinct counts added up,
     * so a customer who ordered on five days counts five times: a real report
     * read 97 buying customers for 40 real ones.
     *
     * A second query rather than arithmetic on the first, because for those
     * two measures there is no arithmetic on the first that gets there.
     *
     * @param  array<string, mixed>  $block
     */
    private function total(array $block, string $timezone, ?string $from, ?string $to): float|int|null
    {
        $query = $this->queryFor($block, $timezone, $from, $to, headline: true);
        $compiled = (new Compiler($this->registry, $this->dialect ?? $this->dialectForConnection()))->compile($query);
        $rows = $this->connection->select($compiled->sql, $compiled->bindings);

        if ($rows === []) {
            return null;
        }

        $value = ((array) $rows[0])['value'] ?? null;

        return $value === null ? null : $this->cast($value, $this->castFor($block));
    }

    /**
     * @param  array<string, mixed>  $block
     */
    private function queryFor(array $block, string $timezone, ?string $from, ?string $to, bool $headline = false): Query
    {
        $config = is_array($block['query'] ?? null) ? $block['query'] : [];

        $filters = [];

        foreach ($config['filters'] ?? [] as $filter) {
            if (! is_array($filter)) {
                continue;
            }

            $filters[] = new Filter(
                model: (string) ($filter['model'] ?? ''),
                dimension: (string) ($filter['field'] ?? ''),
                operator: (string) ($filter['operator'] ?? 'is'),
                value: $filter['value'] ?? null,
            );
        }

        $time = isset($config['time']) && is_array($config['time']) ? $config['time'] : null;

        return new Query(
            measureModel: (string) ($config['model'] ?? ''),
            measure: (string) ($config['measure'] ?? ''),
            // A headline is one number: no split and no bucket, whatever the
            // chart above it is drawn with.
            dimension: $headline ? null : (isset($config['dimension']) && is_array($config['dimension']) ? $config['dimension'] : null),
            time: $time,
            grain: $headline ? null : (isset($config['grain']) ? (string) $config['grain'] : null),
            from: $from ?? ($config['from'] ?? null),
            to: $to ?? ($config['to'] ?? null),
            filters: $filters,
            limit: $headline ? 0 : (int) ($config['limit'] ?? 0),
            timezone: $timezone,
        );
    }

    /**
     * Whether a measure's values are whole numbers or not.
     *
     * Decided by what the measure means rather than by what the driver handed
     * back, and that is not fussiness. SQLite returns an integer for a SUM over
     * integer columns, Postgres returns a numeric string, and MySQL returns
     * something else again: a chart component asking `is_float` would branch
     * differently depending on which database an application happens to run.
     * A count is whole and everything else is not, everywhere.
     *
     * @param  array<string, mixed>  $block
     */
    private function castFor(array $block): string
    {
        $config = is_array($block['query'] ?? null) ? $block['query'] : [];
        $model = $this->registry->model((string) ($config['model'] ?? ''));
        $measure = $model?->measure((string) ($config['measure'] ?? ''));

        return match ($measure?->aggregate) {
            'count', 'count_distinct' => 'int',
            default => 'float',
        };
    }

    private function cast(mixed $value, string $as): float|int
    {
        return $as === 'int' ? (int) $value : (float) $value;
    }

    /**
     * Rows into series, the shape every chart component expects.
     *
     * One series when there is no split, one per distinct value when there is.
     * A missing series key becomes `(none)` rather than an empty label, so a
     * row for records with no value is visibly that rather than looking like a
     * rendering fault.
     *
     * @param  list<mixed>  $rows
     * @return list<array{key: string, points: list<array{t: string|null, value: float|int}>}>
     */
    private function shape(array $rows, string $cast = 'float'): array
    {
        $series = [];

        foreach ($rows as $row) {
            $row = (array) $row;
            $key = array_key_exists('series', $row) ? (string) ($row['series'] ?? '') : 'total';

            if ($key === '') {
                $key = '(none)';
            }

            $value = $row['value'] ?? 0;

            $series[$key] ??= ['key' => $key, 'points' => []];
            $series[$key]['points'][] = [
                't' => array_key_exists('bucket', $row) ? (string) $row['bucket'] : null,
                'value' => $this->cast($value, $cast),
            ];
        }

        return array_values($series);
    }

    private function dialectForConnection(): Dialect
    {
        return Dialect::for($this->connection->getDriverName());
    }
}
