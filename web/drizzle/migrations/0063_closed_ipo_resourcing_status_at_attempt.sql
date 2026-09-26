-- #932 / #777 (spec §6.1, OD-81 event 1), migration 0063: the IPO's status at each closed-IPO job attempt.
-- Hand-trimmed from drizzle-kit's output to this migration's statement only. Nullable and additive:
-- a row attempted before this change reads NULL, and the job falls back to the listing_date inference for it once.
ALTER TABLE "closed_ipo_resourcing" ADD COLUMN IF NOT EXISTS "status_at_attempt" varchar(20);
