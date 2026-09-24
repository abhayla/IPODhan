-- Item 22 (OD-36, F-154; round 3): the durable "expanded" marker for a stored zip document.
-- NULL means the zip's other members were never examined, so the data-slot stored-zip
-- expansion pass (and scraper/scripts/repair-zip-member-documents.ts) selects it; a value
-- means they were, and the zip is never downloaded again for that purpose. Not part_number:
-- a one-member zip keeps part_number NULL and must still leave the selection. Additive and
-- nullable: every existing zip row reads as "never examined", which is true.
--
-- HAND-WRITTEN for the same reason as 0051-0054 (#886: `db:generate` picks the wrong parent
-- snapshot by filename sort). meta/0055_snapshot.json is 0054's snapshot plus this column,
-- parented on 0054's id.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "zip_members_checked_at" timestamp;

-- Item 22 round 4 (Tier A MAJOR): a durable per-slot failed-attempt count so a
-- dead zip (404/timeout/refused) is closed after 3 distinct data-slot
-- failures instead of being re-fetched forever. Added to this SAME
-- hand-written migration rather than a new one because 0055 is unmerged.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "zip_expand_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "zip_last_attempt_slot" bigint;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "zip_unresolved_reason" varchar(64);
