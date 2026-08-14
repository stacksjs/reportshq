/**
 * Turning a range token into two instants, and a grain into buckets.
 *
 * Separated from the engine because it is the part with all the timezone
 * reasoning in it, and because the scheduler (#15) needs the same answers
 * without running a query.
 *
 * Every range is resolved in the project's timezone, not the server's or the
 * reader's. "Yesterday" has to mean the same day for everyone looking at a
 * report, or two people comparing screens will disagree about the numbers and
 * neither will be wrong.
 */
import type { Grain } from './schema'

export interface Range {
  from: Date
  to: Date
}

export const RANGE_TOKENS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_14_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
  'this_year',
] as const

export type RangeToken = typeof RANGE_TOKENS[number]

/**
 * The offset a zone was at, at a given instant, in minutes.
 *
 * Derived by asking Intl to format the instant in that zone and reading the
 * parts back. It looks roundabout, and it is the only way to get a historically
 * correct offset without shipping a timezone database: the offset for
 * Europe/Lisbon is not a constant, it is +0 or +1 depending on the date, and
 * getting that wrong silently shifts every bucket boundary by an hour for half
 * the year.
 */
function offsetMinutes(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant)

  const read = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0)

  // The same wall-clock reading, interpreted as UTC. The difference between
  // that and the real instant is the zone's offset.
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour') === 24 ? 0 : read('hour'), read('minute'), read('second'))

  return Math.round((asUtc - instant.getTime()) / 60_000)
}

/** The wall-clock date in a zone, as {year, month, day}. */
function localParts(instant: Date, timezone: string): { year: number, month: number, day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)

  const read = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0)
  return { year: read('year'), month: read('month'), day: read('day') }
}

/**
 * The instant at which a wall-clock time occurs in a zone.
 *
 * Two passes, because the offset depends on the instant we are trying to find.
 * The first guess uses the offset at the naive UTC interpretation; the second
 * corrects it using the offset actually in force there. That converges for
 * every case except the hour that does not exist on a spring-forward day, where
 * it lands on the following hour, which is the conventional answer.
 */
function instantFor(year: number, month: number, day: number, hour: number, timezone: string): Date {
  const naive = Date.UTC(year, month - 1, day, hour, 0, 0)
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), timezone) * 60_000)
  return new Date(naive - offsetMinutes(firstGuess, timezone) * 60_000)
}

/** Midnight at the start of the day containing `instant`, in the zone. */
export function startOfDay(instant: Date, timezone: string): Date {
  const { year, month, day } = localParts(instant, timezone)
  return instantFor(year, month, day, 0, timezone)
}

export function addDays(instant: Date, days: number, timezone: string): Date {
  const { year, month, day } = localParts(instant, timezone)
  // Built from parts rather than by adding milliseconds: a day is 23 or 25
  // hours long twice a year, and "seven days ago" means seven calendar days.
  return instantFor(year, month, day + days, 0, timezone)
}

export function startOfMonth(instant: Date, timezone: string): Date {
  const { year, month } = localParts(instant, timezone)
  return instantFor(year, month, 1, 0, timezone)
}

/** Monday, because a week that starts on Sunday surprises most of the world. */
export function startOfWeek(instant: Date, timezone: string): Date {
  const midnight = startOfDay(instant, timezone)
  const weekday = new Date(midnight.getTime() + offsetMinutes(midnight, timezone) * 60_000).getUTCDay()
  const back = weekday === 0 ? 6 : weekday - 1
  return addDays(midnight, -back, timezone)
}

/**
 * Resolve a range token against a moment.
 *
 * `to` is exclusive throughout: a day range runs from midnight to the next
 * midnight, so an event at 23:59:59.999 belongs to the day it happened on and
 * no event can land in two buckets or none.
 */
export function resolveRange(token: string, timezone: string, now = new Date()): Range {
  const today = startOfDay(now, timezone)
  const tomorrow = addDays(today, 1, timezone)

  switch (token) {
    case 'today':
      return { from: today, to: tomorrow }
    case 'yesterday':
      return { from: addDays(today, -1, timezone), to: today }
    case 'last_7_days':
      return { from: addDays(today, -6, timezone), to: tomorrow }
    case 'last_14_days':
      return { from: addDays(today, -13, timezone), to: tomorrow }
    case 'last_90_days':
      return { from: addDays(today, -89, timezone), to: tomorrow }
    case 'this_month':
      return { from: startOfMonth(now, timezone), to: tomorrow }
    case 'last_month': {
      const thisMonth = startOfMonth(now, timezone)
      return { from: startOfMonth(addDays(thisMonth, -1, timezone), timezone), to: thisMonth }
    }
    case 'this_year': {
      const { year } = localParts(now, timezone)
      return { from: instantFor(year, 1, 1, 0, timezone), to: tomorrow }
    }
    case 'last_30_days':
    default:
      return { from: addDays(today, -29, timezone), to: tomorrow }
  }
}

/**
 * The period immediately before a range, of equal length.
 *
 * Measured in calendar days rather than milliseconds so a comparison across a
 * daylight-saving boundary still compares 30 days with 30 days, not 30 days
 * with 29 days and 23 hours.
 */
export function previousRange(range: Range, timezone: string): Range {
  const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000))
  return {
    from: addDays(range.from, -days, timezone),
    to: range.from,
  }
}

/** Every bucket start in a range, so a chart can render empty days as zero. */
export function bucketsFor(range: Range, grain: Grain, timezone: string): Date[] {
  const buckets: Date[] = []
  let cursor = truncate(range.from, grain, timezone)

  // A generous ceiling: an hourly grain over a year is 8760 buckets, and
  // anything past this is a query nobody should be rendering as a chart.
  for (let i = 0; i < 20_000 && cursor < range.to; i++) {
    buckets.push(cursor)
    cursor = next(cursor, grain, timezone)
  }

  return buckets
}

export function truncate(instant: Date, grain: Grain, timezone: string): Date {
  switch (grain) {
    case 'hour': {
      const { year, month, day } = localParts(instant, timezone)
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(instant))
      return instantFor(year, month, day, hour === 24 ? 0 : hour, timezone)
    }
    case 'week':
      return startOfWeek(instant, timezone)
    case 'month':
      return startOfMonth(instant, timezone)
    case 'day':
    default:
      return startOfDay(instant, timezone)
  }
}

function next(instant: Date, grain: Grain, timezone: string): Date {
  switch (grain) {
    case 'hour':
      return new Date(instant.getTime() + 3_600_000)
    case 'week':
      return addDays(instant, 7, timezone)
    case 'month': {
      const { year, month } = localParts(instant, timezone)
      return instantFor(year, month + 1, 1, 0, timezone)
    }
    case 'day':
    default:
      return addDays(instant, 1, timezone)
  }
}

/**
 * A sensible grain for a range, when a block does not name one.
 *
 * Aiming for something between 10 and 100 points: fewer reads as a bar chart
 * pretending to be a line, more is a smear nobody can point at.
 */
export function defaultGrain(range: Range): Grain {
  const days = (range.to.getTime() - range.from.getTime()) / 86_400_000

  if (days <= 2)
    return 'hour'
  if (days <= 62)
    return 'day'
  if (days <= 400)
    return 'week'
  return 'month'
}
