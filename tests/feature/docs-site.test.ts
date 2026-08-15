/**
 * The documentation site describes this product, and keeps describing it.
 *
 * Three failures these exist to catch, all of which look fine from the outside:
 *
 * - A page in `docs/` that no sidebar entry reaches. It renders, it is
 *   correct, and nobody finds it.
 * - A sidebar entry pointing at a page that does not exist. The link is styled
 *   like every other and returns a 404.
 * - The builder guide listing measures or operators the schema does not accept,
 *   or missing ones it does. The issue asks for terms that match the interface
 *   exactly, and the only way to hold that is to check it.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import docsConfig from '../../config/docs'
import { GRAINS, KINDS, MEASURES, OPERATORS } from '../../app/Reports/schema'

const root = join(import.meta.dir, '..', '..')
const docsDir = join(root, 'docs')

/** Every markdown page in docs/, as its sidebar link would be written. */
function pages(): string[] {
  return readdirSync(docsDir)
    .filter(name => name.endsWith('.md'))
    .map(name => `/${name.replace(/\.md$/, '')}`)
    .filter(link => link !== '/index')
}

/** Every link in the configured sidebar, flattened. */
function sidebarLinks(): string[] {
  const sidebar = docsConfig.markdown?.sidebar as Record<string, Array<{ items?: Array<{ link: string }> }>>
  const groups = sidebar?.['/'] ?? []

  return groups.flatMap(group => (group.items ?? []).map(item => item.link))
}

describe('the docs sidebar', () => {
  it('reaches every page in docs/', () => {
    const unreachable = pages().filter(page => !sidebarLinks().includes(page))

    expect(unreachable).toEqual([])
  })

  it('points only at pages that exist', () => {
    const dead = sidebarLinks().filter(link => !existsSync(join(docsDir, `${link.slice(1)}.md`)))

    expect(dead).toEqual([])
  })

  it('has no duplicate entries', () => {
    const links = sidebarLinks()

    expect(new Set(links).size).toBe(links.length)
  })

  it('describes this product rather than the framework it is built on', () => {
    // The scaffold shipped a sidebar for the Stacks framework's own docs, which
    // is what a reader arriving from the landing page was shown.
    expect(docsConfig.markdown?.title).toContain('ReportsHQ')
    expect(JSON.stringify(sidebarLinks())).not.toContain('bootcamp')
  })
})

describe('links between docs pages', () => {
  const files = readdirSync(docsDir).filter(name => name.endsWith('.md'))

  for (const file of files) {
    it(`docs/${file} links only to pages that exist`, () => {
      const source = readFileSync(join(docsDir, file), 'utf8')
      const dead: string[] = []

      for (const match of source.matchAll(/\]\((\/[^)\s#]+)/g)) {
        const link = match[1]!
        // Docs are served under /docs, and written either way in prose.
        const slug = link.replace(/^\/docs\//, '/').slice(1)

        if (slug && !existsSync(join(docsDir, `${slug}.md`)))
          dead.push(link)
      }

      expect(dead).toEqual([])
    })
  }
})

describe('the builder guide matches the validation schema', () => {
  const guide = readFileSync(join(docsDir, 'builder.md'), 'utf8')

  it('documents every measure the schema accepts', () => {
    for (const measure of MEASURES)
      expect(guide).toContain(`\`${measure}\``)
  })

  it('documents every operator the schema accepts', () => {
    for (const operator of OPERATORS)
      expect(guide).toContain(`\`${operator}\``)
  })

  it('documents every grain the schema accepts', () => {
    for (const grain of GRAINS)
      expect(guide).toContain(`\`${grain}\``)
  })

  it('documents every block kind the schema accepts', () => {
    for (const kind of KINDS)
      expect(guide).toContain(`\`${kind}\``)
  })

  it('does not invent terms the schema would reject', () => {
    // Every single-word `code span` in the operator and measure tables has to be
    // a real value, or the guide teaches something the product refuses.
    const tableTerms = [...guide.matchAll(/^\| `([a-z_]+)` \|/gm)].map(m => m[1]!)
    const known = new Set<string>([...MEASURES, ...OPERATORS, ...GRAINS, ...KINDS])

    expect(tableTerms.filter(term => !known.has(term))).toEqual([])
  })
})

describe('code samples', () => {
  it('every JSON body in the docs parses', () => {
    const files = readdirSync(docsDir).filter(name => name.endsWith('.md'))
    const broken: string[] = []

    for (const file of files) {
      const source = readFileSync(join(docsDir, file), 'utf8')

      for (const block of source.matchAll(/```json\n([\s\S]*?)```/g)) {
        try {
          JSON.parse(block[1]!)
        }
        catch {
          broken.push(`${file}: ${block[1]!.slice(0, 40)}`)
        }
      }
    }

    expect(broken).toEqual([])
  })

  it('curl samples post to the documented endpoint with the documented header', () => {
    const quickstart = readFileSync(join(docsDir, 'quickstart.md'), 'utf8')

    expect(quickstart).toContain('https://reportshq.org/ingest')
    expect(quickstart).toContain('X-ReportsHQ-Key')
  })

  it('the -d payload in the quickstart is a valid ingest body', () => {
    const quickstart = readFileSync(join(docsDir, 'quickstart.md'), 'utf8')
    const match = quickstart.match(/-d '([\s\S]*?)'\n```/)

    expect(match).not.toBeNull()

    const body = JSON.parse(match![1]!) as { events: Array<{ name: string }> }

    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events[0]!.name).toBe('commerce.order.created')
  })
})
