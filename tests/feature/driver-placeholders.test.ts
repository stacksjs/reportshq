/**
 * A canary for the database driver.
 *
 * Every authorisation query in this app is written with Postgres-style `$n`
 * placeholders, and `accessFor` deliberately repeats `$2` so the owner check
 * and the seat check read the same user id. That is only correct if `$n` means
 * "the n-th value".
 *
 * bun:sqlite does not do that on its own: it treats `$1` as a name, binds an
 * array to those names in order of first appearance, and ignores the numbers.
 * Under that behaviour our access check silently answers with the wrong values
 * (it read a project id as a user id and locked owners out of their own
 * projects). Fixed in bun-query-builder 0.2.30.
 *
 * This test exists so a downgrade fails here, loudly, instead of somewhere
 * downstream as a permission answer nobody double-checks.
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'

describe('the driver binds numbered placeholders by index', () => {
  test('placeholders out of order bind by number, not by position', async () => {
    const rows = await db.unsafe(`SELECT $2 AS first_column, $1 AS second_column`, ['ONE', 'TWO']) as Array<Record<string, string>>

    expect(rows[0]?.first_column).toBe('TWO')
    expect(rows[0]?.second_column).toBe('ONE')
  })

  test('a repeated placeholder binds the same value twice', async () => {
    const rows = await db.unsafe(`SELECT $1 AS a, $2 AS b, $2 AS b_again`, ['x', 'y']) as Array<Record<string, string>>

    expect(rows[0]?.a).toBe('x')
    expect(rows[0]?.b).toBe('y')
    expect(rows[0]?.b_again).toBe('y')
  })

  test('the shape access.ts actually uses resolves correctly', async () => {
    // Exactly the predicate from accessFor, reduced to constants: the second
    // parameter appears twice and before the first is used again.
    const rows = await db.unsafe(
      `SELECT CASE WHEN $2 = 42 THEN 'owner' ELSE 'other' END AS role WHERE $1 = 7 AND $2 = 42`,
      [7, 42],
    ) as Array<{ role: string }>

    expect(rows[0]?.role).toBe('owner')
  })
})
