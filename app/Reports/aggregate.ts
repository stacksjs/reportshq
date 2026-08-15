/**
 * How a measure folds a set of bucket values into one number.
 *
 * Small, and separate, because there are two paths to the same answer. The
 * engine reads the raw events; the rollup reader reads the pre-aggregate. They
 * must produce identical numbers for the same question, and until this file
 * existed they each carried their own copy of the rule.
 *
 * That is not a tidiness complaint. The copies drifted the moment one was
 * corrected: the empty-bucket fix landed in the engine, the rollup reader kept
 * the old behaviour, and the same report answered 0.10 or 0.00 depending on
 * which path served it. The equivalence tests caught it, which is exactly what
 * they are for, but the second copy should not have been there to drift.
 */
import type { Measure } from './schema'

/**
 * The mean of the buckets that hold something.
 *
 * Every bucket in a range gets a value so a chart has no gaps, and an empty one
 * is zero. Averaging those zeros in would drag every average toward zero in
 * proportion to how quiet the period was, which is the opposite of what an
 * average is for.
 */
export function meanOfMeaningful(values: number[]): number {
  const meaningful = values.filter(value => value !== 0)
  if (meaningful.length === 0)
    return 0
  return meaningful.reduce((sum, value) => sum + value, 0) / meaningful.length
}

/**
 * The extreme of the buckets that hold something.
 *
 * Same reasoning as the mean, and it went unnoticed far longer. Reading empty
 * buckets as data makes `min` answer 0 for any range with a quiet day in it: a
 * month of orders between 10 and 50 reported a minimum order value of zero
 * because a Sunday had none. The number was wrong and looked entirely ordinary.
 *
 * `max` fails the same way in the rarer, worse case: a series of refunds is
 * negative throughout, and the largest of those and a phantom zero is the zero.
 *
 * A bucket whose real value is zero cannot be told from an empty one here, so it
 * is excluded too. That is the conservative direction: a genuine zero left out
 * moves an extreme less than a phantom zero replaces it.
 */
export function extremeOf(values: number[], pick: 'min' | 'max'): number {
  const meaningful = values.filter(value => value !== 0)
  if (meaningful.length === 0)
    return 0
  return pick === 'min' ? Math.min(...meaningful) : Math.max(...meaningful)
}

/**
 * Fold a measure's bucket values into the single number a headline shows.
 *
 * `count` and `count_unique` sum, which for uniques means distinct-per-bucket
 * added up rather than distinct overall. Distinct counts do not compose, and
 * this is the honest version of that: the alternative is one count over the
 * whole range, which cannot be drawn as a series.
 */
export function foldMeasure(measure: Measure, values: number[]): number {
  switch (measure) {
    case 'avg':
      return meanOfMeaningful(values)
    case 'min':
      return extremeOf(values, 'min')
    case 'max':
      return extremeOf(values, 'max')
    default:
      return values.reduce((sum, value) => sum + value, 0)
  }
}
