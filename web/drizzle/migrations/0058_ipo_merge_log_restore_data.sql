-- Item 19 / OD-92 (spec §2.3.3.3 "a merge log, not a diff ... the rows themselves"; "every
-- automatic merge is reversible"): the merge log gains the data an exact unmerge needs.
--
-- restore_data (jsonb, NULLABLE): { format: 3, deletedRows, nulledRefs, sourceKeysBefore,
--   supersededKeyIds, keepRowAfter, redirectId } written by IPORepository.mergeDuplicateInto
--   inside the merge transaction. Every row the merge deletes (direct children and the rows
--   their FK cascades remove) whole, every FK reference a cascade sets to NULL, both IPOs'
--   source keys whole before the merge, and the survivor after it. NULL on every entry logged
--   before this change: those entries are partly reversible, and the unmerge tool says so.
-- unmerged_by (varchar, NULLABLE): who ran the unmerge; set together with unmerged_at.
--
-- HAND-WRITTEN for the same reason as 0051-0057 (#886: `db:generate` picks the wrong parent
-- snapshot by filename sort). meta/0058_snapshot.json is 0057's snapshot plus these columns.
-- Additive and nullable: touches no existing row. Rollback is two DROP COLUMNs.
ALTER TABLE "ipo_merge_log" ADD COLUMN IF NOT EXISTS "restore_data" jsonb;--> statement-breakpoint
ALTER TABLE "ipo_merge_log" ADD COLUMN IF NOT EXISTS "unmerged_by" varchar(255);
