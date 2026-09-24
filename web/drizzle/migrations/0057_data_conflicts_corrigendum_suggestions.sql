-- Item 9 (OD-90, spec section 2.5.5 as amended, F-163): a stored corrigendum becomes admin-reviewed
-- SUGGESTIONS in the existing admin conflicts queue. Three NULLABLE columns on data_conflicts: every
-- existing row is a source-vs-source conflict and keeps NULL in all three (no default would be true
-- of them). The unique constraint is on suggestion_key only; NULLs are distinct in Postgres, so it
-- never touches an ordinary conflict row.
--
-- HAND-WRITTEN for the same reason as 0051-0056 (#886: `db:generate` picks the wrong parent
-- snapshot by filename sort). meta/0057_snapshot.json is 0056's snapshot plus these objects.
ALTER TABLE "data_conflicts" ADD COLUMN IF NOT EXISTS "document_id" uuid;--> statement-breakpoint
ALTER TABLE "data_conflicts" ADD COLUMN IF NOT EXISTS "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "data_conflicts" ADD COLUMN IF NOT EXISTS "suggestion_key" varchar(64);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "data_conflicts" ADD CONSTRAINT "data_conflicts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "data_conflicts" ADD CONSTRAINT "unique_data_conflicts_suggestion_key" UNIQUE("suggestion_key");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
