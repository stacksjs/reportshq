/**
 * Turning engine results into the geometry a chart draws.
 *
 * Server-side on purpose. A share page has to render a real chart with no
 * JavaScript at all, a scheduled email has to render one with no browser, and
 * the app should paint a report before it hydrates. So the SVG is built here
 * from the same `EngineResult` every surface already has, and the client only
 * adds hover.
 *
 * Geometry comes from `@ts-charts/*`, our own D3 rewrite. Colour does not: it
 * comes from the CSS custom properties, so a chart follows the theme without
 * being re-rendered, and the legend swatch and the mark can never disagree.
 *
 * The umbrella `ts-charts` package is documented as the install but is not on
 * npm (the subpackages are), so the imports below are per-package. Worth fixing
 * upstream; it is also the better import either way.
 */
import type { EngineResult, Point, Series } from './engine'
import { format } from '@ts-charts/format'
import { scaleLinear } from '@ts-charts/scale'
import { area, curveMonotoneX, line } from '@ts-charts/shape'

/** How many categorical slots exist before the tail folds into Other. */
export const SERIES_SLOTS = 5

export interface Box {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Room for the axes, and no more.
 *
 * Left is wider than it looks because a y-axis label is right-aligned against
 * the plot; bottom fits one line of tick text. These are the only two places a
 * chart is allowed to spend space on chrome.
 */
export const DEFAULT_BOX: Box = { width: 720, height: 260, top: 12, right: 12, bottom: 26, left: 52 }

export interface PlotArea {
  x: (value: number) => number
  y: (value: number) => number
  /**
   * The top of the y domain, carried explicitly.
   *
   * `@ts-charts/scale` types its scales loosely (a scale is a callable whose
   * `.domain()` is not on the type), so reading it back would need a cast at
   * every use. Passing it forward is one field and no casts.
   */
  yMax: number
  innerWidth: number
  innerHeight: number
  box: Box
}

/**
 * The series colour for a slot, as a CSS variable reference.
 *
 * Never a hex literal: the value has to change with the theme, and a chart that
 * baked one would be wrong the moment someone switched. `Other` is neutral,
 * because a folded tail is not an identity and colouring it makes it compete
 * with the categories it is hiding.
 */
export function seriesColor(index: number, key?: string): string {
  if (key === 'Other')
    return 'var(--series-other)'

  return `var(--series-${(index % SERIES_SLOTS) + 1})`
}

/** Numbers a person reads at a glance: 1.2k, 3.4M, 12.3%. */
export function compact(value: number): string {
  if (!Number.isFinite(value))
    return '0'

  const abs = Math.abs(value)
  if (abs >= 1_000_000_000)
    return `${format('.1f')(value / 1_000_000_000)}B`
  if (abs >= 1_000_000)
    return `${format('.1f')(value / 1_000_000)}M`
  if (abs >= 10_000)
    return `${format('.1f')(value / 1000)}k`
  if (abs >= 1000)
    return format(',')(Math.round(value))
  if (Number.isInteger(value))
    return String(value)

  return format('.2f')(value)
}

/** Currency, in the report's own currency, without inventing precision. */
export function money(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value)
}

/** A percentage change, signed, or a dash when there is nothing to compare to. */
export function delta(change: number | null): string {
  if (change === null)
    return '-'

  const percent = change * 100
  const rounded = Math.abs(percent) >= 100 ? Math.round(percent) : Math.round(percent * 10) / 10
  return `${change >= 0 ? '+' : ''}${rounded}%`
}

export function plotArea(result: EngineResult, box: Box = DEFAULT_BOX): PlotArea {
  const innerWidth = box.width - box.left - box.right
  const innerHeight = box.height - box.top - box.bottom
  const points = result.series[0]?.points.length ?? 0

  const max = Math.max(
    // A chart of all zeros still needs a scale, or every point lands on the
    // axis and the line disappears into it.
    1,
    ...result.series.flatMap(series => series.points.map(point => point.value)),
  )

  const x = scaleLinear()
    .domain([0, Math.max(1, points - 1)])
    .range([box.left, box.left + innerWidth])

  const y = scaleLinear()
    // Rounded up so the top gridline is a number a person would choose.
    .domain([0, niceCeiling(max)])
    .range([box.top + innerHeight, box.top])

  return { x, y, yMax: niceCeiling(max), innerWidth, innerHeight, box }
}

/** The next 1, 2 or 5 times a power of ten, so axis labels read cleanly. */
export function niceCeiling(value: number): number {
  if (value <= 0)
    return 1

  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude

  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

/** Four gridlines and their labels, including zero. */
export function ticks(_result: EngineResult, plot: PlotArea, count = 4): Array<{ value: number, y: number, label: string }> {
  const step = plot.yMax / count

  return Array.from({ length: count + 1 }, (_, i) => {
    const value = step * i
    return { value, y: plot.y(value), label: compact(value) }
  })
}

/**
 * X-axis labels, thinned so they never collide.
 *
 * Chooses a stride from the available width rather than a fixed count: 30 daily
 * points in a narrow block get every fifth label, the same 30 in a full-width
 * block get every third.
 */
export function timeLabels(
  result: EngineResult,
  plot: PlotArea,
  formatLabel: (iso: string) => string,
): Array<{ x: number, label: string }> {
  const points = result.series[0]?.points ?? []
  if (points.length === 0)
    return []

  const perLabel = 64
  const maximum = Math.max(2, Math.floor(plot.innerWidth / perLabel))
  const stride = Math.max(1, Math.ceil(points.length / maximum))

  const labels: Array<{ x: number, label: string }> = []
  for (let i = 0; i < points.length; i += stride)
    labels.push({ x: plot.x(i), label: formatLabel(points[i]!.t) })

  return labels
}

/** A short date for an axis: "14 Aug", or "Aug" at month grain. */
export function shortDate(iso: string, grain: string): string {
  const date = new Date(iso)

  if (grain === 'month')
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date)

  if (grain === 'hour')
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date)

  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date)
}

/** The full date, for a tooltip, where there is room to be unambiguous. */
export function longDate(iso: string, grain: string): string {
  const date = new Date(iso)

  if (grain === 'hour')
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date)

  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

/** The `d` for a series line. Monotone so it never overshoots into nonsense. */
export function linePath(series: Series, plot: PlotArea): string {
  const generator = line()
    .x((_: Point, index: number) => plot.x(index))
    .y((point: Point) => plot.y(point.value))
    .curve(curveMonotoneX)

  return String(generator(series.points) ?? '')
}

/** The `d` for a filled area under a series. */
export function areaPath(series: Series, plot: PlotArea): string {
  const generator = area()
    .x((_: Point, index: number) => plot.x(index))
    .y0(plot.box.top + plot.innerHeight)
    .y1((point: Point) => plot.y(point.value))
    .curve(curveMonotoneX)

  return String(generator(series.points) ?? '')
}

export interface BarRect {
  x: number
  y: number
  width: number
  height: number
  value: number
  label: string
}

/**
 * Bar geometry, with a 2px gap between neighbours.
 *
 * The gap is not decoration. Adjacent fills of similar colour read as one shape
 * without it, and the palette's tightest pair sits in the band where separation
 * has to come from something other than hue.
 */
export function bars(result: EngineResult, plot: PlotArea, seriesIndex = 0): BarRect[] {
  const series = result.series[seriesIndex]
  if (!series)
    return []

  const count = series.points.length
  const slot = plot.innerWidth / Math.max(1, count)
  const width = Math.max(1, slot - 2)
  const baseline = plot.box.top + plot.innerHeight

  return series.points.map((point, index) => {
    const y = plot.y(point.value)
    return {
      x: plot.box.left + index * slot + 1,
      y,
      width,
      // Never negative, and never zero-height for a non-zero value: a bar that
      // rounds away is a value the reader cannot see.
      height: Math.max(point.value > 0 ? 1 : 0, baseline - y),
      value: point.value,
      label: point.t,
    }
  })
}

export interface DonutSlice {
  path: string
  value: number
  key: string
  color: string
  percent: number
}

/**
 * Donut slices, largest first, with a 2px gap between them.
 *
 * A donut rather than a pie: the hole gives the total somewhere to live, and a
 * reader compares arc lengths rather than trying to judge angles at the centre.
 */
export function donut(result: EngineResult, radius = 90, thickness = 28): DonutSlice[] {
  const total = result.series.reduce((sum, series) => sum + series.total, 0)
  if (total <= 0)
    return []

  const ordered = [...result.series].sort((a, b) => b.total - a.total)
  const gap = 0.02

  let start = -Math.PI / 2
  return ordered.map((series, index) => {
    const fraction = series.total / total
    const end = start + fraction * Math.PI * 2
    const path = arcPath(start + gap / 2, Math.max(start + gap / 2, end - gap / 2), radius, radius - thickness)
    const slice = {
      path,
      value: series.total,
      key: series.key,
      color: seriesColor(index, series.key),
      percent: fraction,
    }
    start = end
    return slice
  })
}

/** An annulus segment, drawn by hand so the hole is exact. */
function arcPath(start: number, end: number, outer: number, inner: number): string {
  const large = end - start > Math.PI ? 1 : 0
  const p = (radius: number, angle: number): [number, number] => [radius * Math.cos(angle), radius * Math.sin(angle)]

  const [x1, y1] = p(outer, start)
  const [x2, y2] = p(outer, end)
  const [x3, y3] = p(inner, end)
  const [x4, y4] = p(inner, start)

  return [
    `M${x1.toFixed(2)},${y1.toFixed(2)}`,
    `A${outer},${outer} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`,
    `L${x3.toFixed(2)},${y3.toFixed(2)}`,
    `A${inner},${inner} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/**
 * Whether a chart should carry a legend.
 *
 * Always, for two or more series: identity must never rest on colour alone, and
 * one adjacent pair in this palette is inside the band where that is not merely
 * good practice but the condition under which the palette is usable at all.
 *
 * A single series needs none. Its title already names it, and a legend of one
 * is a box that says the same thing twice.
 */
export function needsLegend(result: EngineResult): boolean {
  return result.series.length > 1
}
