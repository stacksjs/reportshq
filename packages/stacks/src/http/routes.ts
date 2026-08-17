import type { Handlers } from './handlers'
import { NotFound } from './handlers'

/**
 * The routes, as a description rather than as registrations.
 *
 * The package does not call the router. It describes what it needs and the
 * application mounts it, which is the difference between a package that works
 * in an application and a package that assumes it is the application. A Stacks
 * app has opinions about prefixes, middleware and where a route table lives,
 * and none of them are ours to overrule.
 *
 *     // routes/reports.ts
 *     import { reportRoutes } from '@reportshq/stacks'
 *     import { route } from '@stacksjs/router'
 *
 *     for (const r of reportRoutes(handlers))
 *       route[r.method](r.path, r.handle)
 */
export interface RouteDescription {
  method: 'get' | 'post'
  path: string
  name: string
  /** Whether this one is meant to be reachable without a session. */
  public?: boolean
  handle: (context: { params?: Record<string, string>, body?: any }) => Promise<unknown>
}

export function reportRoutes(handlers: Handlers): RouteDescription[] {
  return [
    {
      method: 'get',
      path: '/',
      name: 'reportshq.index',
      handle: async () => handlers.index(),
    },
    {
      // Before `/{slug}`, or a report called "schema" is unreachable and the
      // schema endpoint is read as a slug.
      method: 'get',
      path: '/schema',
      name: 'reportshq.schema',
      handle: async () => handlers.schema(),
    },
    {
      method: 'get',
      path: '/{slug}/download/{format}',
      name: 'reportshq.download',
      handle: async ({ params }) => handlers.download(params!.slug, params!.format),
    },
    {
      method: 'get',
      path: '/{slug}/draft',
      name: 'reportshq.draft',
      // Its own path rather than a flag on the one below, so a client cannot
      // ask for the draft by accident and show a half arranged grid.
      handle: async ({ params }) => handlers.show(params!.slug, false),
    },
    {
      method: 'post',
      path: '/{slug}/blocks',
      name: 'reportshq.blocks.add',
      handle: async ({ params, body }) => handlers.addBlock(params!.slug, String(body?.kind ?? '')),
    },
    {
      method: 'post',
      path: '/{slug}/blocks/{block}',
      name: 'reportshq.blocks.save',
      handle: async ({ params, body }) => handlers.saveBlock(params!.slug, Number(params!.block), body ?? {}),
    },
    {
      method: 'post',
      path: '/{slug}/blocks/{block}/delete',
      name: 'reportshq.blocks.remove',
      handle: async ({ params }) => handlers.removeBlock(params!.slug, Number(params!.block)),
    },
    {
      method: 'post',
      path: '/{slug}/publish',
      name: 'reportshq.publish',
      handle: async ({ params }) => handlers.publish(params!.slug),
    },
    {
      method: 'post',
      path: '/{slug}/layout',
      name: 'reportshq.layout',
      handle: async ({ params, body }) => handlers.saveLayout(params!.slug, body?.blocks ?? []),
    },
    {
      method: 'get',
      path: '/{slug}',
      name: 'reportshq.show',
      handle: async ({ params }) => handlers.show(params!.slug, true),
    },
  ]
}

/** A refusal the application can turn into whatever a 404 looks like for it. */
export function isNotFound(error: unknown): error is NotFound {
  return error instanceof NotFound
}
