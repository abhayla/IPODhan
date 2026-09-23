-- OD-80 (owner, 2026-09-23): a sixth closed-IPO cause class, FIELDS_PENDING --
-- "fields remain not due yet or waiting to retry". Before this the job wrote
-- SOURCE_UNREACHABLE for an IPO left PARTIAL only because rows were not yet due,
-- which reported "site down" when nothing was down.
--
-- HAND-WRITTEN for the same reason as 0051 (#886: db:generate picks the wrong parent
-- snapshot by filename sort and re-emits closed_ipo_resourcing). meta/0052_snapshot.json
-- is 0051's snapshot with this one enum value appended, prevId = 0051's id.
--
-- Additive only: adds one enum label. No table, column or row is touched. The value is
-- not used inside this migration, so ADD VALUE inside the migrator's transaction is safe
-- on PostgreSQL 12+. Rollback: none needed (an unused label is harmless); removing a
-- label requires recreating the type and is not attempted.

ALTER TYPE "public"."closed_ipo_resourcing_cause_class" ADD VALUE IF NOT EXISTS 'FIELDS_PENDING';
