-- W-76: add SUB_SYNDICATE to intermediary_role.
--
-- The price-band ad's syndicate_members extraction emits both a lead
-- 'SYNDICATE' member and a sub-syndicate broker list tagged 'SUB_SYNDICATE'.
-- intermediary_role only had SYNDICATE, so the persister filed the lead
-- member and skipped the sub-syndicate names under skipped_no_column.
--
-- Additive only: `ALTER TYPE ... ADD VALUE` appends a label; it never
-- rewrites rows, never drops a label, and cannot change existing data.
-- `IF NOT EXISTS` makes each statement idempotent, so a re-run (or a DB that
-- already has the label from an out-of-band repair) is a no-op instead of an
-- error.
--
-- Guarded on the type existing so this file is safe to apply to a database
-- built from an older baseline that has not created `intermediary_role` yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intermediary_role') THEN
    ALTER TYPE "intermediary_role" ADD VALUE IF NOT EXISTS 'SUB_SYNDICATE';
  END IF;
END
$$;
