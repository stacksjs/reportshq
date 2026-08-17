/**
 * Reports that run inside your own Stacks application, against your own
 * database.
 *
 * Nothing here reaches the network. The compiler queries in process through the
 * database the application already configured, the charts are compiled
 * components rendered in the reader's browser, and the licence is checked
 * offline.
 *
 * Everything is exported by name and imported by name. The package never
 * reaches for a path inside the framework, which is what lets one build serve a
 * vendored checkout, where `@stacksjs/*` are workspaces under
 * `storage/framework/core`, and an unvendored one, where the same specifiers
 * come from npm. A relative import into the framework would work in exactly one
 * of those and fail confusingly in the other.
 */

export { Compiler, type Db } from './compiler'
export { defaults, type ReportsHQConfig, resolveConfig } from './config'
export { elementHtml, tagFor } from './elements'
export { csv, filename, HEADINGS, toRows } from './export'
export { createHandlers, type Handlers, NotFound, readQuery, type ReportStore } from './http/handlers'
export { isNotFound, reportRoutes, type RouteDescription } from './http/routes'
export { COLUMNS, pack } from './layout'
export { License, LICENSE_PREFIX } from './license'
export { Registry, SemanticError } from './semantic'
export { Runner, type StoredBlock } from './runner'
export * from './types'
