/**
 * Grid packing.
 *
 * The invariant is small enough to state in a sentence and worth this many
 * tests anyway: no two blocks share a cell. CSS grid does not enforce it and
 * does not complain about it, so an overlap that gets stored is invisible in
 * the builder and shows up as one chart drawn over another in somebody else's
 * browser.
 */
import { describe, expect, test } from 'bun:test'
import { firstFreeRow, hasOverlap, packBlocks } from '../../app/Reports/layout'
import { GRID_COLUMNS } from '../../app/Reports/schema'

function block(id: number, x: number, y: number, w = 3, h = 2): { id: number, x: number, y: number, w: number, h: number } {
  return { id, x, y, w, h }
}

describe('packBlocks', () => {
  test('leaves a layout that already fits exactly as it is', () => {
    const blocks = [block(1, 0, 0), block(2, 3, 0), block(3, 0, 2)]
    expect(packBlocks(blocks)).toEqual(blocks)
  })

  test('pushes an overlapped block down', () => {
    const packed = packBlocks([block(1, 0, 0, 6, 2), block(2, 0, 0, 6, 2)])

    expect(hasOverlap(packed)).toBeFalse()
    expect(packed.find(entry => entry.id === 2)!.y).toBe(2)
  })

  test('the held block keeps the position it was dropped at', () => {
    // The point of `moved`. Without it the dragged block is as likely to be
    // pushed as to push, and it does not end up where it was let go.
    const packed = packBlocks([block(1, 0, 0, 6, 2), block(2, 0, 0, 6, 2)], 2)

    expect(packed.find(entry => entry.id === 2)!.y).toBe(0)
    expect(packed.find(entry => entry.id === 1)!.y).toBe(2)
  })

  test('a push cascades through everything below it', () => {
    const packed = packBlocks([
      block(1, 0, 0, 12, 2),
      block(2, 0, 2, 12, 2),
      block(3, 0, 4, 12, 2),
      block(4, 0, 0, 12, 2),
    ], 4)

    expect(hasOverlap(packed)).toBeFalse()
    expect(packed.map(entry => entry.id)).toEqual([4, 1, 2, 3])
  })

  test('blocks side by side are not treated as overlapping', () => {
    const packed = packBlocks([block(1, 0, 0, 6, 4), block(2, 6, 0, 6, 4)])

    expect(packed.every(entry => entry.y === 0)).toBeTrue()
  })

  test('gaps are left alone', () => {
    // Never pulls up. Compaction would drag every block below a deleted one
    // upward and rearrange a layout somebody spaced out on purpose.
    const packed = packBlocks([block(1, 0, 0), block(2, 0, 9)])

    expect(packed.find(entry => entry.id === 2)!.y).toBe(9)
  })

  test('a block wider than the grid is trimmed rather than dropped', () => {
    const packed = packBlocks([block(1, 0, 0, 40, 2)])

    expect(packed[0]!.w).toBe(GRID_COLUMNS)
  })

  test('a block hanging off the right edge is pulled back in', () => {
    const packed = packBlocks([block(1, 10, 0, 6, 2)])

    expect(packed[0]!.x).toBe(GRID_COLUMNS - 6)
    expect(packed[0]!.x + packed[0]!.w).toBeLessThanOrEqual(GRID_COLUMNS)
  })

  test('negative and fractional coordinates are made sane', () => {
    // These arrive from a real drag: a pointer above the grid gives a negative
    // row, and a division by cell width gives a fraction.
    const packed = packBlocks([{ id: 1, x: -4, y: -2, w: 3.7, h: 2.2 }])

    expect(packed[0]!.x).toBe(0)
    expect(packed[0]!.y).toBe(0)
    expect(packed[0]!.w).toBe(3)
    expect(packed[0]!.h).toBe(2)
  })

  test('zero and missing sizes become one cell rather than an invisible block', () => {
    const packed = packBlocks([{ id: 1, x: 0, y: 0, w: 0, h: 0 }])

    expect(packed[0]!.w).toBe(1)
    expect(packed[0]!.h).toBe(1)
  })

  test('everything piled on one cell ends up in a column, in order', () => {
    const piled = Array.from({ length: 8 }, (_, index) => block(index + 1, 0, 0, 12, 1))
    const packed = packBlocks(piled)

    expect(hasOverlap(packed)).toBeFalse()
    expect(packed.map(entry => entry.y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  test('packing is stable: packing an already packed layout changes nothing', () => {
    const once = packBlocks([block(1, 0, 0, 12, 2), block(2, 0, 0, 12, 2), block(3, 4, 1, 4, 3)])
    expect(packBlocks(once)).toEqual(once)
  })

  test('an empty report packs to an empty layout', () => {
    expect(packBlocks([])).toEqual([])
  })
})

describe('firstFreeRow', () => {
  test('an empty grid places at the origin', () => {
    expect(firstFreeRow([], 6, 4)).toEqual({ x: 0, y: 0 })
  })

  test('fills a gap beside an existing block rather than going to the bottom', () => {
    // Adding a big number to a report whose top row has room should use that
    // room. Sending every new block to the end means each one starts with a drag.
    expect(firstFreeRow([block(1, 0, 0, 6, 4)], 6, 4)).toEqual({ x: 6, y: 0 })
  })

  test('goes below when the row cannot fit it', () => {
    expect(firstFreeRow([block(1, 0, 0, 8, 2)], 6, 2).y).toBeGreaterThan(0)
  })

  test('a full-width block always lands under everything', () => {
    expect(firstFreeRow([block(1, 0, 0, 12, 3)], 12, 2)).toEqual({ x: 0, y: 3 })
  })

  test('what it returns never overlaps what is there', () => {
    const existing = [block(1, 0, 0, 4, 2), block(2, 4, 0, 4, 2), block(3, 0, 2, 12, 2)]
    const spot = firstFreeRow(existing, 4, 2)

    expect(hasOverlap([...existing, { id: 99, ...spot, w: 4, h: 2 }])).toBeFalse()
  })
})

describe('hasOverlap', () => {
  test('touching edges do not count', () => {
    expect(hasOverlap([block(1, 0, 0, 6, 2), block(2, 6, 0, 6, 2)])).toBeFalse()
    expect(hasOverlap([block(1, 0, 0, 6, 2), block(2, 0, 2, 6, 2)])).toBeFalse()
  })

  test('a single overlapping cell counts', () => {
    expect(hasOverlap([block(1, 0, 0, 6, 2), block(2, 5, 1, 6, 2)])).toBeTrue()
  })
})
