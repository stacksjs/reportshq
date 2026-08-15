import { config } from '@stacksjs/config'
import { mail, safe, template } from '@stacksjs/email'
import { compact, delta, money } from '../Reports/charts'
import { runQuery } from '../Reports/engine'
import { publishedBlocks } from '../Reports/reports'

/**
 * A report, delivered.
 *
 * The numbers travel in the email, not a picture of them. A chart image is
 * blocked by default in most mail clients, so a report that arrives as a grey
 * box with a broken-image icon is worse than one that arrives as four numbers
 * somebody can read on a phone without tapping anything.
 *
 * Which numbers: the report's big-number blocks, in the order they appear on
 * the page, because those are the ones somebody already decided were the
 * headline. A chart block has no single number to state and is left to the
 * link.
 */
export interface ReportDeliveryOptions {
  to: string[]
  projectId: number
  reportId: number
  reportName: string
  reportUrl: string
  timezone: string
  range: string
  /** Human label for the period, e.g. "Last 30 days". */
  period: string
  attachments?: Array<{ filename: string, content: Uint8Array | string, contentType?: string }>
}

export interface Headline {
  title: string
  value: string
  change: string
}

/**
 * The headline numbers, computed from the same engine call the viewer makes.
 *
 * If these disagreed with the screen, the email would be worse than useless:
 * somebody would act on a number and then find a different one when they
 * clicked through.
 */
export async function headlinesFor(options: {
  projectId: number
  reportId: number
  timezone: string
  range: string
}): Promise<Headline[]> {
  const blocks = (await publishedBlocks(options.reportId)) ?? []
  const headlines: Headline[] = []

  for (const block of blocks) {
    if (String(block.kind) !== 'big_number')
      continue

    try {
      const result = await runQuery({
        projectId: options.projectId,
        timezone: options.timezone,
        range: options.range,
        query: block.query as never,
      }) as { total?: number, comparison?: { change?: number } | null }

      const query = block.query as { measure?: string, field?: string } | undefined
      const isMoney = query?.measure === 'sum' && query?.field === 'value'
      const change = result?.comparison?.change

      headlines.push({
        title: block.title ? String(block.title) : 'Total',
        value: isMoney ? money(Number(result?.total ?? 0), 'USD') : compact(Number(result?.total ?? 0)),
        // Only when there is a comparison to state. "0%" and "no previous
        // period" are different things, and inventing the former is how a
        // report claims nothing changed when nothing was there.
        change: change === undefined || change === null ? '' : `${delta(change)} vs the period before`,
      })
    }
    catch {
      // One block that will not run must not stop the delivery. It is left out
      // rather than reported as zero.
      continue
    }
  }

  return headlines
}

/** Escape text that is about to be put in HTML by hand. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The headline rows, as email-safe HTML.
 *
 * Inline styles and a table, because a mail client strips a stylesheet and a
 * decade-old renderer does not do flexbox. This is the same markup the template
 * would have produced from a loop, built here because the template API does not
 * carry structured values.
 */
function headlineRows(headlines: Headline[]): string {
  if (headlines.length === 0) {
    return '<p style="color: #52525b; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">'
      + 'No numbers to show for this period. The report is still there if you want to look.'
      + '</p>'
  }

  const rows = headlines.map(line => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f2;">
        <p style="color: #71717a; font-size: 13px; margin: 0 0 2px;">${escapeHtml(line.title)}</p>
        <p style="color: #1a1a1c; font-size: 22px; font-weight: 600; margin: 0;">${escapeHtml(line.value)}</p>
        ${line.change ? `<p style="color: #71717a; font-size: 12px; margin: 2px 0 0;">${escapeHtml(line.change)}</p>` : ''}
      </td>
    </tr>`).join('')

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin: 0 0 24px;">${rows}</table>`
}

export async function sendReportDelivery(options: ReportDeliveryOptions): Promise<void> {
  const appName = config.app.name || 'ReportsHQ'
  const subject = `${options.reportName}: ${options.period}`

  const headlines = await headlinesFor({
    projectId: options.projectId,
    reportId: options.reportId,
    timezone: options.timezone,
    range: options.range,
  })

  const { html, text } = await template('report-delivery', {
    variables: {
      appName,
      reportName: options.reportName,
      period: options.period,
      reportUrl: options.reportUrl,
      // Pre-rendered, because the template API takes primitives and a
      // `SafeHtml` rather than structured values. Escaped by hand below for the
      // same reason: a report title is customer input and this is the one place
      // it is not escaped for us.
      headlines: safe(headlineRows(headlines)),
      year: new Date().getFullYear(),
    },
    subject,
  })

  // `sendOrFail`, so the schedule row can record why nothing arrived. A silent
  // failure here means somebody waits a week for a report that was never
  // going to come, and finds out by asking.
  await mail.sendOrFail({
    to: options.to,
    from: {
      name: config.email.from?.name || appName,
      address: config.email.from?.address || 'no-reply@reportshq.org',
    },
    subject,
    html,
    text,
    attachments: options.attachments,
  } as never)
}

export default sendReportDelivery
