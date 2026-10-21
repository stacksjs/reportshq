/**
 * Does the schema match what the migration ledger claims?
 *
 * Written after `buddy migrate` reported "your production database is already
 * up to date" against a database where `relation "subscribers" does not exist`.
 * Both can be true at once, and only in one way: the `migrations` table lists
 * a migration that never took effect. Migrate compares files to that table,
 * finds no gap, and does nothing, while the tables those files were supposed
 * to create are absent.
 *
 * That is the same failure as the six-day statushq outage in shape if not in
 * cause: the ledger says the work was done, the schema says otherwise, and
 * every gate reads the ledger.
 *
 * So this reads neither one alone. It takes the migrations the ledger claims
 * are applied, extracts the tables those files create, and asks the database
 * whether they are there.
 *
 * Deliberately not a migration runner and not a fixer. It reports. Deciding
 * what to do about drift needs a person who knows whether the missing table
 * ever held data.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '@stacksjs/config'
import { db, resolveMigrationDirectory } from '@stacksjs/database'

/**
 * Which corpus this database is actually migrated from.
 *
 * `database/migrations` is not one directory. The runner calls
 * `resolveMigrationDirectory(dialect)`, which returns `database/migrations/
 * <dialect>` when that exists and the flat directory otherwise - so on this app
 * postgres reads 18 files from `database/migrations/postgres` while sqlite
 * reads 209 from the flat corpus. The first version of this script hardcoded
 * the flat path, so against the production postgres box it compared 209 sqlite
 * filenames to a ledger holding postgres ones, found no overlap, and reported
 * "0 table(s) claimed by applied migrations" - a clean bill of health from a
 * check that was reading the wrong directory. Resolve it the way the runner
 * does instead.
 *
 * The dialect comes from the environment first: the deploy step exports it by
 * sourcing shared/.env before running this, while `config.database.default` is
 * resolved from whichever .env the config loader found and stays `sqlite`
 * locally even when DB_CONNECTION says otherwise.
 */
const DIALECT = process.env.DB_CONNECTION || config?.database?.default || 'sqlite'
const MIGRATIONS_DIR = resolveMigrationDirectory(DIALECT)

/**
 * Replay what the applied migrations did to the set of table NAMES.
 *
 * A set that only ever grows is the wrong model, and the first version of this
 * was exactly that: it reported 63 missing tables against a healthy database.
 * Almost all of them were migrations doing their job. `_qb_tmp_*` tables are
 * the SQLite table-rebuild dance, created and dropped inside one file.
 * `drivers` became `couriers` in a framework rename. A table that a later
 * migration deliberately removed is not drift, and burying the one real
 * finding under sixty of those is how a check gets ignored.
 *
 * So CREATE, DROP and RENAME are all replayed, in migration order, and only
 * what survives to the end is something the database is expected to hold.
 */
export function replayTableNames(files: { name: string, sql: string }[]): Map<string, string> {
  const owner = new Map<string, string>()

  for (const file of files) {
    // Comments first: these files carry long explanatory headers, and prose
    // mentioning a CREATE TABLE would otherwise register as one.
    const code = file.sql.replace(/--[^\n]*/g, '')

    for (const m of code.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][\w$]*)["`]?/gi))
      owner.set(m[1], file.name)

    for (const m of code.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?([A-Za-z_][\w$]*)["`]?/gi))
      owner.delete(m[1])

    // `ALTER TABLE old RENAME TO new`: the old name stops existing.
    for (const m of code.matchAll(/ALTER\s+TABLE\s+["`]?([A-Za-z_][\w$]*)["`]?\s+RENAME\s+TO\s+["`]?([A-Za-z_][\w$]*)["`]?/gi)) {
      owner.delete(m[1])
      owner.set(m[2], file.name)
    }
  }

  // The rebuild scratch tables, in case a file creates one and the drop is
  // spelled in a way the pattern above does not catch. Nothing outside a
  // migration ever reads these, so their absence is never the finding.
  for (const name of [...owner.keys()])
    if (name.startsWith('_qb_tmp_')) owner.delete(name)

  return owner
}

async function liveTables(): Promise<Set<string>> {
  // Both dialects in one query path would need a driver check; asking the
  // information schema works on Postgres and on SQLite's shim alike through
  // this builder, and falling back to sqlite_master covers the rest.
  try {
    const rows = await db.selectFrom('information_schema.tables' as never)
      .select(['table_name' as never])
      .where('table_schema' as never, '=', 'public' as never)
      .execute() as unknown as { table_name: string }[]
    return new Set(rows.map(r => String(r.table_name)))
  }
  catch {
    const rows = await db.selectFrom('sqlite_master' as never)
      .select(['name' as never])
      .where('type' as never, '=', 'table' as never)
      .execute() as unknown as { name: string }[]
    return new Set(rows.map(r => String(r.name)))
  }
}

/*
 * Guarded so the test can import `replayTableNames` without running the
 * script: top-level `process.exit` in an imported module ends the test run
 * instead of the script, which is how this was first noticed.
 */
if (import.meta.main) {
  const onDisk = readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('.sql')).sort()

  let recorded: string[]
  try {
    const rows = await db.selectFrom('migrations').select(['migration']).execute() as unknown as { migration: string }[]
    recorded = rows.map(row => String(row.migration))
  }
  catch (err) {
    console.log(`schema: the migrations table could not be read -> ${err instanceof Error ? err.message : String(err)}`)
    console.log('schema: that means nothing has ever been applied to this database.')
    process.exit(1)
  }

  const recordedSet = new Set(recorded)
  const pending = onDisk.filter(name => !recordedSet.has(name))
  const live = await liveTables()

  // Only files the ledger CLAIMS are applied, in order. A pending migration
  // whose table is missing is not drift, it is just pending, and saying so would
  // bury the real finding under the ordinary one.
  const applied = onDisk
    .filter(name => recordedSet.has(name))
    .map(name => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
  const claimed = replayTableNames(applied)

  /**
   * Renames the framework performed outside SQL.
   *
   * `buddy migrate` prints "Updated the model snapshot for framework renames
   * (driver-to-courier, stacksjs/stacks#2382): drivers -> couriers" and carries
   * the tables across without a `RENAME TO` any migration file contains. The
   * replay above therefore still believes the old names are owed.
   *
   * Checked rather than allowlisted: the old name is forgiven only when the NEW
   * one is actually live. If both are missing, that is drift and still reported.
   */
  const RENAMED: Record<string, string> = {
    drivers: 'couriers',
    driver_pings: 'courier_pings',
  }

  const missing = [...claimed.entries()]
    .filter(([table]) => !live.has(table))
    .filter(([table]) => {
      const renamedTo = RENAMED[table]
      return !(renamedTo && live.has(renamedTo))
    })

  console.log(`schema: dialect ${DIALECT}, corpus ${MIGRATIONS_DIR}`)
  console.log(`schema: ${onDisk.length} migration file(s), ${recorded.length} recorded as applied, ${pending.length} pending`)
  console.log(`schema: ${claimed.size} table(s) claimed by applied migrations, ${live.size} table(s) live`)

  if (pending.length)
    console.log(`schema: pending -> ${pending.slice(0, 5).join(', ')}${pending.length > 5 ? `, +${pending.length - 5} more` : ''}`)

  if (!missing.length) {
    console.log('schema: every table an applied migration claims to create is present.')
    process.exit(0)
  }

  console.log('')
  console.log(`schema: DRIFT. ${missing.length} table(s) are recorded as created and are NOT in the database:`)
  for (const [table, migration] of missing.slice(0, 20))
    console.log(`  ${table}  <- ${migration} (recorded as applied)`)
  if (missing.length > 20)
    console.log(`  ... and ${missing.length - 20} more`)
  console.log('')
  console.log('schema: `buddy migrate` will not fix this. It compares files to the ledger,')
  console.log('schema: the ledger says these ran, so it reports "already up to date" and does nothing.')
  process.exit(1)
}
