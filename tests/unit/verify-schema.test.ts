/**
 * The DDL replay behind scripts/verify-schema.ts.
 *
 * Tested because the first version of that script reported 63 missing tables
 * against a healthy database. Every one of them was a migration doing its job:
 * SQLite rebuild scratch tables, and a table a later migration deliberately
 * dropped. A drift check that cries wolf sixty times is one people stop
 * reading, which leaves the single real finding exactly as buried as it was.
 *
 * So the cases below are the ones that produced those false positives, plus
 * the true positive the whole script exists to surface.
 */
import { describe, expect, test } from 'bun:test'
import { replayTableNames } from '../../scripts/verify-schema'

const file = (name: string, sql: string) => ({ name, sql })

describe('replayTableNames', () => {
  test('a plain create is owed', () => {
    const owed = replayTableNames([file('001.sql', 'CREATE TABLE "subscribers" ("id" INTEGER);')])
    expect([...owed.keys()]).toEqual(['subscribers'])
  })

  test('a table a later migration drops is not owed', () => {
    const owed = replayTableNames([
      file('001.sql', 'CREATE TABLE "legacy" ("id" INTEGER);'),
      file('002.sql', 'DROP TABLE "legacy";'),
    ])
    expect(owed.has('legacy')).toBe(false)
  })

  test('the SQLite rebuild dance leaves only the final name', () => {
    // create scratch, copy, drop original, rename scratch into place: the
    // shape of every `auto-misc` migration in this repo.
    const owed = replayTableNames([
      file('001.sql', 'CREATE TABLE "drivers" ("id" INTEGER);'),
      file('002.sql', `CREATE TABLE "_qb_tmp_drivers" ("id" INTEGER);
        INSERT INTO "_qb_tmp_drivers" SELECT * FROM "drivers";
        DROP TABLE "drivers";
        ALTER TABLE "_qb_tmp_drivers" RENAME TO "drivers";`),
    ])
    expect(owed.has('_qb_tmp_drivers')).toBe(false)
    expect(owed.has('drivers')).toBe(true)
  })

  test('prose in a comment is not a CREATE TABLE', () => {
    // These files carry long explanatory headers, and the real ones in this
    // repo discuss the tables they are about to make.
    const owed = replayTableNames([file('001.sql', `
      -- This migration does NOT create table "ghosts", it only explains why.
      -- CREATE TABLE "phantom" would be wrong here.
      CREATE TABLE "real_one" ("id" INTEGER);`)])
    expect([...owed.keys()]).toEqual(['real_one'])
  })

  test('bare and IF NOT EXISTS spellings both count', () => {
    const owed = replayTableNames([file('001.sql', `
      CREATE TABLE IF NOT EXISTS "a" ("id" INTEGER);
      CREATE TABLE b ("id" INTEGER);`)])
    expect(new Set(owed.keys())).toEqual(new Set(['a', 'b']))
  })

  test('the true positive: a created table that nothing drops stays owed', () => {
    // This is the production case. `subscribers` is created by a migration the
    // ledger records as applied, nothing drops it, and the database does not
    // have it. The script compares this set against the live one and reports.
    const owed = replayTableNames([
      file('0000000027-create-subscribers-table.sql', 'CREATE TABLE IF NOT EXISTS "subscribers" ("id" INTEGER);'),
      file('0000000055-alter-subscriber_emails-subscriber_id.sql', 'ALTER TABLE "subscriber_emails" ADD COLUMN "subscriber_id" INTEGER;'),
    ])
    expect(owed.get('subscribers')).toBe('0000000027-create-subscribers-table.sql')
  })
})
