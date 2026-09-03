-- I4 / W-41: add the two terminal IPO statuses.
--
-- Additive only: `ALTER TYPE ... ADD VALUE` appends a label; it never rewrites
-- rows, never drops a label, and cannot change existing data. `IF NOT EXISTS`
-- makes each statement idempotent, so a re-run (or a DB that already has the
-- label from an out-of-band repair) is a no-op instead of an error.
--
-- Guarded on the type existing so this file is safe to apply to a database
-- built from an older baseline that has not created `ipo_status` yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ipo_status') THEN
    ALTER TYPE "ipo_status" ADD VALUE IF NOT EXISTS 'WITHDRAWN';
    ALTER TYPE "ipo_status" ADD VALUE IF NOT EXISTS 'POSTPONED';
  END IF;
END
$$;
