-- #968 (spec §2.3.5, OD-73, OD-95), migration 0061: the override that reopened a settled plan row.
-- Hand-trimmed from drizzle-kit's output to this migration's statement only.
ALTER TABLE "ipo_field_plan" ADD COLUMN IF NOT EXISTS "reopened_under_policy" varchar(64);
