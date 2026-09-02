-- journaled as 0041_journal_drift_repair_backport.sql (T-405, #256)
-- Repair: ipos.registrar live column is varchar(100); schema.ts and migration 0000 declare varchar(255).
-- Found by the T-330 schema-drift assert during the 2026-08-27 staging deploy of 47da0a74
-- ("[COLUMN_TYPE_MISMATCH] ipos.registrar expects varchar(255), live column is varchar(100)").
-- Longest live value on 2026-08-28 was 95 chars — one long registrar name away from a failed upsert.
--
-- SAFETY: widening varchar(100) -> varchar(255) is non-destructive, keeps every existing value, needs no
--         table rewrite in PostgreSQL (metadata-only), and is idempotent (guarded by the DO block).
-- ROLLBACK: ALTER TABLE ipos ALTER COLUMN registrar TYPE varchar(100);  -- only safe while max(length) <= 100
-- APPLY:   psql -d ipodhan -f this-file   and   psql -d ipodhan_staging -f this-file
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ipos' AND column_name = 'registrar'
      AND data_type = 'character varying' AND character_maximum_length < 255
  ) THEN
    ALTER TABLE public.ipos ALTER COLUMN registrar TYPE varchar(255);
    RAISE NOTICE 'ipos.registrar widened to varchar(255)';
  ELSE
    RAISE NOTICE 'ipos.registrar already varchar(255) or wider — no-op';
  END IF;
END $$;
