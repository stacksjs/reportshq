<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Query;

/**
 * SQL and the values that go with it, never interpolated together.
 *
 * Every value a caller supplied is a binding. Every identifier is a name that
 * came out of the registry, which is an allowlist, so a column that was never
 * declared cannot reach the statement whatever a request asks for. Those two
 * rules together are the whole injection story here, and keeping the bindings
 * beside the SQL rather than inside it is what makes the first one checkable.
 */
final class Compiled
{
    /** @param list<string|int|float|bool> $bindings */
    public function __construct(
        public readonly string $sql,
        public readonly array $bindings = [],
    ) {}

    /** The statement with its values inlined, for a log or a test. Never executed. */
    public function preview(): string
    {
        $sql = $this->sql;

        foreach ($this->bindings as $binding) {
            $rendered = is_string($binding) ? "'".str_replace("'", "''", $binding)."'" : var_export($binding, true);
            $sql = preg_replace('/\?/', $rendered, $sql, 1) ?? $sql;
        }

        return $sql;
    }
}
