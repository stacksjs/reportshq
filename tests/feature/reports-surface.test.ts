import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { models, reports } from '../../config/reportshq'

/**
 * Our own reports, mounted.
 *
 * We run our own package here, which is worth doing for the obvious reason and
 * for a less obvious one: the descriptions in `config/reportshq.ts` are the
 * first thing a customer writes, so getting them wrong is something we should
 * feel before they do.
 */

const root = join(import.meta.dir, '..', '..')

describe('the reports surface', () => {
  it('describes only what it means to expose', () => {
    // The allowlist is the reason a dimension key can arrive in a URL at all.
    // `users` carries a password hash and tokens; none of them are named, and
    // adding a column to the table does not change that.
    const user = models.user

    expect(Object.keys(user.dimensions)).toEqual(['plan'])
    expect(Object.values(user.dimensions)).not.toContain('password')
    expect(Object.values(user.dimensions)).not.toContain('email')
    expect(user.table).toBe('users')
  })

  it('defines its reports in code, so they are reviewed rather than edited', () => {
    const accounts = reports.find(report => report.slug === 'accounts')!

    expect(accounts.blocks.length).toBeGreaterThan(0)

    for (const block of accounts.blocks) {
      // Every block either asks a question or is a note. A block with neither
      // renders as an empty tile nobody can explain.
      expect(Boolean((block as any).query) || block.kind === 'note').toBe(true)
    }
  })

  it('only asks for measures and time keys that exist', () => {
    // A block naming something undescribed compiles to a refusal, which is
    // correct behaviour and a broken dashboard. Catching it here means the
    // refusal is never something our own users meet.
    for (const report of reports) {
      for (const block of report.blocks) {
        const query = (block as any).query

        if (!query)
          continue

        const model = models[query.model]

        expect(model).toBeDefined()
        expect(Object.keys(model.measures)).toContain(query.measure)

        if (query.time)
          expect(Object.keys(model.time)).toContain(query.time.key)

        if (query.dimension)
          expect(Object.keys(model.dimensions)).toContain(query.dimension.key)
      }
    }
  })

  it('serves the pages as views, and everything else as routes', () => {
    // In a Stacks application a view is the route, so the pages are stx files
    // and the route file deliberately skips them. Mounting both would give one
    // URL two handlers and make which answers a question of registration order.
    expect(existsSync(join(root, 'resources/views/reports/index.stx'))).toBe(true)
    expect(existsSync(join(root, 'resources/views/reports/[slug].stx'))).toBe(true)

    const routes = readFileSync(join(root, 'routes/reports.ts'), 'utf8')

    expect(routes).toContain(`description.name === 'reportshq.index'`)
    expect(routes).toContain('continue')
  })

  it('guards both pages on the server, not in the browser', () => {
    // The trap this repo has hit before: a page that renders its numbers and
    // hides them client-side still serves them to curl. The server decides,
    // because it is the only side that can read an HttpOnly cookie.
    for (const page of ['resources/views/reports/index.stx', 'resources/views/reports/[slug].stx']) {
      const source = readFileSync(join(root, page), 'utf8')

      expect(source).toContain('sessionFrom(cookies)')
      expect(source).toContain(`@include('AuthGuard')`)
      expect(source).toContain('auth-required')
      // And the data is fetched only for an identified visitor.
      expect(source).toMatch(/if \(!user\)|user \?/)
    }
  })

  it('points the download at the route that serves it', () => {
    // The page lives at /reports/{slug} and the download at
    // /api/reports/{slug}/download/csv. They share a name and not a path, and
    // linking to the page prefix 404s.
    const page = readFileSync(join(root, 'resources/views/reports/[slug].stx'), 'utf8')

    expect(page).toContain('/api/reports/{{ report.slug }}/download/csv')
  })

  it('keeps the nav pointing at pages that exist', () => {
    // Projects were deleted with the hosted pipeline and the nav still linked
    // to them, which is how a 404 ends up one click from every signed-in page.
    const nav = readFileSync(join(root, 'resources/partials/AppNav.stx'), 'utf8')

    expect(nav).not.toContain('/projects')
  })
})
