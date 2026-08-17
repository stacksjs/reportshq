import type { ReportStore, StoredBlock } from '@reportshq/stacks'
import { Compiler, createHandlers, Registry, Runner } from '@reportshq/stacks'
import { db } from '@stacksjs/database'
import { models, reports } from '../../config/reportshq'

/**
 * This application's own reports, through our own package.
 *
 * The store is backed by the config rather than by tables. These reports do not
 * change from a browser, so storing them would buy an editing surface nobody
 * uses and cost a migration. The package takes a store interface precisely so
 * an application can decide that for itself.
 */
const registry = new Registry(models)

/**
 * The compiler takes the connection this application already configured rather
 * than opening one. Two pools with two opinions about the same database is not
 * something a reporting package should introduce.
 */
const runner = new Runner(new Compiler(registry, db as any, 'sqlite'))

const store: ReportStore = {
  async list() {
    return reports.map(({ id, name, slug, description, status }) => ({ id, name, slug, description, status }))
  },

  async find(slug: string) {
    const found = reports.find(report => report.slug === slug)

    return found ? { id: found.id, name: found.name, slug: found.slug, description: found.description } : null
  },

  async blocks(reportId: number) {
    // Published and draft are the same thing here: a report defined in code has
    // no half-finished state, because the pull request is the draft.
    return (reports.find(report => report.id === reportId)?.blocks ?? []) as StoredBlock[]
  },

  async saveLayout() {
    // Nothing to save. The grid lives in config/reportshq.ts, so a drag would
    // be edited into a file and reviewed rather than written to a table. The
    // builder is not mounted here for the same reason.
    throw new Error('Reports are defined in config/reportshq.ts and are not edited from the browser.')
  },
}

export const reportHandlers = createHandlers(store, runner, registry)
export { registry, runner }
