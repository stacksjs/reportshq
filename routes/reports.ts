import { route } from '@stacksjs/router'
import { isNotFound, reportRoutes } from '@reportshq/stacks'
import { reportHandlers } from '../app/Support/reports'

/**
 * The JSON half of our own reports.
 *
 * The pages are stx files under `resources/views/reports/`, because in a Stacks
 * application a view is the route: dropping `[slug].stx` in there is what
 * publishes `/reports/{slug}`. What is left for this file is everything a page
 * is not, which is the schema, the download and the draft.
 *
 * The package describes these rather than registering them, so this file
 * decides the prefix and the middleware. That is the arrangement on purpose: a
 * package that calls the router has made those decisions for the application.
 */
for (const description of reportRoutes(reportHandlers)) {
  // The two page routes are served by stx, not from here. Mounting them again
  // would give one URL two handlers and make which one answers a question of
  // registration order.
  if (description.name === 'reportshq.index' || description.name === 'reportshq.show')
    continue

  route[description.method](description.path, async (request: any) => {
    try {
      const result = await description.handle({
        params: request?.params ?? {},
        body: request?.body ?? {},
      })

      if (description.name === 'reportshq.download') {
        const { body, headers } = result as { body: string, headers: Record<string, string> }

        return new Response(body, { headers })
      }

      return result
    }
    catch (error) {
      if (isNotFound(error))
        return response.json({ message: (error as Error).message }, 404)

      throw error
    }
  })
}
