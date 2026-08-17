import type { RenderedBlock } from './types'

export const COLUMNS = 12

/**
 * Settling a grid after somebody moved something.
 *
 * Runs on the server as well as in the browser, and that is the point. The
 * hosted builder packed client-side and stored whatever it was told, so the
 * browser and the database could disagree and only the browser was ever right.
 * Here the client packs optimistically for the feel of it, the server packs
 * again for the record, and the response carries the canonical positions back.
 *
 * The rules are the ones people expect without being able to state them: the
 * block you dropped keeps the cell you dropped it in, everything it displaces
 * moves down by the full height of what displaced it, and holes close.
 */
export function pack<T extends Pick<RenderedBlock, 'x' | 'y' | 'w' | 'h'>>(
  blocks: T[],
  pinned?: number,
): T[] {
  // Sorted by position, with the pinned block first among equals so it keeps
  // the cell it was dropped in and the others yield around it.
  const ordered = [...blocks].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y
    if (a.x !== b.x) return a.x - b.x
    return 0
  })

  if (pinned !== undefined) {
    const index = ordered.findIndex((_, i) => i === pinned)

    if (index > 0)
      ordered.unshift(...ordered.splice(index, 1))
  }

  const placed: T[] = []

  for (const block of ordered) {
    const w = clamp(block.w, 1, COLUMNS)
    const x = clamp(block.x, 0, COLUMNS - w)
    const h = Math.max(1, block.h)

    let y = Math.max(0, block.y)

    // Drop it until it rests on something rather than inside it.
    while (placed.some(other => overlaps({ x, y, w, h }, other)))
      y++

    // Then float it up into any hole it can reach, which is what closes gaps
    // left by a delete without needing a separate compaction pass.
    while (y > 0 && !placed.some(other => overlaps({ x, y: y - 1, w, h }, other)))
      y--

    placed.push({ ...block, x, y, w, h })
  }

  return placed
}

function overlaps(
  a: { x: number, y: number, w: number, h: number },
  b: { x: number, y: number, w: number, h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)))
}
