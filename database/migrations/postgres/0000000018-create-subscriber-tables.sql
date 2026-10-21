-- Hand-written, and deliberately not carrying the `@generated` marker.
--
-- WHY THESE TABLES WERE MISSING
--
-- The framework registers POST /api/email/subscribe itself, in
-- storage/framework/defaults/routes/dashboard.ts, pointing at
-- SubscriberEmailAction, which imports Subscriber and SubscriberEmail from
-- @stacksjs/orm. config/database.ts sets models.includeFrameworkDefaults to
-- false, so those two models are excluded from migration generation while the
-- route stays registered. The endpoint therefore answered 500 on every call
-- from its first read of `subscribers`, and `buddy migrate` reported "Nothing
-- to migrate - your production database is already up to date" each time,
-- because it compares migration files against the ledger and no file ever
-- described the table. Filed upstream as stacksjs/stacks#2943.
--
-- WHY THIS IS NOT GENERATED
--
-- `buddy migrate:regenerate postgres` rebuilds the corpus from app/Models
-- rather than appending to it. With Subscriber and SubscriberEmail published,
-- its plan writes 4 files and REMOVES 0000000002-create-users-table.sql, a
-- migration production has already applied and recorded by name. Rewriting an
-- applied migration to add two unrelated tables is a worse trade than one
-- additive file, so the schema below is transcribed from the model snapshot
-- (storage/framework/database/model-snapshot.sqlite.json, written by
-- `buddy generate:migrations` from the published models) and not invented.
--
-- WHY ONLY POSTGRES NEEDED A FILE
--
-- The flat sqlite corpus still carries these tables from before
-- includeFrameworkDefaults was turned off: 0000000014 and 0000000027 create
-- them, 0000000055 and 0000000072 note the constraints sqlite cannot add,
-- 0000000091 adds the unique email index, and 0000000134 rebuilds both tables
-- through _qb_tmp_* to pick up uuid and unsubscribed_at. Local development
-- and the sqlite CI job have had the tables all along, which is why only the
-- postgres box answered 500 and nothing local ever reproduced it.
--
-- Index names follow the postgres corpus convention (users_email_unique), not
-- the flat corpus's doubled subscribers_subscribers_email_unique.
--
-- WHY created_at DEFAULTS TO UTC AND THE REST OF THIS CORPUS DOES NOT
--
-- Every older table here was written with `default CURRENT_TIMESTAMP`, which
-- on postgres returns a timestamptz and is then converted into the session's
-- timezone on the way into a naive `timestamp` column. That is the shape
-- behind stacksjs/stacks#2902, where naive postgres timestamps are decoded as
-- UTC on read regardless of what was stored. The current generator agrees:
-- running `buddy migrate` against a fresh postgres database with these models
-- published emits `ALTER TABLE "users" ALTER COLUMN "created_at" SET default
-- (now() AT TIME ZONE 'utc')`. New tables get the unambiguous default; the
-- existing ones are left exactly as they are, because changing a default on a
-- live table is a separate decision from adding two missing tables.
-- No comment follows a statement on its own line anywhere below: the runner
-- splits this file on the statement terminator and re-emits each fragment on
-- its own line, which strips the leading dashes from a comment tail and turns
-- prose into invalid SQL (stacksjs/stacks#2929 territory).
DO $stacks$ BEGIN CREATE TYPE "subscribers_status_type" AS ENUM ('subscribed', 'unsubscribed', 'pending', 'bounced');
EXCEPTION WHEN duplicate_object THEN null;
END $stacks$;
ALTER TYPE "subscribers_status_type" ADD VALUE IF NOT EXISTS 'subscribed';
ALTER TYPE "subscribers_status_type" ADD VALUE IF NOT EXISTS 'unsubscribed';
ALTER TYPE "subscribers_status_type" ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE "subscribers_status_type" ADD VALUE IF NOT EXISTS 'bounced';
CREATE TABLE IF NOT EXISTS "subscribers" (
  "id" BIGSERIAL PRIMARY KEY,
  "email" varchar(255) not null,
  "status" "subscribers_status_type" not null default 'subscribed',
  "source" varchar(100) default 'homepage',
  "unsubscribed_at" timestamp,
  "user_id" bigint REFERENCES "users"("id"),
  "created_at" timestamp not null default (now() AT TIME ZONE 'utc'),
  "updated_at" timestamp,
  "uuid" varchar(255)
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscribers_email_unique" ON "subscribers" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "subscribers_uuid_unique" ON "subscribers" ("uuid");
CREATE TABLE IF NOT EXISTS "subscriber_emails" (
  "id" BIGSERIAL PRIMARY KEY,
  "email" varchar(255) not null,
  "source" varchar(100) default 'homepage',
  "subscriber_id" bigint REFERENCES "subscribers"("id"),
  "created_at" timestamp not null default (now() AT TIME ZONE 'utc'),
  "updated_at" timestamp,
  "uuid" varchar(255)
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_emails_uuid_unique" ON "subscriber_emails" ("uuid");
