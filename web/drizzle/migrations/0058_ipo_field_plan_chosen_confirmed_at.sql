-- Item 21 (OD-39, OD-72, spec section 2.11): the date the reader sees under a key-facts block is the
-- date the chosen source was READ, recorded when a plan row becomes SUPPLIED. updated_at moves on any
-- write to the row, so it cannot be that date. One NULLABLE column: rows supplied before this migration
-- have no recorded read date, and a default would assert a date nobody measured.
--
-- HAND-WRITTEN for the same reason as 0051-0057 (#886: `db:generate` picks the wrong parent snapshot by
-- filename sort). meta/0058_snapshot.json is 0057's snapshot plus this column.
ALTER TABLE "ipo_field_plan" ADD COLUMN IF NOT EXISTS "chosen_confirmed_at" timestamp;
