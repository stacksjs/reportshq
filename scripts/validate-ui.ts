import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = process.cwd()
const resources = resolve(root, 'resources')
const issues = new Set<string>()

function filesIn(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesIn(path) : /\.(?:stx|html|css)$/.test(path) ? [path] : []
  })
}

function withoutComments(value: string): string {
  const preserveLines = (comment: string): string => comment.replace(/[^\n]/g, ' ')
  return value
    .replace(/<!--[^]*?-->/g, preserveLines)
    .replace(/\{\{--[^]*?--\}\}/g, preserveLines)
    .replace(/\/\*[^]*?\*\//g, preserveLines)
    .replace(/^\s*\/\/.*$/gm, preserveLines)
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

function named(attributes: string): boolean {
  return /\b(?:aria-label|aria-labelledby|title|:aria-label)=/.test(attributes)
}

function report(file: string, source: string, index: number, message: string): void {
  issues.add(`${relative(root, file)}:${lineAt(source, index)}: ${message}`)
}

const files = filesIn(resources)
const markupFiles = files.filter(file => /\.(?:stx|html)$/.test(file))
/*
 * The two app-wide checks at the bottom read resources/ PLUS the CSS config.
 * Resources alone stopped being enough once page <style> blocks moved into
 * config/crosswind.ts under stx-standards rule 3: the focus and breakpoint
 * treatments are still declared, in the one <style data-crosswind> tag the
 * router preserves, and a resources-only corpus cannot see them. statushq hit
 * exactly that -- CI red on main and deploy-prod skipped for two commits.
 * Missing the config throws rather than reading empty, because a check with
 * nothing to search always passes.
 */
const cssConfig = resolve(root, 'config/crosswind.ts')
if (!existsSync(cssConfig))
  throw new Error(`validate-ui: expected the CSS config at ${relative(root, cssConfig)}`)

const combined = [...files, cssConfig].map(file => readFileSync(file, 'utf8')).join('\n')

for (const file of markupFiles) {
  const original = readFileSync(file, 'utf8')
  const source = withoutComments(original)

  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\b(?::?alt)=/.test(match[0]))
      report(file, source, match.index, 'image has no alt text')
  }

  for (const match of source.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/gi)) {
    const attributes = match[1]
    const content = match[2]
      .replace(/<[^>]+>/g, '')
      .replace(/\{\{[^}]+\}\}/g, 'dynamic')
      .replace(/@[a-z]+\([^)]*\)/gi, '')
      .trim()
    if (!content && !named(attributes))
      report(file, source, match.index, 'icon-only button has no accessible name')
  }

  for (const match of source.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attributes = match[2]
    if (/\btype=["']hidden["']/i.test(attributes) || named(attributes))
      continue
    const id = attributes.match(/\bid=["']([^"']+)["']/i)?.[1]
    const before = source.slice(0, match.index)
    const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>')
    const referenced = id ? new RegExp(`<label\\b[^>]*\\bfor=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(source) : false
    if (!wrapped && !referenced)
      report(file, source, match.index, `${match[1].toLowerCase()} has no programmatic label`)
  }

  for (const match of source.matchAll(/\btabindex=["']([1-9]\d*)["']/gi))
    report(file, source, match.index, `positive tabindex ${match[1]} overrides natural keyboard order`)

  for (const match of source.matchAll(/<(?:div|span)\b([^>]*\bonclick=[^>]*)>/gi)) {
    if (!/\brole=["'](?:button|link)["']/i.test(match[1]) || !/\btabindex=["']0["']/i.test(match[1]))
      report(file, source, match.index, 'clickable non-interactive element is not keyboard accessible')
  }
}

if (!/(?:focus-visible|:focus|focus:|focus-within)/.test(combined))
  issues.add('resources: no visible keyboard focus treatment found')
/*
 * The utility half needs a class-token boundary, not \b: \b sits between the
 * hyphen and the s in `--radius-sm:`, so a single custom property name
 * satisfied this check on its own and it could not fail. Found in statushq,
 * where every @media block could be removed and the check still passed.
 */
if (!/(?:@media|(?:^|[\s"'`:])(?:sm|md|lg|xl):)/m.test(combined))
  issues.add('resources: no responsive breakpoint treatment found')

console.log(`Validated ${markupFiles.length} UI templates across desktop, tablet, and mobile contracts.`)
if (issues.size) {
  for (const issue of [...issues].sort()) console.error(`- ${issue}`)
  process.exit(1)
}
