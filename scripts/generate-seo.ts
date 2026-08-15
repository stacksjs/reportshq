/**
 * Write public/sitemap.xml and public/robots.txt from the marketing page list.
 *
 * Run after adding or renaming a marketing page:
 *
 *   bun run scripts/generate-seo.ts
 *
 * tests/feature/seo-files.test.ts fails if the committed files disagree with
 * what this would write, so forgetting the step is caught rather than shipped.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { robotsTxt, sitemapXml } from '../app/Marketing/seo-files'

const publicDir = join(import.meta.dir, '..', 'public')

writeFileSync(join(publicDir, 'sitemap.xml'), sitemapXml())
writeFileSync(join(publicDir, 'robots.txt'), robotsTxt())

console.log('wrote public/sitemap.xml and public/robots.txt')
