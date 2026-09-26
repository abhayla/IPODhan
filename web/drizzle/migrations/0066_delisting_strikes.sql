-- #983 / OD-38 (spec 2.3.3.3): delisting detection for the post-listing price job.
-- Hand-trimmed: drizzle-kit also emitted DDL for objects earlier hand-trimmed migrations already
-- create (the snapshot chain lags them); only this change's own DDL is kept.
-- Additive only: one enum label appended, three nullable/defaulted columns. No row is rewritten.
ALTER TYPE "public"."ipo_status" ADD VALUE IF NOT EXISTS 'DELISTED';--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "delisting_strikes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "delisting_strike_reads" jsonb;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "delisted_at" timestamp;
