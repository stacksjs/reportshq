/**
 * Every internal link on the public pages goes somewhere.
 *
 * This exists because three did not. The footer and the landing page shipped
 * links to `/docs/taxonomy`, `/docs/stacks` and `/docs/laravel` when only the
 * first two words of that sentence were true, and nothing complained: the pages
 * rendered, the links were styled, and they returned the 404 page when clicked.
 * A dead internal link is invisible to everyone except the person following it.
 *
 * A `window.location.replace(...)` counts as a link here, and reading only
 * `href` is how five of them survived: login, register and forgot all bounced
 * to `/projects` for months after the page was deleted, on both the
 * already-signed-in path and the just-signed-in one. Nothing caught it. This
 * file read attributes and skipped scripts; the deploy check probes `/` and the
 * marketing pages and never signs in; and the live site kept answering 200
 * because the release predated the deletion. The first correct deploy would
 * have sent every person who signed in to a 404.
 *
 * Resolution mirrors how the app serves things: a view at
 * `resources/views/<path>.stx` or `resources/views/<path>/index.stx`, or a
 * document at `docs/<path>.md`.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..', '..')
const views = join(root, 'resources', 'views')
const partials = join(root, 'resources', 'partials')
const docs = join(root, 'docs')

/** The public pages, plus the chrome they all include. */
function publicTemplates(): string[] {
  const files = [
    join(views, 'index.stx'),
    join(views, 'pricing.stx'),
    join(partials, 'SiteNav.stx'),
    join(partials, 'SiteFooter.stx'),
    // The auth pages are public in the sense that matters here: they render for
    // a stranger, and they are where a link is most expensive to get wrong.
    // Somebody following a dead marketing link tries another; somebody bounced
    // to a dead page by signing in has no way forward at all.
    join(views, 'login.stx'),
    join(views, 'register.stx'),
    join(views, 'forgot.stx'),
    join(views, 'reset.stx'),
    join(views, 'account.stx'),
    join(partials, 'AuthGuard.stx'),
  ]

  for (const group of ['features', 'use-cases', 'compare']) {
    const dir = join(views, group)
    for (const name of readdirSync(dir))
      files.push(join(dir, name))
  }

  return files
}

/**
 * Every internal destination a template names, whether the browser follows it
 * on a click or on load.
 *
 * Static only. A binding is resolved at render time and cannot be read here.
 */
function linksIn(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found = new Set<string>()

  const patterns = [
    /href="([^"{}]+)"/g,
    // A redirect is a link the visitor never chose, which makes a dead one
    // worse rather than better: there is nothing to not-click.
    /location\.replace\(\s*['"]([^'"]+)['"]\s*\)/g,
    /location\.href\s*=\s*['"]([^'"]+)['"]/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const href = match[1]!

      // External, mail and in-page links are somebody else's problem.
      if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#'))
        continue

      found.add(href.split('#')[0]!.split('?')[0]!)
    }
  }

  return [...found]
}

/** Whether the app serves something at this path. */
function resolves(path: string): boolean {
  if (path === '/')
    return existsSync(join(views, 'index.stx'))

  const clean = path.replace(/^\/+|\/+$/g, '')

  if (clean === 'docs')
    return existsSync(join(docs, 'index.md'))

  if (clean.startsWith('docs/'))
    return existsSync(join(docs, `${clean.slice('docs/'.length)}.md`))

  // A static asset is a real URL too. Without this the guard reports a
  // stylesheet or a script as a dead link, which is the opposite of true and
  // sends whoever sees it looking for a missing page.
  if (existsSync(join(root, 'public', clean)))
    return true

  return existsSync(join(views, `${clean}.stx`)) || existsSync(join(views, clean, 'index.stx'))
}

describe('internal links on the public pages', () => {
  const templates = publicTemplates()

  it('finds pages to check', () => {
    // A guard on the guard: if the glob above ever stops matching, this suite
    // would pass by checking nothing at all.
    expect(templates.length).toBeGreaterThan(15)
  })

  for (const file of templates) {
    const name = file.replace(`${root}/`, '')

    it(`${name} links only to pages that exist`, () => {
      const dead = linksIn(file).filter(href => !resolves(href))

      expect(dead).toEqual([])
    })
  }
})

describe('the marketing pages are reachable from the chrome', () => {
  it('the footer links to every marketing page', () => {
    // The footer renders its columns from the page list, so this is really
    // asserting that the partial still reads that list rather than a copy.
    const footer = readFileSync(join(partials, 'SiteFooter.stx'), 'utf8')

    expect(footer).toContain('pagesIn')
    expect(footer).toContain('pathFor')
  })
})
