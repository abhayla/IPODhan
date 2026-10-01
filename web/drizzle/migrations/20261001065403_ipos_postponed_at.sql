ALTER TABLE "ipos" ADD COLUMN "postponed_at" timestamp;--> statement-breakpoint
-- #1304 M1 (spec §2.9, OD-120, OD-139): stamp the moment an IPO MOVES to POSTPONED, on the database
-- clock (UTC, the column is a naive timestamp), for every writer: a trigger is the one path every
-- status write passes through. Re-postponement (POSTPONED -> another status -> POSTPONED) restamps;
-- a write that keeps POSTPONED does not. Existing rows stay NULL until the backfill tool
-- (scraper/scripts/backfill-postponed-at.ts) fills them from evidence; NULL means unknown.
CREATE OR REPLACE FUNCTION ipos_stamp_postponed_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'POSTPONED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'POSTPONED') THEN
    NEW.postponed_at := now() AT TIME ZONE 'UTC';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS ipos_stamp_postponed_at ON ipos;--> statement-breakpoint
CREATE TRIGGER ipos_stamp_postponed_at BEFORE INSERT OR UPDATE OF status ON ipos FOR EACH ROW EXECUTE FUNCTION ipos_stamp_postponed_at();
