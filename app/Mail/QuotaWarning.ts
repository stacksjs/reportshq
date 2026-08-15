import { allowanceFor, nextTierFor, planFor } from '../Billing/limits'
import { config } from '@stacksjs/config'
import { mail, template } from '@stacksjs/email'

/**
 * Telling somebody about their quota while they can still act on it.
 *
 * Sent once per threshold per month, which the counter enforces rather than
 * this file: `notified_at_percent` only ever moves up, so an account that
 * bounces around 80% gets one email rather than one per batch.
 */
export interface QuotaWarningOptions {
  to: string
  projectName: string
  projectUrl: string
  tier: string
  used: number
  /** 80 or 100. Decides which of the two messages this is. */
  percent: number
}

export async function sendQuotaWarning(options: QuotaWarningOptions): Promise<void> {
  const appName = config.app.name || 'ReportsHQ'
  const plan = planFor(options.tier)
  const allowance = allowanceFor(options.tier, 'events')
  const next = nextTierFor(options.tier, 'events')
  const atLimit = options.percent >= 100

  const subject = atLimit
    ? `${options.projectName} has used its events for the month`
    : `${options.projectName} is approaching its event quota`

  const { html, text } = await template('quota-warning', {
    variables: {
      appName,
      projectName: options.projectName,
      projectUrl: options.projectUrl,
      used: options.used.toLocaleString('en-GB'),
      allowance: allowance.toLocaleString('en-GB'),
      percent: Math.min(999, Math.round((options.used / Math.max(1, allowance)) * 100)),
      planName: plan.name,
      upgradeName: next?.name ?? '',
      upgradeEvents: next ? allowanceFor(next.tier, 'events').toLocaleString('en-GB') : '',
      atLimit,
      year: new Date().getFullYear(),
    },
    subject,
  })

  // `send`, not `sendOrFail`: nobody is standing in front of this one, and a
  // mail outage must not be the reason a metering job stops running and stops
  // recording usage.
  await mail.send({
    to: [options.to],
    from: {
      name: config.email.from?.name || appName,
      address: config.email.from?.address || 'no-reply@reportshq.org',
    },
    subject,
    html,
    text,
  })
}

export default sendQuotaWarning
