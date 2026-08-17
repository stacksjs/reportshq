/**
 * The licence key, checked offline.
 *
 * There is no network call here and there is not going to be one. The whole
 * claim of the embedded shape is that an application's data never leaves it,
 * and a package that phones home on boot has quietly made a different claim:
 * that the vendor knows which applications are running, how often they restart
 * and when they deploy. A licence check is not worth that.
 *
 * **Nothing here gates a report.** An unlicensed application reports on its own
 * data exactly as a licensed one does. What the absence of a key changes is
 * that the pages say so. A reporting tool that blanks somebody's dashboard over
 * a billing state is a reporting tool that cannot be trusted with the dashboard.
 */
export const LICENSE_PREFIX = 'rhq_lic_'

export class License {
  constructor(private readonly key?: string | null) {}

  present(): boolean {
    return typeof this.key === 'string' && this.key !== ''
  }

  /**
   * Whether the key looks like one we issued.
   *
   * Shape only. This says "that is not a ReportsHQ key" to somebody who pasted
   * the wrong thing, and says nothing at all about whether the licence is
   * current, which is a question only the call this refuses to make could
   * answer.
   */
  valid(): boolean {
    return this.present() && new RegExp(`^${LICENSE_PREFIX}[0-9a-f]{32}$`).test(this.key!)
  }

  /** What to say on the page, or null when there is nothing to say. */
  notice(): string | null {
    if (this.valid())
      return null

    if (!this.present())
      return 'Unlicensed. Reports work in full; set REPORTSHQ_LICENSE to remove this notice.'

    return 'That licence key is not in the expected format. Reports are unaffected.'
  }
}
