import type { BlockQuery, RenderedBlock } from '../types'
import type { Registry } from '../semantic'
import type { Runner, StoredBlock } from '../runner'
import { csv, filename } from '../export'
import { pack } from '../layout'

/**
 * The handlers, as plain functions.
 *
 * Deliberately not tied to the router. Each one takes what it needs and returns
 * a value, so it can be tested by calling it and mounted by whatever the
 * application uses. A handler that reaches for a global request object is a
 * handler that can only be exercised by booting the framework.
 */

export interface ReportStore {
  list: () => Promise<Array<{ id: number, name: string, slug: string, description?: string, status?: string, timezone?: string }>>
  find: (slug: string) => Promise<{ id: number, name: string, slug: string, description?: string, timezone?: string } | null>
  blocks: (reportId: number, published?: boolean) => Promise<StoredBlock[]>
  saveLayout: (reportId: number, blocks: Array<{ id: number, x: number, y: number, w: number, h: number }>) => Promise<void>

  /*
   * The writes the builder makes. Optional, because a report defined in code
   * has no editing surface and an application that wants one should not have to
   * stub four methods to say so.
   */
  addBlock?: (reportId: number, kind: string) => Promise<StoredBlock>
  saveBlock?: (reportId: number, blockId: number, patch: Partial<StoredBlock>) => Promise<void>
  removeBlock?: (reportId: number, blockId: number) => Promise<void>
  publish?: (reportId: number) => Promise<void>
}

export interface Handlers {
  index: () => Promise<{ reports: Awaited<ReturnType<ReportStore['list']>> }>
  show: (slug: string, published?: boolean) => Promise<{ report: any, blocks: RenderedBlock[] }>
  schema: () => { models: unknown, grains: unknown }
  download: (slug: string, format: string) => Promise<{ body: string, headers: Record<string, string> }>
  saveLayout: (slug: string, blocks: Array<{ id: number, x: number, y: number, w: number, h: number }>) => Promise<{ blocks: RenderedBlock[] }>
  addBlock: (slug: string, kind: string) => Promise<{ block: StoredBlock }>
  saveBlock: (slug: string, blockId: number, patch: Record<string, unknown>) => Promise<{ saved: true }>
  removeBlock: (slug: string, blockId: number) => Promise<{ removed: true }>
  publish: (slug: string) => Promise<{ published: true }>
  /** Whether this store can be written to at all, so a page can hide the builder. */
  editable: boolean
}

/** A write attempted against a store that does not accept writes. */
export class ReadOnly extends Error {}

export class NotFound extends Error {}

/** The kinds a block may be. Checked rather than trusted, since it is posted. */
export const KINDS = ['big_number', 'line', 'area', 'bar', 'donut', 'table', 'funnel', 'heatmap', 'note'] as const as readonly string[]

export function createHandlers(
  store: ReportStore,
  runner: Runner,
  registry: Registry,
  timezone = 'UTC',
): Handlers {
  const locate = async (slug: string) => {
    const report = await store.find(slug)

    if (!report)
      throw new NotFound(`No report called '${slug}'.`)

    return report
  }

  const writable = Boolean(store.addBlock && store.saveBlock && store.removeBlock)

  /** The block, if it belongs to this report. Both ids arrive from a browser. */
  const ownedBlock = async (slug: string, blockId: number) => {
    const report = await locate(slug)
    const blocks = await store.blocks(report.id, false)

    if (!blocks.some(block => block.id === blockId))
      throw new NotFound(`No block ${blockId} on '${slug}'.`)

    return report
  }

  const mustWrite = () => {
    if (!writable)
      throw new ReadOnly('This report is defined in code and is not edited from the browser.')
  }

  return {
    editable: writable,

    async addBlock(slug, kind) {
      mustWrite()

      // The kind is matched against the set that exists rather than passed
      // through: it arrives from a button in a page and ends up in storage.
      if (!KINDS.includes(kind))
        throw new NotFound(`'${kind}' is not a block kind.`)

      const report = await locate(slug)

      return { block: await store.addBlock!(report.id, kind) }
    },

    async saveBlock(slug, blockId, patch) {
      mustWrite()
      const report = await ownedBlock(slug, blockId)

      // Only the fields a panel edits. A patch straight from a request would
      // let a browser set the report id and move a block between reports.
      const clean: Partial<StoredBlock> = {}

      if (typeof patch.title === 'string') clean.title = patch.title
      if (typeof patch.body === 'string') clean.body = patch.body
      if (patch.query && typeof patch.query === 'object') clean.query = readQuery(patch.query as Record<string, unknown>)

      await store.saveBlock!(report.id, blockId, clean)

      return { saved: true as const }
    },

    async removeBlock(slug, blockId) {
      mustWrite()
      const report = await ownedBlock(slug, blockId)
      await store.removeBlock!(report.id, blockId)

      return { removed: true as const }
    },

    async publish(slug) {
      mustWrite()
      const report = await locate(slug)
      await store.publish?.(report.id)

      return { published: true as const }
    },

    async index() {
      return { reports: await store.list() }
    },

    async show(slug, published = true) {
      const report = await locate(slug)
      const blocks = await store.blocks(report.id, published)

      return {
        report,
        blocks: await runner.report(blocks, report.timezone ?? timezone),
      }
    },

    schema() {
      return registry.choices()
    },

    async download(slug, format) {
      if (format !== 'csv')
        throw new NotFound(`Reports export as csv, not '${format}'.`)

      const report = await locate(slug)
      const blocks = await runner.report(await store.blocks(report.id, true), report.timezone ?? timezone)
      const body = csv(blocks)

      return {
        body,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          // Generated on demand rather than stored and linked. The numbers are
          // one query away, so there is nothing to clean up and no way to serve
          // a stale copy.
          'Content-Disposition': `attachment; filename="${filename(report.name, 'csv')}"`,
        },
      }
    },

    async saveLayout(slug, incoming) {
      const report = await locate(slug)
      const stored = await store.blocks(report.id, false)
      const known = new Set(stored.map(block => block.id))

      // A layout naming a block from another report is ignored rather than
      // applied. Both ids arrive from a browser, so neither is trusted.
      const claimed = incoming.filter(block => known.has(block.id))
      const packed = pack(claimed)

      await store.saveLayout(report.id, packed.map(block => ({
        id: block.id,
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
      })))

      // The canonical positions go back to the client, which is what stops the
      // browser and the database disagreeing about where a block sits.
      return { blocks: await runner.report(await store.blocks(report.id, false), report.timezone ?? timezone) }
    },
  }
}

/** The query a builder panel posts, narrowed before it reaches the compiler. */
export function readQuery(input: Record<string, unknown>): BlockQuery {
  return {
    model: String(input.model ?? ''),
    measure: String(input.measure ?? ''),
    dimension: input.dimension as BlockQuery['dimension'],
    time: input.time as BlockQuery['time'],
    grain: input.grain as BlockQuery['grain'],
    from: input.from ? String(input.from) : undefined,
    to: input.to ? String(input.to) : undefined,
    filters: Array.isArray(input.filters) ? input.filters as BlockQuery['filters'] : undefined,
    limit: input.limit ? Number(input.limit) : undefined,
  }
}
