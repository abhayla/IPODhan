-- OD-85 / OD-86 (docs/design/data-sourcing-pull-model.md §2.3.3.2 "Source record keys"):
-- each source's own OFFERING-level record number, many per IPO. BSE IPO_NO (BSE_IPO_NO), the
-- Chittorgarh page id (CG_PAGE_ID; slug ignored, F-148), the NSE issue symbol with its series
-- (NSE_ISSUE = SYMBOL|SERIES). CIN / ISIN / PAN / BSE scrip code / BSE Symbol stay on `ipos`.
--
-- HAND-WRITTEN for the same reason as 0051 and 0052 (#886: `db:generate` picks the wrong parent
-- snapshot by filename sort and re-emits closed_ipo_resourcing). meta/0053_snapshot.json was
-- produced by drizzle-kit from schema.ts and re-parented so prevId = 0052's id.
--
-- The unique index is PLAIN (source, key_type, binding_value). binding_value is NULL for
-- RELEASED / DISPUTED keys so those values are reusable, and NULLs are distinct under a plain
-- unique constraint. No partial or expression index: the merge tool's repoint-conflict
-- predicate refuses a REPOINT table that has one (#900), and this table is on REPOINT_TABLES.
--
-- Additive only: two enum types, one table, one index. No existing table, column or row is
-- touched. Rollback: DROP TABLE ipo_source_keys; DROP TYPE ipo_source_key_state;
-- DROP TYPE ipo_source_key_type. The code falls back to the pre-OD-85 matching order when the
-- table has no rows.

DO $$ BEGIN
	CREATE TYPE "public"."ipo_source_key_type" AS ENUM('BSE_IPO_NO', 'CG_PAGE_ID', 'NSE_ISSUE');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."ipo_source_key_state" AS ENUM('ACTIVE', 'SUPERSEDED', 'RELEASED', 'DISPUTED');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ipo_source_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"source" varchar(40) NOT NULL,
	"key_type" "ipo_source_key_type" NOT NULL,
	"key_value" varchar(64) NOT NULL,
	"attrs" jsonb,
	"state" "ipo_source_key_state" DEFAULT 'ACTIVE' NOT NULL,
	"binding_value" varchar(64),
	"record_open_date" date,
	"bound_via" varchar(32) NOT NULL,
	"bound_by" varchar(64) NOT NULL,
	"bound_at" timestamp DEFAULT now() NOT NULL,
	"state_changed_at" timestamp DEFAULT now() NOT NULL,
	"state_reason" text,
	"superseded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ipo_source_keys_binding" UNIQUE("source","key_type","binding_value"),
	CONSTRAINT "ck_ipo_source_keys_binding_state" CHECK (("ipo_source_keys"."state" IN ('ACTIVE', 'SUPERSEDED') AND "ipo_source_keys"."binding_value" IS NOT NULL AND "ipo_source_keys"."binding_value" = "ipo_source_keys"."key_value") OR ("ipo_source_keys"."state" IN ('RELEASED', 'DISPUTED') AND "ipo_source_keys"."binding_value" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ipo_source_keys" ADD CONSTRAINT "ipo_source_keys_ipo_id_ipos_id_fk"
		FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ipo_source_keys" ADD CONSTRAINT "ipo_source_keys_superseded_by_ipo_source_keys_id_fk"
		FOREIGN KEY ("superseded_by") REFERENCES "public"."ipo_source_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_source_keys_ipo" ON "ipo_source_keys" USING btree ("ipo_id");
