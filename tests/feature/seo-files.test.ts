/**
 * The committed crawler files match the marketing page list.
 *
 * public/sitemap.xml and public/robots.txt are generated artefacts that have to
 * be committed, because the document root is served by the static handler and a
 * route for /sitemap.xml is never reached. A generated file that is committed
 * is a file that can fall behind its source, and the failure is invisible: the
 * new page renders, links, and is simply never crawled.
 *
 * So the check lives here. Add a page, forget to run
 * `bun run scripts/generate-seo.ts`, and this fails with the diff.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PAGES, pathFor, publicPaths } from '../../app/Marketing/pages'
import { robotsTxt, SITE, sitemapXml } from '../../app/Marketing/seo-files'

const publicDir = join(import.meta.dir, '..', '..', 'public')

function committed(name: string): string {
  return readFileSync(join(publicDir, name), 'utf8')
}

describe('generated crawler files', () => {
  it('public/sitemap.xml is what the generator would write', () => {
    expect(committed('sitemap.xml')).toBe(sitemapXml())
  })

  it('public/robots.txt is what the generator would write', () => {
    expect(committed('robots.txt')).toBe(robotsTxt())
  })
})

describe('sitemap contents', () => {
  it('lists every marketing page', () => {
    const xml = sitemapXml()

    for (const page of PAGES)
      expect(xml).toContain(`<loc>${SITE}${pathFor(page)}</loc>`)
  })

  it('lists the home page, pricing and docs', () => {
    const xml = sitemapXml()

    for (const path of ['/', '/pricing', '/docs'])
      expect(xml).toContain(`<loc>${SITE}${path}</loc>`)
  })

  it('has one url element per public path and no duplicates', () => {
    const xml = sitemapXml()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])

    expect(locs).toHaveLength(publicPaths().length)
    expect(new Set(locs).size).toBe(locs.length)
  })

  it('uses absolute URLs on the canonical host', () => {
    for (const loc of [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]))
      expect(loc.startsWith(`${SITE}/`)).toBe(true)
  })
})

describe('robots.txt', () => {
  it('points at the sitemap', () => {
    expect(robotsTxt()).toContain(`Sitemap: ${SITE}/sitemap.xml`)
  })

  it('keeps the application and token-reached surfaces out of the index', () => {
    const robots = robotsTxt()

    // A share link is shared with whoever holds it, not with the web.
    for (const path of ['/account', '/projects', '/reports', '/s/', '/embed', '/api/'])
      expect(robots).toContain(`Disallow: ${path}`)
  })

  it('does not disallow anything the sitemap advertises', () => {
    const disallowed = [...robotsTxt().matchAll(/^Disallow: (.+)$/gm)].map(m => m[1].trim())

    for (const path of publicPaths()) {
      for (const rule of disallowed)
        expect(path.startsWith(rule)).toBe(false)
    }
  })
})
