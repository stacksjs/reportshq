import { config } from '@stacksjs/config'
import { mail, template } from '@stacksjs/email'

/**
 * The one email somebody is definitely waiting for.
 *
 * Sent through our own mail server, authenticated as the project's own domain,
 * which is what keeps it out of a spam folder: a reset that arrives an hour
 * late in junk is the same as one that never arrived.
 */
export interface PasswordResetOptions {
  to: string
  resetUrl: string
  expiresInMinutes?: number
}

export async function sendPasswordReset(options: PasswordResetOptions): Promise<void> {
  const appName = config.app.name || 'ReportsHQ'
  const subject = `Reset your ${appName} password`

  const { html, text } = await template('password-reset', {
    variables: {
      appName,
      resetUrl: options.resetUrl,
      expiresInMinutes: options.expiresInMinutes ?? 60,
      year: new Date().getFullYear(),
    },
    subject,
  })

  // `sendOrFail`, not `send`: the caller needs to know. A reset endpoint that
  // reports success while the mail was refused leaves somebody refreshing an
  // inbox forever, and the log line nobody is reading is not a substitute.
  await mail.sendOrFail({
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

export default sendPasswordReset
