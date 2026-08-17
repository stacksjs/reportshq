import { describe, expect, it } from 'bun:test'
import { COLUMNS, pack } from '../src/layout'

/**
 * What a drag meant.
 *
 * These are the rules people expect without being able to state them, which is
 * why they are worth writing down as tests rather than trusting to feel.
 */

const b = (x: number, y: number, w = 4, h = 4) => ({ x, y, w, h })

describe('packing a grid', () => {
  it('leaves a settled layout alone', () => {
    const settled = [b(0, 0), b(4, 0), b(0, 4)]

    expect(pack(settled)).toEqual(settled)
  })

  it('is a fixed point', () => {
    const once = pack([b(0, 3), b(4, 7), b(0, 9)])

    expect(pack(once)).toEqual(once)
  })

  it('closes a hole left by a delete', () => {
    // The block at y=8 floats up into the space the deleted one left, rather
    // than leaving a gap somebody has to drag across.
    expect(pack([b(0, 0), b(0, 8)])).toEqual([b(0, 0), b(0, 4)])
  })

  it('pushes by the full height of what displaced it', () => {
    const packed = pack([b(0, 0, 4, 6), b(0, 0, 4, 4)])

    // Not by one row: a block that overlaps by a single row still has to clear
    // the whole thing, which is the bug every hand-rolled grid ships first.
    expect(packed[1].y).toBe(6)
  })

  it('keeps two blocks out of one cell', () => {
    const packed = pack([b(0, 0), b(0, 0), b(0, 0)])

    expect(packed.map(p => p.y)).toEqual([0, 4, 8])
  })

  it('keeps a block inside the grid', () => {
    const packed = pack([{ x: 11, y: 0, w: 6, h: 4 }])

    expect(packed[0].x + packed[0].w).toBeLessThanOrEqual(COLUMNS)
  })

  it('refuses a negative or zero size', () => {
    const packed = pack([{ x: -3, y: -2, w: 0, h: 0 }])

    expect(packed[0]).toMatchObject({ x: 0, y: 0 })
    expect(packed[0].w).toBeGreaterThan(0)
    expect(packed[0].h).toBeGreaterThan(0)
  })

  it('lets the dropped block keep its cell', () => {
    // Index 1 is the one the reader just dropped, so it wins the contested
    // cell and the other yields, not the other way round.
    const packed = pack([b(0, 0), b(0, 0)], 1)

    expect(packed[0].y).toBe(0)
  })
})
