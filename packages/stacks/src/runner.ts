import type { BlockQuery, RenderedBlock } from './types'
import type { Compiler } from './compiler'
import { SemanticError } from './semantic'

/** A block as stored: geometry, identity, and the question it asks. */
export interface StoredBlock {
  id?: number
  kind: RenderedBlock['kind']
  title?: string
  body?: string
  x?: number
  y?: number
  w?: number
  h?: number
  query?: BlockQuery
}

/**
 * A report's blocks, run.
 *
 * One block that cannot be answered is not a failed report. A refusal is
 * carried on the block it belongs to and the rest of the page renders, because
 * the alternative is a reader losing eleven working charts to one bad question.
 *
 * Anything unexpected is caught here too, for a blunter reason: an exception
 * escaping this loop takes the whole page with it, and a report that will not
 * load tells nobody anything. What reaches the block is a sentence; what
 * reaches the log is the stack.
 */
export class Runner {
  constructor(private readonly compiler: Compiler) {}

  async report(blocks: StoredBlock[], timezone = 'UTC'): Promise<RenderedBlock[]> {
    return Promise.all(blocks.map(block => this.block(block, timezone)))
  }

  async block(block: StoredBlock, timezone = 'UTC'): Promise<RenderedBlock> {
    const frame: RenderedBlock = {
      id: block.id,
      kind: block.kind,
      title: block.title,
      body: block.body,
      x: block.x ?? 0,
      y: block.y ?? 0,
      w: block.w ?? 4,
      h: block.h ?? 4,
      series: [],
      total: 0,
      error: null,
    }

    // A note has no query and is not a failure for lacking one.
    if (block.kind === 'note' || !block.query)
      return frame

    try {
      const result = await this.compiler.run(block.query, timezone)

      return { ...frame, ...result }
    }
    catch (error) {
      if (error instanceof SemanticError)
        return { ...frame, error: error.message }

      // Not a refusal: something actually broke. The reader gets a sentence
      // they can act on, and the detail goes where an engineer will find it.
      console.error('[reportshq] block failed', { id: block.id, error })

      return { ...frame, error: 'This block could not be calculated.' }
    }
  }
}
