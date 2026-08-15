/**
 * Making a set of blocks fit on the grid.
 *
 * The rule the whole builder rests on: **two blocks never occupy the same
 * cell**. CSS grid does not enforce that. Given overlapping placements it
 * silently stacks them, so a report that overlaps does not look broken in the
 * builder, it looks fine right up until a viewer opens it at a different width
 * and finds a chart drawn on top of a table.
 *
 * This runs on the server, on every write, and its result is what gets stored.
 * The client does the same push-down while you drag so the grid moves under your
 * hand, but that copy is a preview: the save response carries the authoritative
 * layout back, and the client adopts it. One implementation decides, the other
 * illustrates. A client that skipped the push-down entirely, or sent deliberate
 * nonsense, still cannot store an overlap.
 */
import { GRID_COLUMNS } from './schema'

export interface Placement {
  id: number
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Placement, b: Placement): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Resolve overlaps by pushing blocks down.
 *
 * Order decides who wins. `moved` is the block the person is holding, so it is
 * placed first and keeps exactly the position they chose; everything else is
 * placed in reading order and slides down past whatever is already there. The
 * alternative, moving the dragged block out of the way of the ones it landed
 * on, means the block does not go where it was dropped, which reads as the
 * builder fighting you.
 *
 * Blocks are pushed **down and never pulled up**. Vertical compaction is
 * tempting, and it is what makes grid builders feel jumpy: deleting one block
 * would drag every block below it upward, rearranging a layout somebody spaced
 * out deliberately. Gaps are allowed here because a gap is a decision somebody
 * is allowed to make.
 */
export function packBlocks(blocks: Placement[], moved?: number): Placement[] {
  const clamped = blocks.map(block => ({
    id: block.id,
    // A width past the right edge is the shape a drag produces at the boundary,
    // and it has to be corrected before placement rather than rejected, or a
    // clumsy drag loses the block.
    w: Math.max(1, Math.min(GRID_COLUMNS, Math.trunc(block.w) || 1)),
    h: Math.max(1, Math.trunc(block.h) || 1),
    x: Math.max(0, Math.trunc(block.x) || 0),
    y: Math.max(0, Math.trunc(block.y) || 0),
  }))

  for (const block of clamped)
    block.x = Math.min(block.x, GRID_COLUMNS - block.w)

  const order = [...clamped].sort((a, b) => {
    if (a.id === moved)
      return -1
    if (b.id === moved)
      return 1
    if (a.y !== b.y)
      return a.y - b.y
    if (a.x !== b.x)
      return a.x - b.x
    return a.id - b.id
  })

  const settled: Placement[] = []

  for (const block of order) {
    // Downward from where it wants to be, one row at a time, until it fits. The
    // grid is small enough that scanning beats any cleverer structure, and the
    // loop terminates because every step increases y and the settled set is
    // finite.
    while (settled.some(other => overlaps(block, other)))
      block.y += 1

    settled.push(block)
  }

  return settled.sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id)
}

/** Whether any pair in a set overlaps. Used by tests and by the save path's guard. */
export function hasOverlap(blocks: Placement[]): boolean {
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (overlaps(blocks[i]!, blocks[j]!))
        return true
    }
  }

  return false
}

/**
 * The first row where a block of this size fits without pushing anything down.
 *
 * Used when adding a block, so a new one lands in a gap it fits in rather than
 * always at the bottom of the report. Falls back to below everything, which is
 * always free.
 */
export function firstFreeRow(blocks: Placement[], w: number, h: number): { x: number, y: number } {
  const bottom = blocks.reduce((lowest, block) => Math.max(lowest, block.y + block.h), 0)
  const width = Math.max(1, Math.min(GRID_COLUMNS, w))

  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x <= GRID_COLUMNS - width; x++) {
      const candidate = { id: -1, x, y, w: width, h: Math.max(1, h) }
      if (!blocks.some(block => overlaps(candidate, block)))
        return { x, y }
    }
  }

  return { x: 0, y: bottom }
}
