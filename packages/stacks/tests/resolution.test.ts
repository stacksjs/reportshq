import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The package has to work in two framework layouts.
 *
 * A **vendored** application keeps the framework in `storage/framework/core`,
 * where `@stacksjs/orm` and friends are workspaces on disk. An **unvendored**
 * one takes the same packages from npm. The specifier is identical in both, so
 * importing by name works everywhere.
 *
 * Reaching for a path does not. A relative import into the framework, or
 * anything resolved from `storage/framework`, works in exactly one layout and
 * fails in the other with a module-not-found that names a file the reader has
 * never heard of. These tests read the source and refuse that outright, because
 * the failure only shows up in whichever layout the author was not using.
 */

const src = new URL('../src', import.meta.url).pathname

/**
 * The file with its comments removed.
 *
 * The rule is about what the code imports, not about what the prose explains.
 * Without this, the doc comment describing the vendored layout trips the very
 * check it is describing, and the honest fix is to read code rather than to
 * stop writing the explanation.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)

    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('framework resolution', () => {
  it('never reaches into the framework by path', () => {
    for (const file of sources(src)) {
      const body = code(file)

      expect(body).not.toContain('storage/framework')
      // A relative import climbing out of the package is reaching for the host
      // application's layout, which is exactly what differs between the two.
      expect(body).not.toMatch(/from\s+['"]\.\.\/\.\.\//)
    }
  })

  it('imports every framework package by name', () => {
    for (const file of sources(src)) {
      for (const match of code(file).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]

        if (!specifier.startsWith('.'))
          continue

        // A relative import is fine as long as it stays inside the package.
        // `../` reaching a sibling directory is ordinary structure; `../../`
        // is climbing out into the host application's layout, which is the
        // thing that differs between vendored and unvendored.
        const escapes = specifier.startsWith('../../')

        expect(escapes).toBe(false)
      }
    }
  })

  it('keeps the framework out of its runtime dependencies', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8'))

    // Framework packages are peers, not dependencies. Declaring them as
    // dependencies would install a second copy of the ORM beside the
    // application's own, and two ORMs mean two connection pools and two
    // opinions about the same database.
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([])

    for (const peer of Object.keys(manifest.peerDependencies ?? {}))
      expect(peer.startsWith('@stacksjs/')).toBe(true)
  })

  it('takes the database as an interface rather than importing one', () => {
    // The compiler accepts anything with `unsafe`. That is what lets it run
    // against the application's already-configured connection instead of
    // opening a second one, and it is why the package needs no database config
    // of its own in either layout.
    const compiler = code(join(src, 'compiler.ts'))

    expect(compiler).toContain('export interface Db')
    expect(compiler).not.toContain('@stacksjs/database')
  })
})
