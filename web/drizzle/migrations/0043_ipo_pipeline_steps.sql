-- S-01 — per-IPO pipeline step ledger (`ipo_pipeline_steps`).
--
-- Spec: docs/specs/per-ipo-due-step-pipeline.md section 4.1.
-- Origin: docs/walks/2026-09-02-deepa-pipeline-walk.md.
--
-- Non-destructive ADDITIVE migration: 1 new enum, 1 new table, 1 FK, 1 unique
-- constraint, 1 composite index. Nothing is dropped, retyped, or backfilled.
--
-- Hand-written the same way 0042 was: the drizzle snapshot chain in
-- meta/ stops at 0013, so `drizzle-kit generate` cannot diff incrementally
-- here. Every statement is wrapped idempotent (IF NOT EXISTS /
-- duplicate_object / duplicate_table) per drizzle-migration-gated-ddl.md so
-- replaying this file is a no-op where the objects already exist.
--
-- Enum-name collision check (T-403 round-2 lesson: an enum named like its own
-- table breaks with 42710): `ipo_step_status` matches no existing enum name
-- and no table name (existing or new). It is deliberately distinct from the
-- pre-existing `ipo_status` enum (IPO lifecycle) and `extraction_status`.

DO $$ BEGIN
  CREATE TYPE "ipo_step_status" AS ENUM ('NOT_DUE', 'DUE', 'RUNNING', 'DONE', 'FAILED', 'NOT_AVAILABLE_YET', 'BLOCKED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ipo_pipeline_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"status" "ipo_step_status" DEFAULT 'NOT_DUE' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"source" text,
	"input_ref" text,
	"evidence" jsonb,
	"error" text,
	"version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_ipo_pipeline_steps_ipo_step" UNIQUE("ipo_id","step_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ipo_pipeline_steps" ADD CONSTRAINT "ipo_pipeline_steps_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_pipeline_steps_status_next_due_at" ON "ipo_pipeline_steps" USING btree ("status","next_due_at");
