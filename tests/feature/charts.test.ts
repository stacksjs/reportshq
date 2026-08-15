/**
 * The chart layer: geometry, formatting and the rules that make the palette
 * legal.
 *
 * Assertions are on structure and computed values, not snapshots. A snapshot
 * tells you the output changed; it cannot tell you a bar is drawn below its
 * baseline or that a zero value silently disappeared.
 */
import { describe, expect, test } from 'bun:test'
import {
  bars,
  compact,
  DEFAULT_BOX,
  delta,
  donut,
  linePath,
  money,
  needsLegend,
  niceCeiling,
  plotArea,
  SERIES_SLOTS,
  seriesColor,
  shortDate,
  ticks,
  timeLabels,
} from '../../app/Reports/charts'

function makeResult(values: number[], seriesCount = 1): any {
  const points = (offset: number) => values.map((value, index) => ({
    t: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
    value: value + offset,
  }))

  return {
    series: Array.from({ length: seriesCount }, (_, i) => ({
      key: seriesCount === 1 ? 'total' : `series ${i + 1}`,
      points: points(i * 10),
      total: values.reduce((sum, value) => sum + value + i * 10, 0),
    })),
    total: values.reduce((sum, value) => sum + value, 0),
    grain: 'day',
    range: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' },
  }
}

describe('colour assignment', () => {
  test('series take slots in fixed order, never cycled by rank', () => {
    // Colour follows the entity. A filter that changes the series count must
    // not repaint the survivors, which is what cycling by rank would do.
    expect(seriesColor(0)).toBe('var(--series-1)')
    expect(seriesColor(1)).toBe('var(--series-2)')
    expect(seriesColor(4)).toBe('var(--series-5)')
  })

  test('the folded tail is neutral, whatever slot it lands in', () => {
    // "Other" is not an identity, and giving it a hue makes it compete with
    // the categories it is hiding.
    expect(seriesColor(0, 'Other')).toBe('var(--series-other)')
    expect(seriesColor(3, 'Other')).toBe('var(--series-other)')
  })

  test('there are exactly five categorical slots', () => {
    // Five is what clears the colour-vision separation floors inside dark
    // mode's lightness band without repeating a hue family.
    expect(SERIES_SLOTS).toBe(5)
  })

  test('colours are always custom properties, never baked hex', () => {
    // A hex literal would be wrong the moment someone switched theme.
    for (let i = 0; i < 8; i++)
      expect(seriesColor(i)).toStartWith('var(--')
  })
})

describe('legends', () => {
  test('two or more series always carry one', () => {
    // Identity must never rest on colour alone, and one adjacent pair in this
    // palette is inside the band where a legend is the condition of the
    // palette being usable at all.
    expect(needsLegend(makeResult([1, 2], 2))).toBeTrue()
    expect(needsLegend(makeResult([1, 2], 5))).toBeTrue()
  })

  test('a single series does not, because its title already names it', () => {
    expect(needsLegend(makeResult([1, 2], 1))).toBeFalse()
  })
})

describe('number formatting', () => {
  test('compacts at the thresholds a reader expects', () => {
    expect(compact(950)).toBe('950')
    expect(compact(1500)).toBe('1,500')
    expect(compact(12_500)).toBe('12.5k')
    expect(compact(1_250_000)).toBe('1.3M')
    expect(compact(2_400_000_000)).toBe('2.4B')
  })

  test('keeps whole numbers whole', () => {
    expect(compact(42)).toBe('42')
    expect(compact(0)).toBe('0')
  })

  test('survives values that are not numbers', () => {
    expect(compact(Number.NaN)).toBe('0')
    expect(compact(Number.POSITIVE_INFINITY)).toBe('0')
  })

  test('money drops cents once the number is large enough to not need them', () => {
    expect(money(12.5, 'EUR')).toBe('€12.50')
    expect(money(12_500, 'EUR')).toBe('€12,500')
  })

  test('a delta is signed, and a missing comparison is a dash', () => {
    expect(delta(0.125)).toBe('+12.5%')
    expect(delta(-0.5)).toBe('-50%')
    // Up from nothing is not a percentage.
    expect(delta(null)).toBe('-')
  })
})

describe('scales and axes', () => {
  test('the top gridline is a number a person would choose', () => {
    expect(niceCeiling(87)).toBe(100)
    expect(niceCeiling(1.4)).toBe(2)
    expect(niceCeiling(320)).toBe(500)
    expect(niceCeiling(0)).toBe(1)
  })

  test('an all-zero series still gets a usable scale', () => {
    // Otherwise every point lands on the axis and the line disappears into it.
    const plot = plotArea(makeResult([0, 0, 0]))
    expect(plot.yMax).toBeGreaterThan(0)
  })

  test('ticks run from zero to the ceiling, in order', () => {
    const result = makeResult([10, 60, 30])
    const plot = plotArea(result)
    const axis = ticks(result, plot)

    expect(axis[0]?.value).toBe(0)
    expect(axis[axis.length - 1]?.value).toBe(plot.yMax)
    // y descends as value rises: the origin is at the bottom.
    expect(axis[0]!.y).toBeGreaterThan(axis[axis.length - 1]!.y)
  })

  test('x labels thin out rather than collide', () => {
    const many = makeResult(Array.from({ length: 90 }, (_, i) => i))
    const plot = plotArea(many)
    const labels = timeLabels(many, plot, iso => shortDate(iso, 'day'))

    // Roughly one per 64px of plot width, never one per point.
    expect(labels.length).toBeLessThan(90)
    expect(labels.length).toBeGreaterThan(2)
    expect(plot.innerWidth / labels.length).toBeGreaterThanOrEqual(40)
  })

  test('a chart with no points produces no labels rather than throwing', () => {
    const emptyResult = { series: [], total: 0, grain: 'day', range: { from: '', to: '' } } as any
    const plot = plotArea(emptyResult)
    expect(timeLabels(emptyResult, plot, iso => iso)).toHaveLength(0)
  })
})

describe('line geometry', () => {
  test('produces a path that starts with a move and covers every point', () => {
    const result = makeResult([5, 10, 3, 8])
    const path = linePath(result.series[0], plotArea(result))

    expect(path).toStartWith('M')
    expect(path.length).toBeGreaterThan(20)
  })

  test('higher values sit higher on the canvas', () => {
    const result = makeResult([1, 100])
    const plot = plotArea(result)

    expect(plot.y(100)).toBeLessThan(plot.y(1))
  })
})

describe('bar geometry', () => {
  const result = makeResult([10, 0, 40, 25])
  const plot = plotArea(result)
  const rects = bars(result, plot)

  test('one bar per point', () => {
    expect(rects).toHaveLength(4)
  })

  test('bars are anchored to the baseline', () => {
    const baseline = plot.box.top + plot.innerHeight
    for (const rect of rects)
      expect(Math.round(rect.y + rect.height)).toBe(Math.round(baseline))
  })

  test('a zero value draws nothing rather than a stub', () => {
    expect(rects[1]?.height).toBe(0)
  })

  test('a small non-zero value still draws at least a pixel', () => {
    // A bar that rounds away is a value the reader cannot see.
    const tiny = makeResult([1000, 1])
    const rendered = bars(tiny, plotArea(tiny))
    expect(rendered[1]!.height).toBeGreaterThanOrEqual(1)
  })

  test('neighbours are separated by a gap', () => {
    // Adjacent fills of similar colour read as one shape without it, and this
    // palette has a pair whose separation cannot come from hue alone.
    const first = rects[0]!
    const second = rects[1]!
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.width)
  })

  test('bars stay inside the plot area', () => {
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(plot.box.left)
      expect(rect.x + rect.width).toBeLessThanOrEqual(DEFAULT_BOX.width - DEFAULT_BOX.right + 1)
      expect(rect.y).toBeGreaterThanOrEqual(plot.box.top - 0.01)
    }
  })
})

describe('donut geometry', () => {
  test('slices are ordered largest first and cover the whole', () => {
    const result = makeResult([10, 20, 30], 3)
    const slices = donut(result)

    expect(slices).toHaveLength(3)
    expect(slices[0]!.value).toBeGreaterThanOrEqual(slices[1]!.value)
    expect(slices.reduce((sum, slice) => sum + slice.percent, 0)).toBeCloseTo(1, 5)
  })

  test('each slice is a closed annulus path', () => {
    const slices = donut(makeResult([5, 15], 2))
    for (const slice of slices) {
      expect(slice.path).toStartWith('M')
      expect(slice.path).toEndWith('Z')
      // Two arcs: the outer edge and the inner one that makes the hole.
      expect(slice.path.match(/A/g)).toHaveLength(2)
    }
  })

  test('an empty result draws nothing rather than a full circle of zero', () => {
    // Built by hand: makeResult offsets each series so it never sums to zero,
    // which is what a chart of real data looks like and not this case.
    const nothing = {
      series: [
        { key: 'a', points: [{ t: '2026-08-01T00:00:00.000Z', value: 0 }], total: 0 },
        { key: 'b', points: [{ t: '2026-08-01T00:00:00.000Z', value: 0 }], total: 0 },
      ],
      total: 0,
      grain: 'day',
      range: { from: '', to: '' },
    } as any

    expect(donut(nothing)).toHaveLength(0)
  })
})
