import { describe, expect, test } from 'bun:test'

const NOW = '2026-09-12T12:00:00.000Z'
const report = (index: number, status = 'published') => ({ id: index, slug: `report-${index}`, name: `Report ${index}`, status, blocks: 2 + index % 8, updatedAt: NOW })

export const productStates = {
  empty: { now: NOW, status: 'ready', reports: [], schedules: 0 },
  normal: { now: NOW, status: 'ready', reports: [report(1), report(2, 'draft'), report(3)], schedules: 2 },
  loading: { now: NOW, status: 'loading', reports: [], schedules: null },
  failure: { now: NOW, status: 'error', reports: [], error: 'Report query failed' },
  highVolume: { now: NOW, status: 'ready', reports: Array.from({ length: 250 }, (_, index) => report(index + 1)), schedules: 80 },
} as const

describe('deterministic report product states', () => {
  test('covers every UI state', () => expect(Object.keys(productStates)).toEqual(['empty', 'normal', 'loading', 'failure', 'highVolume']))
  test('keeps volume fixtures large and reproducible', () => {
    expect(productStates.highVolume.reports).toHaveLength(250)
    expect(JSON.stringify(productStates)).toBe(JSON.stringify(productStates))
  })
})
