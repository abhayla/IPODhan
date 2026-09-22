-- Item 19 / #807 step 1: the merge log.
--
-- HAND-WRITTEN, not generated, and that is deliberate. `npm run db:generate` on this
-- tree emits this table PLUS a duplicate `closed_ipo_resourcing` (types, table, FK and
-- three indexes) that 0050 already created, because drizzle picks a parent snapshot by
-- sorting filenames in meta/ and `0050_snapshot.json` sorts before every timestamp-named
-- snapshot. The generated migration would fail on `CREATE TYPE ... already exists`
-- anywhere 0050 has run, which is every environment staging is at. Filed as #886; this
-- migration sidesteps it rather than fixing it, and carries the sequence-style name so it
-- sorts after 0050 rather than deepening the split.
--
-- `meta/0051_snapshot.json` accompanies this file because the migration-journal lint
-- (scripts/ci/check-migration-journal.mjs) requires every journalled entry to carry a
-- snapshot — without one, the next `db:generate` diffs against a world that has no
-- `ipo_merge_log` and re-emits it. The snapshot was produced by drizzle and then
-- re-parented by hand so its `prevId` is 0050's id rather than 0050's PARENT's id.
--
-- MEASURED, so nobody reads more into that than is there: re-parenting does NOT cure
-- #886. Running `db:generate` again afterwards still re-emits `closed_ipo_resourcing`,
-- because drizzle picks the head snapshot by SORTING FILENAMES, and `0050_`/`0051_`
-- both sort before every `2026…_` snapshot. The fix records correct lineage; it does
-- not change which file drizzle reads. #886 stays open.
--
-- Non-destructive: creates one table and three indexes. Touches no existing table, no
-- existing column and no existing row. Rollback is `DROP TABLE ipo_merge_log`.

CREATE TABLE IF NOT EXISTS "ipo_merge_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keep_ipo_id" uuid,
	"keep_slug" varchar(255) NOT NULL,
	"drop_ipo_id" uuid NOT NULL,
	"drop_slug" varchar(255) NOT NULL,
	"drop_row" jsonb NOT NULL,
	"survivor_patch" jsonb,
	"deleted_child_counts" jsonb,
	"repointed_child_counts" jsonb,
	"merged_by" varchar(255) NOT NULL,
	"merged_at" timestamp DEFAULT now() NOT NULL,
	"unmerged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- ON DELETE SET NULL, never CASCADE: if the survivor is itself merged away or deleted
-- later, the record of THIS merge must not vanish with it. That history is the whole
-- point of the table. `drop_ipo_id` deliberately has NO foreign key — the row it names is
-- deleted inside the same transaction that writes this log, so a constraint could never
-- be satisfied; the id is kept as a plain uuid so an unmerge can restore the row under
-- its original id.
-- Guarded so the whole file is re-runnable: `ADD CONSTRAINT` has no IF NOT EXISTS, and a
-- half-applied migration that dies on a duplicate constraint is worse than one that does
-- nothing the second time.
DO $$ BEGIN
	ALTER TABLE "ipo_merge_log" ADD CONSTRAINT "ipo_merge_log_keep_ipo_id_ipos_id_fk"
		FOREIGN KEY ("keep_ipo_id") REFERENCES "public"."ipos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_merge_log_keep" ON "ipo_merge_log" USING btree ("keep_ipo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_merge_log_drop" ON "ipo_merge_log" USING btree ("drop_ipo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_merge_log_merged_at" ON "ipo_merge_log" USING btree ("merged_at");
