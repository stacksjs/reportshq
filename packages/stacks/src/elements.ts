import type { RenderedBlock } from './types'

/**
 * A block, as a custom element.
 *
 * Built as a string rather than written in the template, because a template
 * cannot interpolate a tag name: `<div is="{{ tag }}">` is the customized
 * built-in form and renders a plain div with an attribute nobody reads. The
 * alternative is a nine-branch conditional in every view that draws a block.
 *
 * The payload rides in an attribute. An object property deserializes from its
 * attribute, so the element is complete when the parser reaches it, and a block
 * is readable in view-source, which is where somebody looks when a number seems
 * wrong. That also makes the escaping load-bearing: a dimension value is a
 * customer's own text.
 */
const TAGS: Record<string, string> = {
  big_number: 'stacks-big-number',
  line: 'stacks-line-chart',
  area: 'stacks-line-chart',
  bar: 'stacks-bar-chart',
  donut: 'stacks-donut-chart',
  table: 'stacks-table-chart',
  funnel: 'stacks-funnel-chart',
  heatmap: 'stacks-heatmap-chart',
  note: 'stacks-text-block',
}

export function tagFor(kind: string): string {
  return TAGS[kind] ?? 'stacks-text-block'
}

export function elementHtml(block: RenderedBlock): string {
  const tag = tagFor(block.kind)
  const attributes: Record<string, string> = { result: JSON.stringify(block) }

  if (block.title)
    attributes.title = block.title

  if (block.body)
    attributes.body = block.body

  const rendered = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('')

  return `<${tag}${rendered}></${tag}>`
}

/**
 * Escape a value for an HTML attribute.
 *
 * Both quote forms and both angle brackets, because the payload contains
 * whatever the customer called their products and one unescaped quote ends the
 * attribute and starts markup.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
