-- Item 21 (OD-39, OD-72, spec section 2.11): the date the reader sees under a key-facts block is the
-- date the chosen source was READ, recorded when a plan row becomes SUPPLIED. updated_at moves on any
-- write to the row, so it cannot be that date. One NULLABLE column, no default.
--
-- BACKFILL (fix round 1 of #997, OD-93): a row already SUPPLIED with a chosen source DOES have a recorded
-- read time -- recordOutcome stamps last_attempt_at with the same instant it records the SUPPLIED answer,
-- and a SUPPLIED row is never claimed again, so last_attempt_at is that read. 236 rows on staging
-- (2026-09-24). A SUPPLIED row with no chosen source names no source and gets no date.
--
-- HAND-WRITTEN for the same reason as 0051-0057 (#886: `db:generate` picks the wrong parent snapshot by
-- filename sort). meta/0058_snapshot.json is 0057's snapshot plus this column.
ALTER TABLE "ipo_field_plan" ADD COLUMN IF NOT EXISTS "chosen_confirmed_at" timestamp;--> statement-breakpoint
UPDATE "ipo_field_plan" SET "chosen_confirmed_at" = "last_attempt_at" WHERE "state" = 'SUPPLIED' AND "chosen_source" IS NOT NULL AND "chosen_confirmed_at" IS NULL;
