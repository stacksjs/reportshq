/**
 * sitemap.xml and robots.txt, as strings.
 *
 * These are written into `public/` by `scripts/generate-seo.ts` and committed,
 * because the document root is served by the static handler: a route declared
 * for `/sitemap.xml` is never reached, and a crawler will not look anywhere
 * else for it.
 *
 * A committed file generated from a list is a file that can fall behind the
 * list, so `tests/feature/seo-files.test.ts` regenerates both and compares them
 * against what is on disk. Adding a page without regenerating fails there
 * rather than silently shipping a sitemap that omits it, which is the sort of
 * mistake nobody finds because the site looks fine.
 */
import { publicPaths } from './pages'

/** Where the site is served. The canonical host, not a request's Host header. */
export const SITE = 'https://reportshq.org'

/**
 * How often each kind of page is worth re-reading.
 *
 * Advisory, and treated as such by every crawler that matters, but a page that
 * changes twice a year should not claim to change daily.
 */
function changefreqFor(path: string): string {
  return path === '/' ? 'weekly' : 'monthly'
}

/** Priority relative to the rest of this site, not to the web. */
function priorityFor(path: string): string {
  if (path === '/')
    return '1.0'

  if (path === '/pricing' || path === '/docs')
    return '0.9'

  // A hub is one segment; a detail page is two.
  return path.split('/').filter(Boolean).length === 1 ? '0.8' : '0.7'
}

export function sitemapXml(): string {
  const urls = publicPaths().map((path) => {
    return [
      '  <url>',
      `    <loc>${SITE}${path}</loc>`,
      `    <changefreq>${changefreqFor(path)}</changefreq>`,
      `    <priority>${priorityFor(path)}</priority>`,
      '  </url>',
    ].join('\n')
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

export function robotsTxt(): string {
  return [
    'User-agent: *',
    'Allow: /',
    // The application itself, and the surfaces reached by a session or a token.
    // Excluded because they are worthless to an index, and because a shared
    // report is shared with whoever holds the link rather than with the web.
    'Disallow: /account',
    'Disallow: /projects',
    'Disallow: /reports',
    'Disallow: /s/',
    'Disallow: /embed',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n')
}
