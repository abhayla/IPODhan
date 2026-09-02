-- T-431 (T-428 review carry-over) — make BrlmTrackRecordRepository.upsert atomic.
--
-- The repository read (brlm_name, as_of_date) and then branched insert-vs-update.
-- Two filing extractions reading the same BRLM's 3-year table concurrently both
-- saw "absent" and both inserted. This unique backs a single
-- INSERT ... ON CONFLICT DO UPDATE, so the race cannot produce a duplicate.
--
-- source_ipo_id is part of the key on purpose: the same BRLM's track record
-- legitimately appears in many ads on the same as-of date, and each filing keeps
-- its own provenance row rather than overwriting another filing's.
--
-- Idempotent + non-destructive per drizzle-migration-gated-ddl.md. Pre-existing
-- exact duplicates (same triple) would block the constraint, so they are folded
-- to the newest row FIRST — the older copies carry identical facts by definition
-- of the key, and nothing references brlm_track_record.id.
DELETE FROM "brlm_track_record" a
USING "brlm_track_record" b
WHERE a."brlm_name" = b."brlm_name"
  AND a."as_of_date" = b."as_of_date"
  AND a."source_ipo_id" = b."source_ipo_id"
  AND (a."updated_at", a."id") < (b."updated_at", b."id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "brlm_track_record"
    ADD CONSTRAINT "unique_brlm_track_record_name_date_source"
    UNIQUE ("brlm_name", "as_of_date", "source_ipo_id");
EXCEPTION
  WHEN duplicate_table THEN null;
  WHEN duplicate_object THEN null;
END $$;
