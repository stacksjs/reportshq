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
}

export interface Handlers {
  index: () => Promise<{ reports: Awaited<ReturnType<ReportStore['list']>> }>
  show: (slug: string, published?: boolean) => Promise<{ report: any, blocks: RenderedBlock[] }>
  schema: () => { models: unknown, grains: unknown }
  download: (slug: string, format: string) => Promise<{ body: string, headers: Record<string, string> }>
  saveLayout: (slug: string, blocks: Array<{ id: number, x: number, y: number, w: number, h: number }>) => Promise<{ blocks: RenderedBlock[] }>
}

export class NotFound extends Error {}

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

  return {
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
