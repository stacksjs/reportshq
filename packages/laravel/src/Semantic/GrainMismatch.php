<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Semantic;

/**
 * A query that would have answered a different question than it asked.
 *
 * Its own type, because the builder catches this one and shows the message on
 * the block rather than in a log. It is the only error here that a person can
 * act on without knowing anything about SQL, and it is thrown far more often
 * than it is a bug: "revenue by category" is a reasonable thing to ask for and
 * the answer is that it needs the measure at the other grain.
 */
final class GrainMismatch extends \RuntimeException {}
